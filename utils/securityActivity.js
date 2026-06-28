"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");

const SecurityEvent = require("../models/SecurityEvent");

const DEFAULT_RETENTION_DAYS = 180;

const integerInRange = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
};

const retentionDays = () =>
  integerInRange(
    process.env.SECURITY_ACTIVITY_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    30,
    730
  );

const activityPepper = () => {
  const value = String(
    process.env.SECURITY_ACTIVITY_PEPPER ||
      process.env.TWO_FACTOR_RECOVERY_PEPPER ||
      process.env.JWT_SECRET ||
      ""
  ).trim();

  if (value.length < 32) {
    throw new Error(
      "SECURITY_ACTIVITY_PEPPER must contain at least 32 characters."
    );
  }

  return value;
};

const normalizeIp = (req) =>
  String(
    req?.ip ||
      req?.headers?.["cf-connecting-ip"] ||
      req?.headers?.["x-forwarded-for"] ||
      req?.socket?.remoteAddress ||
      ""
  )
    .split(",")[0]
    .trim()
    .slice(0, 160);

const hashPrivateValue = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  return crypto
    .createHmac("sha256", activityPepper())
    .update(normalized)
    .digest("hex");
};

const parseUserAgent = (value) => {
  const userAgent = String(value || "").slice(0, 320);
  let browser = "Unknown browser";
  let operatingSystem = "Unknown OS";
  let deviceType = "desktop";

  if (/Edg\//i.test(userAgent)) browser = "Microsoft Edge";
  else if (/OPR\//i.test(userAgent)) browser = "Opera";
  else if (/Chrome\//i.test(userAgent)) browser = "Chrome";
  else if (/Firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/Safari\//i.test(userAgent)) browser = "Safari";

  if (/Windows NT/i.test(userAgent)) operatingSystem = "Windows";
  else if (/Android/i.test(userAgent)) operatingSystem = "Android";
  else if (/iPhone|iPad|iPod/i.test(userAgent)) operatingSystem = "iOS";
  else if (/Mac OS X/i.test(userAgent)) operatingSystem = "macOS";
  else if (/Linux/i.test(userAgent)) operatingSystem = "Linux";

  if (/iPad|Tablet/i.test(userAgent)) deviceType = "tablet";
  else if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) {
    deviceType = "mobile";
  } else if (!userAgent) {
    deviceType = "unknown";
  }

  return {
    userAgent,
    browser,
    operatingSystem,
    deviceType,
  };
};

const validObjectId = (value) =>
  mongoose.isValidObjectId(value) ? value : null;

const cleanMetadata = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const allowedKeys = new Set([
    "route",
    "method",
    "statusCode",
    "provider",
    "sessionAction",
    "completed",
    "recoveryCodeUsed",
  ]);

  const result = {};

  for (const [key, item] of Object.entries(value)) {
    if (!allowedKeys.has(key)) continue;

    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      result[key] =
        typeof item === "string" ? item.slice(0, 160) : item;
    }
  }

  return result;
};

const recordSecurityEvent = async ({
  userId,
  req,
  eventType,
  outcome = "success",
  severity = "info",
  title,
  message = "",
  sessionId = "",
  metadata = {},
}) => {
  const safeUserId = validObjectId(userId);

  if (!safeUserId) return null;

  const agent = parseUserAgent(req?.headers?.["user-agent"]);
  const expiresAt = new Date(
    Date.now() + retentionDays() * 24 * 60 * 60 * 1000
  );

  return SecurityEvent.create({
    user: safeUserId,
    eventType: String(eventType || "").slice(0, 80),
    outcome,
    severity,
    title: String(title || "Security activity").slice(0, 140),
    message: String(message || "").slice(0, 500),
    requestId: String(req?.requestId || "").slice(0, 128),
    sessionId: String(
      sessionId || req?.authSession?.sessionId || ""
    ).slice(0, 128),
    clientDeviceIdHash: hashPrivateValue(
      req?.headers?.["x-client-device-id"]
    ),
    ipAddressHash: hashPrivateValue(normalizeIp(req)),
    ...agent,
    metadata: cleanMetadata(metadata),
    expiresAt,
  });
};

const safeRecordSecurityEvent = async (payload) => {
  try {
    return await recordSecurityEvent(payload);
  } catch (error) {
    console.error("Security activity logging failed:", error.message);
    return null;
  }
};

module.exports = {
  retentionDays,
  hashPrivateValue,
  parseUserAgent,
  recordSecurityEvent,
  safeRecordSecurityEvent,
};
