const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Session = require("../models/Session");

const protect = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Bearer token is missing.",
      });
    }

    const token = authorization.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is missing.",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing from environment variables");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "The account connected to this token is unavailable.",
      });
    }

    const decodedTokenVersion = Number.isInteger(decoded.tokenVersion)
      ? decoded.tokenVersion
      : 0;

    if (decodedTokenVersion !== user.tokenVersion) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message:
          "This session is no longer valid. Please sign in with your latest password.",
      });
    }

    req.user = user;
    req.authToken = decoded;
    req.authSession = null;
    req.isLegacySession = !decoded.sessionId;

    // Tokens created before Device & Session Management are allowed only so
    // the frontend can upgrade them into a managed session.
    if (!decoded.sessionId) {
      return next();
    }

    const session = await Session.findOne({
      user: user._id,
      sessionId: decoded.sessionId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
      tokenVersion: user.tokenVersion || 0,
    }).select("+sessionId");

    if (!session) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "This device session has expired or was signed out.",
      });
    }

    req.authSession = session;
    req.isLegacySession = false;

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (!session.lastActiveAt || session.lastActiveAt.getTime() < fiveMinutesAgo) {
      Session.updateOne(
        { _id: session._id, revokedAt: null },
        { $set: { lastActiveAt: new Date() } }
      ).catch((error) => {
        console.warn("Session activity update failed:", error.message);
      });
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        code: "ACCESS_TOKEN_EXPIRED",
        message: "Your access token has expired.",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        code: "INVALID_ACCESS_TOKEN",
        message: "Invalid authentication token.",
      });
    }

    next(error);
  }
};

module.exports = { protect };
