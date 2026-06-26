const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const WINDOW_MINUTES = positiveInteger(
  process.env.API_RATE_WINDOW_MINUTES,
  15
);

const MAX_REQUESTS = positiveInteger(
  process.env.API_RATE_MAX_REQUESTS,
  600
);

const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const buckets = new Map();

const normaliseIp = (value) =>
  String(value || "")
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "")
    .slice(0, 160);

const getClientKey = (req) => {
  // req.ip is reliable on Render because server.js trusts exactly one proxy hop.
  return (
    normaliseIp(req.ip) ||
    normaliseIp(req.socket?.remoteAddress) ||
    "unknown"
  );
};

const secondsUntil = (timestamp) =>
  Math.max(1, Math.ceil((timestamp - Date.now()) / 1000));

const shouldSkip = (req) => {
  if (req.method === "OPTIONS") {
    return true;
  }

  return req.originalUrl === "/api/health";
};

const apiRateLimiter = (req, res, next) => {
  if (shouldSkip(req)) {
    return next();
  }

  const now = Date.now();
  const key = getClientKey(req);
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = {
      count: 0,
      resetAt: now + WINDOW_MS,
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
  const retryAfterSeconds = secondsUntil(bucket.resetAt);

  res.set("RateLimit-Limit", String(MAX_REQUESTS));
  res.set("RateLimit-Remaining", String(remaining));
  res.set("RateLimit-Reset", String(retryAfterSeconds));

  if (bucket.count > MAX_REQUESTS) {
    res.set("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      success: false,
      code: "API_RATE_LIMITED",
      message: "Too many requests. Please try again later.",
      retryAfterSeconds,
      requestId: req.requestId,
    });
  }

  return next();
};

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, Math.min(WINDOW_MS, 5 * 60 * 1000));

cleanupTimer.unref?.();

module.exports = {
  apiRateLimiter,
};
