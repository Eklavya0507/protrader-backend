"use strict";

const User = require("../models/User");
const AccountAction = require("../models/AccountAction");
const SecurityEvent = require("../models/SecurityEvent");
const {
  verifyTwoFactorLoginChallenge,
} = require("../utils/twoFactor");
const {
  safeRecordSecurityEvent,
} = require("../utils/securityActivity");

const normalizedPath = (req) =>
  String(req.originalUrl || req.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";

const safeResponseSnapshot = (body) => ({
  success: body?.success === true,
  code: String(body?.code || "").slice(0, 100),
  message: String(body?.message || "").slice(0, 300),
  requiresTwoFactor: body?.requiresTwoFactor === true,
  completed: body?.completed === true,
  recoveryCodesRemaining: Number.isInteger(
    body?.recoveryCodesRemaining
  )
    ? body.recoveryCodesRemaining
    : null,
  dataId: String(body?.data?.id || body?.data?._id || ""),
  dataEmail: String(body?.data?.email || ""),
});

const activityDescriptor = (req, statusCode, body) => {
  const path = normalizedPath(req);
  const method = String(req.method || "GET").toUpperCase();
  const failed = statusCode >= 400 || body?.success === false;
  const outcome = failed ? "failure" : "success";
  const failureMessage =
    body?.message || "The security action was not completed.";

  const item = (
    eventType,
    successTitle,
    failureTitle,
    severity = failed ? "warning" : "info"
  ) => ({
    eventType,
    outcome,
    severity,
    title: failed ? failureTitle : successTitle,
    message: failed ? failureMessage : body?.message || "",
  });

  if (path === "/api/auth/register" && method === "POST") {
    return item(
      "account_created",
      "ProTrade account created",
      "Account registration attempt failed"
    );
  }

  if (path === "/api/auth/login" && method === "POST") {
    if (!failed && body?.requiresTwoFactor) {
      return {
        eventType: "two_factor_challenge_issued",
        outcome: "success",
        severity: "info",
        title: "Password accepted; 2FA required",
        message: "A two-factor sign-in challenge was issued.",
      };
    }

    return item(
      failed ? "sign_in_failed" : "sign_in_success",
      "Signed in with password",
      "Password sign-in attempt failed"
    );
  }

  if (path === "/api/auth/google" && method === "POST") {
    if (!failed && body?.requiresTwoFactor) {
      return {
        eventType: "two_factor_challenge_issued",
        outcome: "success",
        severity: "info",
        title: "Google sign-in requires 2FA",
        message: "A two-factor sign-in challenge was issued.",
      };
    }

    return item(
      failed ? "google_sign_in_failed" : "google_sign_in_success",
      "Signed in with Google",
      "Google sign-in attempt failed"
    );
  }

  if (
    path === "/api/auth/2fa/login/verify" &&
    method === "POST"
  ) {
    return item(
      failed
        ? "two_factor_sign_in_failed"
        : "two_factor_sign_in_success",
      "Two-factor sign-in verified",
      "Two-factor sign-in attempt failed",
      failed ? "warning" : "info"
    );
  }

  if (path === "/api/auth/2fa/setup" && method === "POST") {
    return item(
      "two_factor_setup_started",
      "Authenticator setup started",
      "Authenticator setup could not start"
    );
  }

  if (path === "/api/auth/2fa/enable" && method === "POST") {
    return item(
      "two_factor_enabled",
      "Two-factor authentication enabled",
      "Two-factor authentication enable attempt failed",
      failed ? "warning" : "critical"
    );
  }

  if (path === "/api/auth/2fa/disable" && method === "POST") {
    return item(
      "two_factor_disabled",
      "Two-factor authentication disabled",
      "Two-factor authentication disable attempt failed",
      "critical"
    );
  }

  if (
    path === "/api/auth/2fa/recovery-codes/regenerate" &&
    method === "POST"
  ) {
    return item(
      "recovery_codes_regenerated",
      "Recovery codes regenerated",
      "Recovery-code regeneration failed",
      failed ? "warning" : "critical"
    );
  }

  if (
    path === "/api/auth/change-password" &&
    method === "PUT"
  ) {
    return item(
      "password_changed",
      "Password changed",
      "Password change attempt failed",
      "critical"
    );
  }

  if (
    path === "/api/auth/forgot-password" &&
    method === "POST"
  ) {
    return item(
      "password_reset_requested",
      "Password reset requested",
      "Password-reset request failed"
    );
  }

  if (
    path === "/api/auth/reset-password" &&
    method === "POST"
  ) {
    return item(
      "password_reset_completed",
      "Password reset completed",
      "Password reset attempt failed",
      failed ? "warning" : "critical"
    );
  }

  if (path === "/api/auth/me" && method === "PUT") {
    return item(
      "profile_updated",
      "Profile updated",
      "Profile update failed"
    );
  }

  if (
    path === "/api/auth/sessions/start" &&
    method === "POST"
  ) {
    return item(
      "session_started",
      "Secure device session started",
      "Secure session start failed"
    );
  }

  if (
    /^\/api\/auth\/sessions\/[^/]+\/trust$/.test(path) &&
    method === "PATCH"
  ) {
    return item(
      "session_trust_changed",
      "Device trust setting changed",
      "Device trust change failed",
      failed ? "warning" : "info"
    );
  }

  if (
    /^\/api\/auth\/sessions\/[^/]+\/not-me$/.test(path) &&
    method === "POST"
  ) {
    return item(
      "session_reported_not_mine",
      "Unknown device reported",
      "Unknown-device report failed",
      "critical"
    );
  }

  if (
    path === "/api/auth/sessions/logout-others" &&
    method === "POST"
  ) {
    return item(
      "other_sessions_revoked",
      "Other devices signed out",
      "Other-device sign-out failed",
      "critical"
    );
  }

  if (
    path === "/api/auth/sessions/logout-all" &&
    method === "POST"
  ) {
    return item(
      "all_sessions_revoked",
      "All devices signed out",
      "All-device sign-out failed",
      "critical"
    );
  }

  if (
    (path === "/api/auth/sessions/current" &&
      method === "DELETE") ||
    (path === "/api/auth/logout" && method === "POST")
  ) {
    return item(
      "signed_out",
      "Current device signed out",
      "Sign-out request failed"
    );
  }

  if (
    /^\/api\/auth\/sessions\/[^/]+$/.test(path) &&
    method === "DELETE"
  ) {
    return item(
      "session_revoked",
      "Device session revoked",
      "Device-session revoke failed",
      "critical"
    );
  }

  if (
    path === "/api/account/email-change/request" &&
    method === "POST"
  ) {
    return item(
      "email_change_requested",
      "Sign-in email change requested",
      "Email-change request failed",
      failed ? "warning" : "critical"
    );
  }

  if (
    path === "/api/account/email-change/cancel" &&
    method === "POST"
  ) {
    return item(
      "email_change_canceled",
      "Email-change request canceled",
      "Email-change cancellation failed"
    );
  }

  if (
    path === "/api/account/email-change/confirm" &&
    method === "POST" &&
    body?.completed
  ) {
    return item(
      "email_change_completed",
      "Sign-in email changed",
      "Email-change confirmation failed",
      "critical"
    );
  }

  if (
    path === "/api/account/export" &&
    method === "GET"
  ) {
    return item(
      "account_data_exported",
      "Account data downloaded",
      "Account-data export failed"
    );
  }

  return null;
};

const findUserId = async (req, responseBody) => {
  if (req.user?._id) return req.user._id;

  if (responseBody?.dataId) {
    return responseBody.dataId;
  }

  const challengeToken = String(
    req.body?.challengeToken || ""
  ).trim();

  if (challengeToken) {
    try {
      return verifyTwoFactorLoginChallenge(challengeToken).sub;
    } catch {
      // Invalid challenges intentionally remain unattributed.
    }
  }

  const actionId = String(req.body?.id || "").trim();

  if (actionId) {
    const action = await AccountAction.findById(actionId)
      .select("user")
      .lean()
      .catch(() => null);

    if (action?.user) return action.user;
  }

  const email = String(
    req.body?.email ||
      responseBody?.dataEmail ||
      ""
  )
    .trim()
    .toLowerCase();

  if (email) {
    const user = await User.findOne({ email })
      .select("_id")
      .lean()
      .catch(() => null);

    if (user?._id) return user._id;
  }

  return null;
};

const securityActivityLogger = (req, res, next) => {
  const path = normalizedPath(req);

  if (path.startsWith("/api/security/")) {
    return next();
  }

  let responseBody = null;
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    responseBody = safeResponseSnapshot(body);
    return originalJson(body);
  };

  res.on("finish", () => {
    setImmediate(async () => {
      try {
        if (
          path === "/api/account" &&
          req.method === "DELETE" &&
          res.statusCode < 400 &&
          req.user?._id
        ) {
          await SecurityEvent.deleteMany({
            user: req.user._id,
          });
          return;
        }

        const descriptor = activityDescriptor(
          req,
          res.statusCode,
          responseBody
        );

        if (!descriptor) return;

        const userId = await findUserId(req, responseBody);
        if (!userId) return;

        await safeRecordSecurityEvent({
          userId,
          req,
          ...descriptor,
          metadata: {
            route: path,
            method: req.method,
            statusCode: res.statusCode,
            provider:
              path === "/api/auth/google"
                ? "google"
                : path === "/api/auth/login"
                  ? "password"
                  : "",
            completed: responseBody?.completed === true,
            recoveryCodeUsed:
              responseBody?.recoveryCodesRemaining !== null,
          },
        });
      } catch (error) {
        console.error(
          "Security activity middleware failed:",
          error.message
        );
      }
    });
  });

  next();
};

module.exports = {
  securityActivityLogger,
};
