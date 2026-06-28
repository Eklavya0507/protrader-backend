"use strict";

const SecurityAlert = require("../models/SecurityAlert");
const SecurityAlertPreference = require(
  "../models/SecurityAlertPreference"
);
const SecurityEvent = require("../models/SecurityEvent");
const User = require("../models/User");
const { sendEmail } = require("./sendEmail");

const integerInRange = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
};

const configuration = () => ({
  retentionDays: integerInRange(
    process.env.SECURITY_ALERT_RETENTION_DAYS,
    180,
    30,
    730
  ),
  failedLoginThreshold: integerInRange(
    process.env.SECURITY_ALERT_FAILED_LOGIN_THRESHOLD,
    3,
    2,
    10
  ),
  failedTwoFactorThreshold: integerInRange(
    process.env.SECURITY_ALERT_FAILED_2FA_THRESHOLD,
    3,
    2,
    10
  ),
  detectionWindowMinutes: integerInRange(
    process.env.SECURITY_ALERT_WINDOW_MINUTES,
    15,
    5,
    120
  ),
  cooldownMinutes: integerInRange(
    process.env.SECURITY_ALERT_COOLDOWN_MINUTES,
    60,
    5,
    1440
  ),
});

const getPreferences = async (userId) =>
  SecurityAlertPreference.findOneAndUpdate(
    { user: userId },
    {
      $setOnInsert: {
        user: userId,
        inAppAlerts: true,
        emailCriticalAlerts: true,
        emailWarningAlerts: false,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const publicDevice = (event) =>
  [
    event?.browser || "Unknown browser",
    event?.operatingSystem || "Unknown OS",
    event?.deviceType || "unknown",
  ].join(" · ");

const sendAlertEmail = async ({ user, alert }) => {
  if (!user?.email) return null;

  const occurredAt = new Date(
    alert.createdAt || Date.now()
  ).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const subject =
    alert.severity === "critical"
      ? `Critical ProTrade security alert: ${alert.title}`
      : `ProTrade security alert: ${alert.title}`;

  const text = [
    `Hello ${user.name || "Trader"},`,
    "",
    alert.title,
    alert.message,
    "",
    `Severity: ${alert.severity}`,
    `Device: ${publicDevice(alert)}`,
    `Time: ${occurredAt} IST`,
    "",
    "Open ProTrade Settings > Security to review your security alerts and active devices.",
    "",
    "If you do not recognize this activity, change your password and sign out other devices immediately.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17202a;line-height:1.6">
      <p style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#315dce">PROTRADE ACCOUNT SECURITY</p>
      <h2 style="margin:8px 0">${escapeHtml(alert.title)}</h2>
      <p>${escapeHtml(alert.message)}</p>
      <div style="background:#f4f7fb;border:1px solid #dce4ee;border-radius:12px;padding:18px;margin:20px 0">
        <p style="margin:0 0 8px"><strong>Severity:</strong> ${escapeHtml(alert.severity)}</p>
        <p style="margin:0 0 8px"><strong>Device:</strong> ${escapeHtml(publicDevice(alert))}</p>
        <p style="margin:0"><strong>Time:</strong> ${escapeHtml(occurredAt)} IST</p>
      </div>
      <p>Open <strong>ProTrade → Settings → Security</strong> to review alerts and active devices.</p>
      <p>If you do not recognize this activity, change your password and sign out other devices immediately.</p>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject,
    text,
    html,
    tags: ["protrade-security-alert"],
  });
};

const shouldEmail = ({ severity, type, preferences }) => {
  // New-device email is already sent by the existing managed-session system,
  // so Batch 7 records it in-app without sending a duplicate email.
  if (type === "new_device_session") return false;

  if (severity === "critical") {
    return preferences.emailCriticalAlerts === true;
  }

  if (severity === "warning") {
    return preferences.emailWarningAlerts === true;
  }

  return false;
};

const createAlert = async ({
  userId,
  sourceEvent,
  alertKey,
  type,
  severity,
  title,
  message,
  cooldownMinutes,
  metadata = {},
}) => {
  const preferences = await getPreferences(userId);

  if (preferences.inAppAlerts !== true) {
    return null;
  }

  const cooldownStart = new Date(
    Date.now() - cooldownMinutes * 60 * 1000
  );

  const existing = await SecurityAlert.findOne({
    user: userId,
    alertKey,
    createdAt: { $gte: cooldownStart },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (existing) return null;

  const config = configuration();
  const expiresAt = new Date(
    Date.now() + config.retentionDays * 24 * 60 * 60 * 1000
  );

  const alert = await SecurityAlert.create({
    user: userId,
    sourceEvent: sourceEvent?._id || null,
    alertKey,
    type,
    severity,
    title,
    message,
    browser: sourceEvent?.browser || "Unknown browser",
    operatingSystem:
      sourceEvent?.operatingSystem || "Unknown OS",
    deviceType: sourceEvent?.deviceType || "unknown",
    metadata,
    expiresAt,
  });

  if (
    shouldEmail({
      severity,
      type,
      preferences,
    })
  ) {
    try {
      const user = await User.findById(userId)
        .select("name email")
        .lean();

      await sendAlertEmail({ user, alert });
      alert.emailSent = true;
      alert.emailSentAt = new Date();
      await alert.save({ validateBeforeSave: false });
    } catch (error) {
      console.error(
        "Security alert email failed:",
        error.message
      );
    }
  }

  return alert;
};

const repeatedFailureRule = async ({
  event,
  eventType,
  threshold,
  alertKey,
  type,
  title,
  message,
}) => {
  if (
    event.eventType !== eventType ||
    event.outcome !== "failure"
  ) {
    return null;
  }

  const config = configuration();
  const since = new Date(
    Date.now() - config.detectionWindowMinutes * 60 * 1000
  );

  const count = await SecurityEvent.countDocuments({
    user: event.user,
    eventType,
    outcome: "failure",
    createdAt: { $gte: since },
  });

  if (count < threshold) return null;

  return {
    alertKey,
    type,
    severity: "critical",
    title,
    message: `${message} ${count} unsuccessful attempts were recorded within ${config.detectionWindowMinutes} minutes.`,
    metadata: {
      attemptCount: count,
      windowMinutes: config.detectionWindowMinutes,
    },
  };
};

const ruleForEvent = async (event) => {
  const config = configuration();

  const failedLogin = await repeatedFailureRule({
    event,
    eventType: "sign_in_failed",
    threshold: config.failedLoginThreshold,
    alertKey: "repeated-failed-sign-in",
    type: "repeated_failed_sign_in",
    title: "Repeated failed sign-in attempts",
    message:
      "Someone may be repeatedly trying to access your ProTrade account.",
  });

  if (failedLogin) return failedLogin;

  const failedTwoFactor = await repeatedFailureRule({
    event,
    eventType: "two_factor_sign_in_failed",
    threshold: config.failedTwoFactorThreshold,
    alertKey: "repeated-failed-two-factor",
    type: "repeated_failed_two_factor",
    title: "Repeated incorrect two-factor codes",
    message:
      "Multiple incorrect authenticator or recovery codes were submitted.",
  });

  if (failedTwoFactor) return failedTwoFactor;

  if (
    event.eventType === "session_started" &&
    event.metadata?.newDeviceDetected === true
  ) {
    return {
      alertKey: `new-device-${event.sessionId || "session"}`,
      type: "new_device_session",
      severity: "warning",
      title: "New device session detected",
      message:
        "A managed ProTrade session was created for a device that was not previously recognized.",
      metadata: {
        existingNewDeviceEmailQueued:
          event.metadata?.securityAlertQueued === true,
      },
    };
  }

  const directRules = {
    refresh_token_reuse: {
      alertKey: "refresh-token-reuse",
      type: "refresh_token_reuse",
      severity: "critical",
      title: "Old refresh token was reused",
      message:
        "A device session was revoked because an older refresh token was submitted again.",
    },
    session_reported_not_mine: {
      alertKey: "unknown-device-reported",
      type: "unknown_device_reported",
      severity: "critical",
      title: "A device was reported as unknown",
      message:
        "A device session was marked as not belonging to you and was revoked.",
    },
    password_changed: {
      alertKey: "password-changed",
      type: "password_changed",
      severity: "critical",
      title: "Your ProTrade password was changed",
      message:
        "Your account password changed and older sessions were invalidated.",
    },
    password_reset_completed: {
      alertKey: "password-reset-completed",
      type: "password_reset_completed",
      severity: "critical",
      title: "Your ProTrade password was reset",
      message:
        "A password reset completed and older sessions were invalidated.",
    },
    two_factor_disabled: {
      alertKey: "two-factor-disabled",
      type: "two_factor_disabled",
      severity: "critical",
      title: "Two-factor authentication was disabled",
      message:
        "Authenticator protection was removed from your ProTrade account.",
    },
    email_change_completed: {
      alertKey: "email-changed",
      type: "email_changed",
      severity: "critical",
      title: "Your sign-in email was changed",
      message:
        "The email address used to sign in to ProTrade was changed.",
    },
    recovery_codes_regenerated: {
      alertKey: "recovery-codes-regenerated",
      type: "recovery_codes_regenerated",
      severity: "warning",
      title: "New recovery codes were generated",
      message:
        "Older two-factor recovery codes are no longer valid.",
    },
    two_factor_enabled: {
      alertKey: "two-factor-enabled",
      type: "two_factor_enabled",
      severity: "info",
      title: "Two-factor authentication was enabled",
      message:
        "Authenticator protection is now active on your ProTrade account.",
    },
    all_sessions_revoked: {
      alertKey: "all-sessions-revoked",
      type: "all_sessions_revoked",
      severity: "warning",
      title: "All device sessions were signed out",
      message:
        "Every active ProTrade device session was revoked.",
    },
  };

  return directRules[event.eventType] || null;
};

const evaluateSecurityAlert = async ({ event }) => {
  if (!event?.user || !event?.eventType) return null;

  const rule = await ruleForEvent(event);
  if (!rule) return null;

  const config = configuration();

  return createAlert({
    userId: event.user,
    sourceEvent: event,
    cooldownMinutes:
      rule.type === "new_device_session"
        ? 5
        : config.cooldownMinutes,
    ...rule,
  });
};

const safeEvaluateSecurityAlert = async (payload) => {
  try {
    return await evaluateSecurityAlert(payload);
  } catch (error) {
    console.error(
      "Security alert evaluation failed:",
      error.message
    );
    return null;
  }
};

module.exports = {
  configuration,
  getPreferences,
  createAlert,
  evaluateSecurityAlert,
  safeEvaluateSecurityAlert,
};
