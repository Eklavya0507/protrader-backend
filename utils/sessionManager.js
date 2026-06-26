const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const Session = require("../models/Session");

const positiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const ACCESS_TOKEN_SECONDS = positiveInteger(
  process.env.ACCESS_TOKEN_SECONDS,
  15 * 60
);

const REFRESH_SESSION_DAYS = positiveInteger(
  process.env.REFRESH_SESSION_DAYS,
  30
);

const MAX_ACTIVE_SESSIONS = positiveInteger(
  process.env.MAX_ACTIVE_SESSIONS,
  10
);

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const hashPrivateValue = (value) =>
  crypto
    .createHmac(
      "sha256",
      process.env.JWT_SECRET || "protrade-private-session-metadata"
    )
    .update(String(value))
    .digest("hex");

const safeEqualHex = (left, right) => {
  try {
    const leftBuffer = Buffer.from(String(left), "hex");
    const rightBuffer = Buffer.from(String(right), "hex");

    if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
      return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
};

const getClientIp = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return (
    forwarded ||
    String(req.headers["x-real-ip"] || "").trim() ||
    String(req.socket?.remoteAddress || "").trim() ||
    String(req.ip || "").trim()
  ).replace(/^::ffff:/, "");
};

const maskIpAddress = (ip) => {
  if (!ip) return "Unavailable";

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 4).join(":")}::`;
  }

  return "Unavailable";
};

const parseUserAgent = (userAgent = "") => {
  const ua = String(userAgent);

  let browser = "Unknown browser";
  if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/FxiOS\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  let operatingSystem = "Unknown OS";
  if (/Windows NT/i.test(ua)) operatingSystem = "Windows";
  else if (/Android/i.test(ua)) operatingSystem = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystem = "iOS";
  else if (/Mac OS X/i.test(ua)) operatingSystem = "macOS";
  else if (/Linux/i.test(ua)) operatingSystem = "Linux";

  let deviceType = "desktop";
  if (/iPad|Tablet/i.test(ua)) deviceType = "tablet";
  else if (/Mobi|Android|iPhone|iPod/i.test(ua)) deviceType = "mobile";
  else if (!ua) deviceType = "unknown";

  return {
    browser,
    operatingSystem,
    deviceType,
    deviceName: `${browser} on ${operatingSystem}`,
  };
};

const getApproximateLocation = (req) => {
  const rawCity = String(
    req.headers["cf-ipcity"] ||
      req.headers["x-vercel-ip-city"] ||
      req.headers["x-appengine-city"] ||
      ""
  );

  let city = rawCity;
  try {
    city = decodeURIComponent(rawCity);
  } catch {
    city = rawCity;
  }
  city = city.trim();

  const country = String(
    req.headers["cf-ipcountry"] ||
      req.headers["x-vercel-ip-country"] ||
      req.headers["x-appengine-country"] ||
      ""
  ).trim();

  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  return "Location unavailable";
};

const getTimezone = (req) => {
  const timezone = String(req.headers["x-client-timezone"] || "").trim();
  return timezone.slice(0, 120) || "Timezone unavailable";
};

const getClientDeviceId = (req) => {
  const value = String(req.headers["x-client-device-id"] || "").trim();
  return /^[a-zA-Z0-9._:-]{16,160}$/.test(value) ? value : "";
};

const getSessionMetadata = (req) => {
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 1000);
  const parsed = parseUserAgent(userAgent);
  const ipAddress = getClientIp(req);
  const ipAddressHash = hashPrivateValue(ipAddress || "unknown-ip");
  const timezone = getTimezone(req);
  const clientDeviceId = getClientDeviceId(req);
  const legacyFingerprintHash = hashValue(`${userAgent}|${timezone}`);
  const fingerprintHash = clientDeviceId
    ? hashPrivateValue(`device:${clientDeviceId}`)
    : legacyFingerprintHash;

  return {
    ...parsed,
    userAgent,
    ipAddressMasked: maskIpAddress(ipAddress),
    ipAddressHash,
    approximateLocation: getApproximateLocation(req),
    timezone,
    fingerprintHash,
    legacyFingerprintHash,
  };
};

const getRefreshExpiry = () =>
  new Date(Date.now() + REFRESH_SESSION_DAYS * 24 * 60 * 60 * 1000);

const createAccessToken = (user, sessionId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables");
  }

  return jwt.sign(
    {
      id: user._id,
      tokenVersion: user.tokenVersion || 0,
      sessionId,
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_SECONDS }
  );
};

const createRefreshToken = (sessionId) => {
  const secret = crypto.randomBytes(48).toString("hex");
  return `${sessionId}.${secret}`;
};

const parseRefreshToken = (refreshToken) => {
  const value = String(refreshToken || "").trim();
  const [sessionId, secret, ...extra] = value.split(".");

  if (
    extra.length > 0 ||
    !/^[a-f0-9]{64}$/i.test(sessionId || "") ||
    !/^[a-f0-9]{96}$/i.test(secret || "")
  ) {
    return null;
  }

  return { sessionId: sessionId.toLowerCase(), value };
};

const revokeSessionDocument = async (session, reason = "revoked") => {
  if (!session || session.revokedAt) return;
  session.revokedAt = new Date();
  session.revokeReason = reason;
  await session.save({ validateBeforeSave: false });
};

const enforceSessionLimit = async (userId, keepSessionId) => {
  if (!Number.isFinite(MAX_ACTIVE_SESSIONS) || MAX_ACTIVE_SESSIONS < 1) {
    return;
  }

  const activeSessions = await Session.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActiveAt: -1 })
    .select("+sessionId");

  const sessionsToRevoke = activeSessions.slice(MAX_ACTIVE_SESSIONS);

  if (sessionsToRevoke.length === 0) return;

  await Session.updateMany(
    {
      _id: { $in: sessionsToRevoke.map((session) => session._id) },
      sessionId: { $ne: keepSessionId },
    },
    {
      $set: {
        revokedAt: new Date(),
        revokeReason: "session-limit",
      },
    }
  );
};

const createSession = async ({ user, req, revokeSession = null }) => {
  if (revokeSession) {
    await revokeSessionDocument(revokeSession, "replaced");
  }

  const metadata = getSessionMetadata(req);
  const { legacyFingerprintHash, ...storedMetadata } = metadata;
  const fingerprintCandidates = [
    metadata.fingerprintHash,
    legacyFingerprintHash,
  ].filter(Boolean);

  const [previousMatchingSession, hasSessionHistory] = await Promise.all([
    Session.findOne({
      user: user._id,
      fingerprintHash: { $in: fingerprintCandidates },
    })
      .sort({ createdAt: -1 })
      .select("+fingerprintHash")
      .lean(),
    Session.exists({ user: user._id }),
  ]);

  // Existing pre-Batch-3 sessions have no isTrusted value. Treat those as
  // trusted so current users are not surprised by a false security alert.
  const inheritedTrusted = previousMatchingSession
    ? previousMatchingSession.isTrusted !== false
    : !hasSessionHistory;

  const isNewDevice = Boolean(hasSessionHistory && !previousMatchingSession);
  const sessionId = crypto.randomBytes(32).toString("hex");
  const refreshToken = createRefreshToken(sessionId);

  const session = await Session.create({
    user: user._id,
    sessionId,
    refreshTokenHash: hashValue(refreshToken),
    tokenVersion: user.tokenVersion || 0,
    ...storedMetadata,
    isNewDevice,
    isTrusted: inheritedTrusted,
    trustedAt: inheritedTrusted ? new Date() : null,
    lastActiveAt: new Date(),
    expiresAt: getRefreshExpiry(),
  });

  await enforceSessionLimit(user._id, sessionId);

  return {
    session,
    token: createAccessToken(user, sessionId),
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_SECONDS,
  };
};

const rotateRefreshToken = async ({ session, user, req }) => {
  const refreshToken = createRefreshToken(session.sessionId);
  const metadata = getSessionMetadata(req);

  session.refreshTokenHash = hashValue(refreshToken);
  session.lastActiveAt = new Date();
  session.expiresAt = getRefreshExpiry();
  session.tokenVersion = user.tokenVersion || 0;
  session.timezone = metadata.timezone;
  session.approximateLocation = metadata.approximateLocation;
  session.ipAddressMasked = metadata.ipAddressMasked;
  session.ipAddressHash = metadata.ipAddressHash;
  session.userAgent = metadata.userAgent;
  session.fingerprintHash = metadata.fingerprintHash;
  session.browser = metadata.browser;
  session.operatingSystem = metadata.operatingSystem;
  session.deviceType = metadata.deviceType;
  session.deviceName = metadata.deviceName;

  await session.save({ validateBeforeSave: false });

  return {
    token: createAccessToken(user, session.sessionId),
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_SECONDS,
  };
};


const revokeAllUserSessions = async (
  userId,
  reason = "account-security-change"
) => {
  if (!userId) return 0;

  const result = await Session.updateMany(
    {
      user: userId,
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokeReason: String(reason || "account-security-change").slice(0, 120),
      },
    }
  );

  return result.modifiedCount;
};

module.exports = {
  ACCESS_TOKEN_SECONDS,
  REFRESH_SESSION_DAYS,
  hashValue,
  safeEqualHex,
  parseRefreshToken,
  createSession,
  createAccessToken,
  rotateRefreshToken,
  revokeSessionDocument,
  revokeAllUserSessions,
  getSessionMetadata,
};
