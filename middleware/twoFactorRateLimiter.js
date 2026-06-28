"use strict";

const crypto = require("crypto");

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const entries = new Map();

const hashValue = (value) =>
  crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 24);

const getClientIp = (req) =>
  String(
    req.ip ||
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown"
  )
    .split(",")[0]
    .trim();

const getKey = (req) => {
  const challengeToken = String(req.body?.challengeToken || "");
  return `${getClientIp(req)}:${hashValue(challengeToken || "no-challenge")}`;
};

const cleanup = () => {
  const now = Date.now();

  for (const [key, entry] of entries.entries()) {
    if (entry.resetAt <= now) {
      entries.delete(key);
    }
  }
};

const twoFactorRateLimiter = (req, res, next) => {
  cleanup();

  const key = getKey(req);
  const now = Date.now();
  let entry = entries.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 0,
      resetAt: now + WINDOW_MS,
    };
  }

  entry.count += 1;
  entries.set(key, entry);

  const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((entry.resetAt - now) / 1000)
  );

  res.set("X-RateLimit-Limit", String(MAX_ATTEMPTS));
  res.set("X-RateLimit-Remaining", String(remaining));
  res.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > MAX_ATTEMPTS) {
    res.set("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      success: false,
      code: "TWO_FACTOR_RATE_LIMITED",
      message:
        "Too many two-factor verification attempts. Try again later.",
      retryAfterSeconds,
    });
  }

  req.resetTwoFactorRateLimit = () => {
    entries.delete(key);
  };

  next();
};

setInterval(cleanup, WINDOW_MS).unref();

module.exports = {
  twoFactorRateLimiter,
};
