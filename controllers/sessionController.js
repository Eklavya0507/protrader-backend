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
});

// POST /api/auth/sessions/start
// Upgrades a valid legacy JWT into a managed device session.
const startSession = async (req, res) => {
  try {
    const result = await createSession({
      user: req.user,
      req,
      revokeSession: req.authSession,
    });

    req.user.lastLoginAt = new Date();
    await req.user.save({ validateBeforeSave: false });

    res.status(201).json({
      success: true,
      message: result.session.isNewDevice
        ? "Secure session created for a new device."
        : "Secure device session created.",
      ...sessionResponse(result),
      data: publicUser(req.user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "A secure device session could not be created.",
    });
  }
};

// POST /api/auth/sessions/refresh
const refreshSession = async (req, res) => {
  try {
    const parsed = parseRefreshToken(req.body.refreshToken);

    if (!parsed) {
      return res.status(401).json({
        success: false,
        code: "INVALID_REFRESH_TOKEN",
        message: "The refresh token is invalid.",
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
      });
    }

    const suppliedHash = hashValue(parsed.value);

    if (!safeEqualHex(suppliedHash, session.refreshTokenHash)) {
      await revokeSessionDocument(session, "refresh-token-reuse");

      return res.status(401).json({
        success: false,
        code: "REFRESH_TOKEN_REUSED",
        message:
          "This session was revoked because an old refresh token was reused.",
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
    res.status(500).json({
      success: false,
      message: "The session could not be refreshed.",
    });
  }
};

// GET /api/auth/sessions
const listSessions = async (req, res) => {
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
        isCurrent: session.sessionId === currentSessionId,
        signedInAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        expiresAt: session.expiresAt,
      })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Active sessions could not be loaded.",
    });
  }
};

// DELETE /api/auth/sessions/current
const revokeCurrentSession = async (req, res) => {
  try {
    if (req.authSession) {
      await revokeSessionDocument(req.authSession, "user-logout");
    }

    res.status(200).json({
      success: true,
      message: "This device has been signed out.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "This device could not be signed out.",
    });
  }
};

// DELETE /api/auth/sessions/:sessionId
const revokeSession = async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(sessionId)) {
      return res.status(400).json({
        success: false,
        message: "Session identifier is invalid.",
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
    res.status(500).json({
      success: false,
      message: "The selected session could not be revoked.",
    });
  }
};

// POST /api/auth/sessions/logout-others
const logoutOtherSessions = async (req, res) => {
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
    res.status(500).json({
      success: false,
      message: "Other sessions could not be signed out.",
    });
  }
};

// POST /api/auth/sessions/logout-all
const logoutAllSessions = async (req, res) => {
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
    res.status(500).json({
      success: false,
      message: "All sessions could not be signed out.",
    });
  }
};

module.exports = {
  startSession,
  refreshSession,
  listSessions,
  revokeCurrentSession,
  revokeSession,
  logoutOtherSessions,
  logoutAllSessions,
};
