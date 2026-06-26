const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const WINDOW_MINUTES = positiveInteger(
  process.env.LOGIN_RATE_WINDOW_MINUTES,
  15
);

const MAX_REQUESTS = positiveInteger(
  process.env.LOGIN_RATE_MAX_REQUESTS,
  20
);

const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const buckets = new Map();

const getClientKey = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  const ip = (
    String(req.headers["cf-connecting-ip"] || "").trim() ||
    forwarded ||
    String(req.headers["x-real-ip"] || "").trim() ||
    String(req.socket?.remoteAddress || "").trim() ||
    String(req.ip || "").trim() ||
    "unknown"
  ).replace(/^::ffff:/, "");

  return ip.slice(0, 160);
};

const secondsUntil = (timestamp) =>
  Math.max(1, Math.ceil((timestamp - Date.now()) / 1000));

const loginRateLimiter = (req, res, next) => {
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

  // Successful password login can clear this IP's temporary bucket.
  req.resetLoginRateLimit = () => {
    buckets.delete(key);
  };

  if (bucket.count > MAX_REQUESTS) {
    res.set("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      success: false,
      code: "LOGIN_RATE_LIMITED",
      message:
        "Too many sign-in requests from this network. Try again later.",
      retryAfterSeconds,
    });
  }

  next();
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
  loginRateLimiter,
};
