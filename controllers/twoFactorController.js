"use strict";

const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");

const User = require("../models/User");
const { revokeAllUserSessions } = require("../utils/sessionManager");
const {
  assertTwoFactorConfiguration,
  encryptSecret,
  decryptSecret,
  generateAuthenticatorSecret,
  createAuthenticatorUri,
  verifyAuthenticatorCode,
  hashRecoveryCode,
  generateRecoveryCodes,
  recoveryCodeMatches,
  verifyTwoFactorLoginChallenge,
} = require("../utils/twoFactor");

const SETUP_EXPIRY_MINUTES = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const accessTokenFor = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables");
  }

  return jwt.sign(
    {
      id: user._id,
      tokenVersion: Number(user.tokenVersion || 0),
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
};

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
  twoFactorEnabled: user.twoFactorEnabled === true,
  updatedAt: user.updatedAt,
});

const revokeSessions = async (userId, reason) => {
  try {
    await revokeAllUserSessions(userId, reason);
  } catch (error) {
    console.warn("2FA session cleanup failed:", error.message);
  }
};

const activeLockSeconds = (user) => {
  if (
    !(user.twoFactorLockUntil instanceof Date) ||
    user.twoFactorLockUntil.getTime() <= Date.now()
  ) {
    return 0;
  }

  return Math.max(
    1,
    Math.ceil((user.twoFactorLockUntil.getTime() - Date.now()) / 1000)
  );
};

const normalizeExpiredLock = (user) => {
  if (
    user.twoFactorLockUntil instanceof Date &&
    user.twoFactorLockUntil.getTime() <= Date.now()
  ) {
    user.twoFactorFailedAttempts = 0;
    user.twoFactorLockUntil = null;
  }
};

const recordFailedAttempt = async (user) => {
  normalizeExpiredLock(user);

  user.twoFactorFailedAttempts =
    Number(user.twoFactorFailedAttempts || 0) + 1;

  let locked = false;

  if (user.twoFactorFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    user.twoFactorFailedAttempts = MAX_FAILED_ATTEMPTS;
    user.twoFactorLockUntil = new Date(
      Date.now() + LOCK_MINUTES * 60 * 1000
    );
    locked = true;
  }

  await user.save({ validateBeforeSave: false });

  return {
    locked,
    attemptsRemaining: Math.max(
      0,
      MAX_FAILED_ATTEMPTS - user.twoFactorFailedAttempts
    ),
    retryAfterSeconds: activeLockSeconds(user),
  };
};

const clearFailedAttempts = (user) => {
  user.twoFactorFailedAttempts = 0;
  user.twoFactorLockUntil = null;
};

const verifyPasswordWhenPresent = async (user, currentPassword) => {
  if (!user.password) {
    return true;
  }

  if (!String(currentPassword || "")) {
    return false;
  }

  return user.comparePassword(String(currentPassword));
};

const findRecoveryCodeIndex = (hashes, code) =>
  (Array.isArray(hashes) ? hashes : []).findIndex((storedHash) =>
    recoveryCodeMatches(storedHash, code)
  );

const verifyUserCode = ({ user, code, secret }) => {
  const authenticatorResult = verifyAuthenticatorCode({
    secret,
    code,
    lastUsedCounter: user.twoFactorLastUsedCounter,
  });

  if (authenticatorResult.valid) {
    return {
      valid: true,
      method: "authenticator",
      counter: authenticatorResult.counter,
      recoveryIndex: -1,
    };
  }

  const recoveryIndex = findRecoveryCodeIndex(
    user.twoFactorRecoveryCodeHashes,
    code
  );

  if (recoveryIndex >= 0) {
    return {
      valid: true,
      method: "recovery",
      counter: null,
      recoveryIndex,
    };
  }

  return {
    valid: false,
    method: null,
    counter: null,
    recoveryIndex: -1,
    replayed: authenticatorResult.replayed === true,
  };
};

const getTwoFactorStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "+twoFactorRecoveryCodeHashes"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        enabled: user.twoFactorEnabled === true,
        enabledAt: user.twoFactorEnabledAt || null,
        lastUsedAt: user.twoFactorLastUsedAt || null,
        recoveryCodesRemaining: Array.isArray(
          user.twoFactorRecoveryCodeHashes
        )
          ? user.twoFactorRecoveryCodeHashes.length
          : 0,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Two-factor status could not be loaded.",
    });
  }
};

const startTwoFactorSetup = async (req, res) => {
  try {
    assertTwoFactorConfiguration();

    const user = await User.findById(req.user._id).select(
      "+password +twoFactorPendingSecretEncrypted +twoFactorPendingExpires"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (user.twoFactorEnabled === true) {
      return res.status(409).json({
        success: false,
        code: "TWO_FACTOR_ALREADY_ENABLED",
        message: "Authenticator two-factor authentication is already enabled.",
      });
    }

    const passwordValid = await verifyPasswordWhenPresent(
      user,
      req.body.currentPassword
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: user.password
          ? "Current password is incorrect."
          : "Account verification failed.",
      });
    }

    const secret = generateAuthenticatorSecret();
    const otpauthUrl = createAuthenticatorUri({
      email: user.email,
      secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
    });

    user.twoFactorPendingSecretEncrypted = encryptSecret(secret);
    user.twoFactorPendingExpires = new Date(
      Date.now() + SETUP_EXPIRY_MINUTES * 60 * 1000
    );

    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message:
        "Scan the QR code, then enter the current six-digit authenticator code.",
      data: {
        qrCodeDataUrl,
        manualKey: secret,
        otpauthUrl,
        expiresInSeconds: SETUP_EXPIRY_MINUTES * 60,
      },
    });
  } catch (error) {
    console.error("2FA setup failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Two-factor setup could not be started.",
    });
  }
};

const enableTwoFactor = async (req, res) => {
  try {
    assertTwoFactorConfiguration();

    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authenticator code is required.",
      });
    }

    const user = await User.findById(req.user._id).select(
      [
        "+twoFactorPendingSecretEncrypted",
        "+twoFactorPendingExpires",
        "+twoFactorRecoveryCodeHashes",
        "+twoFactorLastUsedCounter",
      ].join(" ")
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (user.twoFactorEnabled === true) {
      return res.status(409).json({
        success: false,
        message: "Two-factor authentication is already enabled.",
      });
    }

    if (
      !user.twoFactorPendingSecretEncrypted ||
      !(user.twoFactorPendingExpires instanceof Date) ||
      user.twoFactorPendingExpires.getTime() <= Date.now()
    ) {
      user.twoFactorPendingSecretEncrypted = null;
      user.twoFactorPendingExpires = null;
      await user.save({ validateBeforeSave: false });

      return res.status(400).json({
        success: false,
        code: "TWO_FACTOR_SETUP_EXPIRED",
        message: "Two-factor setup expired. Start setup again.",
      });
    }

    const secret = decryptSecret(
      user.twoFactorPendingSecretEncrypted
    );
    const result = verifyAuthenticatorCode({
      secret,
      code,
      lastUsedCounter: null,
    });

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: "Authenticator code is invalid.",
      });
    }

    const recoveryCodes = generateRecoveryCodes();

    user.twoFactorEnabled = true;
    user.twoFactorSecretEncrypted = encryptSecret(secret);
    user.twoFactorPendingSecretEncrypted = null;
    user.twoFactorPendingExpires = null;
    user.twoFactorRecoveryCodeHashes =
      recoveryCodes.map(hashRecoveryCode);
    user.twoFactorEnabledAt = new Date();
    user.twoFactorLastUsedAt = new Date();
    user.twoFactorLastUsedCounter = result.counter;
    clearFailedAttempts(user);
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;

    await user.save({ validateBeforeSave: false });
    await revokeSessions(user._id, "two-factor-enabled");

    return res.status(200).json({
      success: true,
      message:
        "Two-factor authentication enabled. Save the recovery codes now.",
      token: accessTokenFor(user),
      data: publicUser(user),
      recoveryCodes,
    });
  } catch (error) {
    console.error("Enable 2FA failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Two-factor authentication could not be enabled.",
    });
  }
};

const verifyTwoFactorLogin = async (req, res) => {
  try {
    assertTwoFactorConfiguration();

    const challengeToken = String(
      req.body.challengeToken || ""
    ).trim();
    const code = String(req.body.code || "").trim();

    if (!challengeToken || !code) {
      return res.status(400).json({
        success: false,
        message: "Two-factor challenge and code are required.",
      });
    }

    let challenge;

    try {
      challenge = verifyTwoFactorLoginChallenge(challengeToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        code: "TWO_FACTOR_CHALLENGE_INVALID",
        message: "Two-factor challenge is invalid or expired.",
      });
    }

    const user = await User.findById(challenge.sub).select(
      [
        "+twoFactorSecretEncrypted",
        "+twoFactorRecoveryCodeHashes",
        "+twoFactorLastUsedCounter",
        "+twoFactorFailedAttempts",
        "+twoFactorLockUntil",
      ].join(" ")
    );

    if (
      !user ||
      !user.isActive ||
      user.twoFactorEnabled !== true ||
      !user.twoFactorSecretEncrypted ||
      Number(user.tokenVersion || 0) !==
        Number(challenge.tokenVersion)
    ) {
      return res.status(401).json({
        success: false,
        code: "TWO_FACTOR_CHALLENGE_INVALID",
        message: "Two-factor challenge is invalid or expired.",
      });
    }

    normalizeExpiredLock(user);
    const retryAfterSeconds = activeLockSeconds(user);

    if (retryAfterSeconds > 0) {
      res.set("Retry-After", String(retryAfterSeconds));

      return res.status(429).json({
        success: false,
        code: "TWO_FACTOR_TEMPORARILY_LOCKED",
        message:
          "Too many incorrect two-factor codes. Try again later.",
        retryAfterSeconds,
      });
    }

    const secret = decryptSecret(user.twoFactorSecretEncrypted);
    const verification = verifyUserCode({
      user,
      code,
      secret,
    });

    if (!verification.valid) {
      const failure = await recordFailedAttempt(user);

      if (failure.locked) {
        res.set(
          "Retry-After",
          String(failure.retryAfterSeconds)
        );

        return res.status(429).json({
          success: false,
          code: "TWO_FACTOR_TEMPORARILY_LOCKED",
          message:
            "Too many incorrect two-factor codes. Try again later.",
          retryAfterSeconds: failure.retryAfterSeconds,
        });
      }

      return res.status(401).json({
        success: false,
        code: verification.replayed
          ? "TWO_FACTOR_CODE_REPLAYED"
          : "TWO_FACTOR_CODE_INVALID",
        message: verification.replayed
          ? "This authenticator code was already used. Wait for a new code."
          : "Authenticator or recovery code is incorrect.",
        attemptsRemaining: failure.attemptsRemaining,
      });
    }

    if (verification.method === "recovery") {
      user.twoFactorRecoveryCodeHashes.splice(
        verification.recoveryIndex,
        1
      );
    } else {
      user.twoFactorLastUsedCounter = verification.counter;
    }

    clearFailedAttempts(user);
    user.twoFactorLastUsedAt = new Date();
    user.lastLoginAt = new Date();

    await user.save({ validateBeforeSave: false });
    req.resetTwoFactorRateLimit?.();

    return res.status(200).json({
      success: true,
      message:
        verification.method === "recovery"
          ? "Login successful. A recovery code was used and cannot be reused."
          : "Two-factor verification successful.",
      token: accessTokenFor(user),
      data: publicUser(user),
      recoveryCodesRemaining: Array.isArray(
        user.twoFactorRecoveryCodeHashes
      )
        ? user.twoFactorRecoveryCodeHashes.length
        : 0,
    });
  } catch (error) {
    console.error("2FA login verification failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Two-factor verification could not be completed.",
    });
  }
};

const disableTwoFactor = async (req, res) => {
  try {
    assertTwoFactorConfiguration();

    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authenticator or recovery code is required.",
      });
    }

    const user = await User.findById(req.user._id).select(
      [
        "+password",
        "+twoFactorSecretEncrypted",
        "+twoFactorRecoveryCodeHashes",
        "+twoFactorLastUsedCounter",
        "+twoFactorFailedAttempts",
        "+twoFactorLockUntil",
      ].join(" ")
    );

    if (
      !user ||
      user.twoFactorEnabled !== true ||
      !user.twoFactorSecretEncrypted
    ) {
      return res.status(400).json({
        success: false,
        message: "Two-factor authentication is not enabled.",
      });
    }

    const passwordValid = await verifyPasswordWhenPresent(
      user,
      req.body.currentPassword
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    normalizeExpiredLock(user);
    const retryAfterSeconds = activeLockSeconds(user);

    if (retryAfterSeconds > 0) {
      res.set("Retry-After", String(retryAfterSeconds));

      return res.status(429).json({
        success: false,
        message:
          "Two-factor verification is temporarily locked.",
        retryAfterSeconds,
      });
    }

    const secret = decryptSecret(user.twoFactorSecretEncrypted);
    const verification = verifyUserCode({
      user,
      code,
      secret,
    });

    if (!verification.valid) {
      const failure = await recordFailedAttempt(user);

      return res.status(401).json({
        success: false,
        message: "Authenticator or recovery code is incorrect.",
        attemptsRemaining: failure.attemptsRemaining,
      });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecretEncrypted = null;
    user.twoFactorPendingSecretEncrypted = null;
    user.twoFactorPendingExpires = null;
    user.twoFactorRecoveryCodeHashes = [];
    user.twoFactorEnabledAt = null;
    user.twoFactorLastUsedAt = null;
    user.twoFactorLastUsedCounter = null;
    clearFailedAttempts(user);
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;

    await user.save({ validateBeforeSave: false });
    await revokeSessions(user._id, "two-factor-disabled");

    return res.status(200).json({
      success: true,
      message:
        "Two-factor authentication disabled. Existing sessions were revoked.",
      token: accessTokenFor(user),
      data: publicUser(user),
    });
  } catch (error) {
    console.error("Disable 2FA failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Two-factor authentication could not be disabled.",
    });
  }
};

const regenerateRecoveryCodes = async (req, res) => {
  try {
    assertTwoFactorConfiguration();

    const code = String(req.body.code || "").trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authenticator code is required.",
      });
    }

    const user = await User.findById(req.user._id).select(
      [
        "+password",
        "+twoFactorSecretEncrypted",
        "+twoFactorRecoveryCodeHashes",
        "+twoFactorLastUsedCounter",
      ].join(" ")
    );

    if (
      !user ||
      user.twoFactorEnabled !== true ||
      !user.twoFactorSecretEncrypted
    ) {
      return res.status(400).json({
        success: false,
        message: "Two-factor authentication is not enabled.",
      });
    }

    const passwordValid = await verifyPasswordWhenPresent(
      user,
      req.body.currentPassword
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    const secret = decryptSecret(user.twoFactorSecretEncrypted);
    const verification = verifyAuthenticatorCode({
      secret,
      code,
      lastUsedCounter: user.twoFactorLastUsedCounter,
    });

    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        message: verification.replayed
          ? "This authenticator code was already used. Wait for a new code."
          : "Authenticator code is incorrect.",
      });
    }

    const recoveryCodes = generateRecoveryCodes();

    user.twoFactorRecoveryCodeHashes =
      recoveryCodes.map(hashRecoveryCode);
    user.twoFactorLastUsedAt = new Date();
    user.twoFactorLastUsedCounter = verification.counter;

    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message:
        "New recovery codes generated. Older recovery codes are now invalid.",
      recoveryCodes,
    });
  } catch (error) {
    console.error("Regenerate recovery codes failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Recovery codes could not be regenerated.",
    });
  }
};

module.exports = {
  getTwoFactorStatus,
  startTwoFactorSetup,
  enableTwoFactor,
  verifyTwoFactorLogin,
  disableTwoFactor,
  regenerateRecoveryCodes,
};
