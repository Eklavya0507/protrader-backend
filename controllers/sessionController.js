const Session = require("../models/Session");
const User = require("../models/User");
const {
  hashValue,
  safeEqualHex,
  parseRefreshToken,
  createSession,
  rotateRefreshToken,
  revokeSessionDocument,
} = require("../utils/sessionManager");
const {
  sendNewDeviceLoginAlert,
  verifySecurityActionToken,
} = require("../utils/securityAlert");

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  isEmailVerified: user.isEmailVerified === true,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  authProvider: user.authProvider,
  avatarUrl: user.avatarUrl || "",
  updatedAt: user.updatedAt,
});

const sessionResponse = ({ token, refreshToken, session, expiresInSeconds }) => ({
  token,
  refreshToken,
  sessionId: session.sessionId,
  accessTokenExpiresInSeconds: expiresInSeconds,
  refreshSessionExpiresAt: session.expiresAt,
  newDeviceDetected: session.isNewDevice === true,
  trustedDevice: session.isTrusted === true,
});

const validSessionId = (value) =>
  /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());

const findOwnedSession = async (userId, sessionId) =>
  Session.findOne({
    user: userId,
    sessionId,
  }).select("+sessionId +fingerprintHash");

const revokeFingerprintSessions = async ({
  userId,
  fingerprintHash,
  sessionId,
  reason,
}) => {
  const query = {
    user: userId,
    revokedAt: null,
  };

  if (fingerprintHash) {
    query.fingerprintHash = fingerprintHash;
  } else if (sessionId) {
    query.sessionId = sessionId;
  } else {
    return { modifiedCount: 0 };
  }

  return Session.updateMany(query, {
    $set: {
      revokedAt: new Date(),
      revokeReason: reason,
      isTrusted: false,
      trustedAt: null,
    },
  });
};

// POST /api/auth/sessions/start
const startSession = async (req, res, next) => {
  try {
    const result = await createSession({
      user: req.user,
      req,
      revokeSession: req.authSession,
    });

    req.user.lastLoginAt = new Date();
    await req.user.save({ validateBeforeSave: false });

    const shouldSendAlert =
      result.session.isNewDevice === true &&
      result.session.isTrusted !== true;

    res.status(201).json({
      success: true,
      message: shouldSendAlert
        ? "Secure session created. A new-device security alert was sent."
        : "Secure device session created.",
      ...sessionResponse(result),
      securityAlertQueued: shouldSendAlert,
      data: publicUser(req.user),
    });

    if (shouldSendAlert) {
      setImmediate(() => {
        sendNewDeviceLoginAlert({
          user: req.user,
          session: result.session,
        }).catch((error) => {
          console.error(
            `[${req.requestId || "no-request-id"}] New-device email failed:`,
            error.message
          );
        });
      });
    }
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/sessions/refresh
const refreshSession = async (req, res, next) => {
  try {
    const parsed = parseRefreshToken(req.body.refreshToken);

    if (!parsed) {
      return res.status(401).json({
        success: false,
        code: "INVALID_REFRESH_TOKEN",
        message: "The refresh token is invalid.",
        requestId: req.requestId,
      });
    }

    const session = await Session.findOne({
      sessionId: parsed.sessionId,
    }).select("+sessionId +refreshTokenHash");

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return res.status(401).json({
        success: false,
        code: "SESSION_EXPIRED",
        message: "This device session has expired. Please sign in again.",
        requestId: req.requestId,
      });
    }

    const suppliedHash = hashValue(parsed.value);

    if (!safeEqualHex(suppliedHash, session.refreshTokenHash)) {
      await revokeSessionDocument(session, "refresh-token-reuse");

      return res.status(401).json({
        success: false,
        code: "REFRESH_TOKEN_REUSED",
        message: "This session was revoked because an old refresh token was reused.",
        requestId: req.requestId,
      });
    }

    const user = await User.findById(session.user);

    if (
      !user ||
      !user.isActive ||
      session.tokenVersion !== (user.tokenVersion || 0)
    ) {
      await revokeSessionDocument(session, "account-security-change");

      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "This session is no longer valid. Please sign in again.",
        requestId: req.requestId,
      });
    }

    const result = await rotateRefreshToken({ session, user, req });

    res.status(200).json({
      success: true,
      message: "Session refreshed.",
      ...sessionResponse({ ...result, session }),
      data: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/sessions
const listSessions = async (req, res, next) => {
  try {
    const now = new Date();

    await Session.updateMany(
      {
        user: req.user._id,
        revokedAt: null,
        $or: [
          { expiresAt: { $lte: now } },
          { tokenVersion: { $ne: req.user.tokenVersion || 0 } },
        ],
      },
      {
        $set: {
          revokedAt: now,
          revokeReason: "expired-or-security-change",
        },
      }
    );

    const sessions = await Session.find({
      user: req.user._id,
      revokedAt: null,
      expiresAt: { $gt: now },
      tokenVersion: req.user.tokenVersion || 0,
    })
      .sort({ lastActiveAt: -1 })
      .select("+sessionId")
      .lean();

    const currentSessionId = req.authSession?.sessionId || "";

    res.status(200).json({
      success: true,
      legacySession: req.isLegacySession === true,
      count: sessions.length,
      data: sessions.map((session) => ({
        id: session.sessionId,
        deviceName: session.deviceName,
        browser: session.browser,
        operatingSystem: session.operatingSystem,
        deviceType: session.deviceType,
        ipAddress: session.ipAddressMasked,
        approximateLocation: session.approximateLocation,
        timezone: session.timezone,
        isNewDevice: session.isNewDevice === true,
        // Missing value means it is a pre-Batch-3 session, which is trusted.
        isTrusted: session.isTrusted !== false,
        trustedAt: session.trustedAt || null,
        alertSentAt: session.newDeviceAlertSentAt || null,
        isCurrent: session.sessionId === currentSessionId,
        signedInAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        expiresAt: session.expiresAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/auth/sessions/:sessionId/trust
const updateTrustedSession = async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim().toLowerCase();
    const trusted = req.body?.trusted !== false;

    if (!validSessionId(sessionId)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SESSION_ID",
        message: "Session identifier is invalid.",
        requestId: req.requestId,
      });
    }

    const session = await findOwnedSession(req.user._id, sessionId);

    if (!session || session.revokedAt) {
      return res.status(404).json({
        success: false,
        code: "SESSION_NOT_FOUND",
        message: "The selected session was not found.",
        requestId: req.requestId,
      });
    }

    const now = new Date();
    const trustQuery = session.fingerprintHash
      ? { user: req.user._id, fingerprintHash: session.fingerprintHash }
      : { _id: session._id };

    await Session.updateMany(
      trustQuery,
      {
        $set: {
          isTrusted: trusted,
          trustedAt: trusted ? now : null,
          isNewDevice: trusted ? false : session.isNewDevice,
        },
      }
    );

    res.status(200).json({
      success: true,
      trusted,
      message: trusted
        ? "This device is now trusted."
        : "This device is no longer trusted.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/sessions/:sessionId/not-me
const reportSessionNotMine = async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim().toLowerCase();

    if (!validSessionId(sessionId)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SESSION_ID",
        message: "Session identifier is invalid.",
        requestId: req.requestId,
      });
    }

    const session = await findOwnedSession(req.user._id, sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        code: "SESSION_NOT_FOUND",
        message: "The selected session was not found.",
        requestId: req.requestId,
      });
    }

    const currentSessionRevoked = req.authSession?.sessionId === sessionId;
    const result = await revokeFingerprintSessions({
      userId: req.user._id,
      fingerprintHash: session.fingerprintHash,
      sessionId,
      reason: "user-reported-not-mine",
    });

    res.status(200).json({
      success: true,
      currentSessionRevoked,
      revokedCount: result.modifiedCount,
      message: "The unrecognized device has been revoked. Reset your password if you suspect account access.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/sessions/revoke-alert (public, signed email action)
const revokeFromSecurityAlert = async (req, res, next) => {
  try {
    const payload = verifySecurityActionToken(req.body?.token);

    if (!validSessionId(payload.sessionId)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SECURITY_ACTION",
        message: "Security action token is invalid.",
        requestId: req.requestId,
      });
    }

    const session = await Session.findOne({
      user: payload.userId,
      sessionId: payload.sessionId,
    }).select("+sessionId +fingerprintHash");

    if (!session) {
      return res.status(200).json({
        success: true,
        alreadySecured: true,
        message: "This login is no longer active.",
      });
    }

    const result = await revokeFingerprintSessions({
      userId: payload.userId,
      fingerprintHash: session.fingerprintHash,
      sessionId: payload.sessionId,
      reason: "email-alert-rejected-device",
    });

    res.status(200).json({
      success: true,
      revokedCount: result.modifiedCount,
      message: "The unrecognized device has been revoked. Reset your password now if this login was not yours.",
    });
  } catch (error) {
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error?.name)) {
      return res.status(400).json({
        success: false,
        code: error.name === "TokenExpiredError" ? "SECURITY_ACTION_EXPIRED" : "INVALID_SECURITY_ACTION",
        message: error.name === "TokenExpiredError"
          ? "This security action link has expired."
          : "This security action link is invalid.",
        requestId: req.requestId,
      });
    }
    next(error);
  }
};

// DELETE /api/auth/sessions/current
const revokeCurrentSession = async (req, res, next) => {
  try {
    if (req.authSession) {
      await revokeSessionDocument(req.authSession, "user-logout");
    }

    res.status(200).json({
      success: true,
      message: "This device has been signed out.",
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/auth/sessions/:sessionId
const revokeSession = async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim().toLowerCase();

    if (!validSessionId(sessionId)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SESSION_ID",
        message: "Session identifier is invalid.",
        requestId: req.requestId,
      });
    }

    const session = await Session.findOne({
      user: req.user._id,
      sessionId,
      revokedAt: null,
    }).select("+sessionId");

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "The selected session was not found.",
      });
    }

    const isCurrent = req.authSession?.sessionId === sessionId;
    await revokeSessionDocument(session, "user-revoked-device");

    res.status(200).json({
      success: true,
      currentSessionRevoked: isCurrent,
      message: isCurrent
        ? "This device has been signed out."
        : "The selected device has been signed out.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/sessions/logout-others
const logoutOtherSessions = async (req, res, next) => {
  try {
    const currentSessionId = req.authSession?.sessionId;

    if (!currentSessionId) {
      return res.status(409).json({
        success: false,
        code: "MANAGED_SESSION_REQUIRED",
        message: "Refresh this page once, then try again.",
      });
    }

    const result = await Session.updateMany(
      {
        user: req.user._id,
        sessionId: { $ne: currentSessionId },
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokeReason: "logout-other-devices",
        },
      }
    );

    res.status(200).json({
      success: true,
      revokedCount: result.modifiedCount,
      message: `${result.modifiedCount} other session(s) signed out.`,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/sessions/logout-all
const logoutAllSessions = async (req, res, next) => {
  try {
    const result = await Session.updateMany(
      {
        user: req.user._id,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokeReason: "logout-all-devices",
        },
      }
    );

    res.status(200).json({
      success: true,
      revokedCount: result.modifiedCount,
      message: "All devices have been signed out.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startSession,
  refreshSession,
  listSessions,
  updateTrustedSession,
  reportSessionNotMine,
  revokeFromSecurityAlert,
  revokeCurrentSession,
  revokeSession,
  logoutOtherSessions,
  logoutAllSessions,
};
