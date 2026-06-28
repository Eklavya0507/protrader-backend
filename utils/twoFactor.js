"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");

const DEFAULT_ISSUER = "ProTrade";
const DEFAULT_CHALLENGE_MINUTES = 5;
const TOTP_STEP_SECONDS = 30;
const RECOVERY_CODE_COUNT = 10;

authenticator.options = {
  step: TOTP_STEP_SECONDS,
  window: 1,
};

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getEncryptionKey = () => {
  const encoded = String(process.env.TWO_FACTOR_ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(encoded, "base64");

  if (key.length !== 32) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY must be a 32-byte Base64 value."
    );
  }

  return key;
};

const getChallengeSecret = () => {
  const secret = String(
    process.env.TWO_FACTOR_CHALLENGE_SECRET || ""
  ).trim();

  if (secret.length < 32) {
    throw new Error(
      "TWO_FACTOR_CHALLENGE_SECRET must contain at least 32 characters."
    );
  }

  return secret;
};

const getRecoveryPepper = () => {
  const pepper = String(
    process.env.TWO_FACTOR_RECOVERY_PEPPER || ""
  ).trim();

  if (pepper.length < 32) {
    throw new Error(
      "TWO_FACTOR_RECOVERY_PEPPER must contain at least 32 characters."
    );
  }

  return pepper;
};

const getIssuer = () =>
  String(process.env.TWO_FACTOR_ISSUER || DEFAULT_ISSUER).trim() ||
  DEFAULT_ISSUER;

const getChallengeMinutes = () =>
  positiveInteger(
    process.env.TWO_FACTOR_CHALLENGE_MINUTES,
    DEFAULT_CHALLENGE_MINUTES
  );

const assertTwoFactorConfiguration = () => {
  getEncryptionKey();
  getChallengeSecret();
  getRecoveryPepper();
  return true;
};

const encryptSecret = (plaintext) => {
  const value = String(plaintext || "").trim();

  if (!value) {
    throw new Error("Two-factor secret cannot be empty.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};

const decryptSecret = (encryptedValue) => {
  const parts = String(encryptedValue || "").split(".");

  if (parts.length !== 3) {
    throw new Error("Stored two-factor secret is invalid.");
  }

  const [ivPart, tagPart, ciphertextPart] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivPart, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
};

const generateAuthenticatorSecret = () => authenticator.generateSecret();

const createAuthenticatorUri = ({ email, secret }) =>
  authenticator.keyuri(
    String(email || "user").trim().toLowerCase(),
    getIssuer(),
    secret
  );

const normalizeAuthenticatorCode = (value) =>
  String(value || "").replace(/\s+/g, "").trim();

const verifyAuthenticatorCode = ({
  secret,
  code,
  lastUsedCounter = null,
}) => {
  const normalizedCode = normalizeAuthenticatorCode(code);

  if (!/^\d{6}$/.test(normalizedCode)) {
    return { valid: false, counter: null };
  }

  const delta = authenticator.checkDelta(normalizedCode, secret);

  if (!Number.isInteger(delta)) {
    return { valid: false, counter: null };
  }

  const counter =
    Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;

  if (
    Number.isInteger(lastUsedCounter) &&
    counter <= Number(lastUsedCounter)
  ) {
    return { valid: false, replayed: true, counter };
  }

  return { valid: true, counter };
};

const normalizeRecoveryCode = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const hashRecoveryCode = (value) => {
  const normalized = normalizeRecoveryCode(value);

  if (!normalized) {
    return "";
  }

  return crypto
    .createHmac("sha256", getRecoveryPepper())
    .update(normalized)
    .digest("hex");
};

const generateRecoveryCodes = (count = RECOVERY_CODE_COUNT) =>
  Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(8).toString("hex").toUpperCase();
    return raw.match(/.{1,4}/g).join("-");
  });

const recoveryCodeMatches = (storedHash, providedCode) => {
  const candidateHash = hashRecoveryCode(providedCode);

  if (
    !/^[a-f0-9]{64}$/.test(String(storedHash || "")) ||
    !/^[a-f0-9]{64}$/.test(candidateHash)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(storedHash, "hex"),
    Buffer.from(candidateHash, "hex")
  );
};

const createTwoFactorLoginChallenge = (user, method = "password") => {
  const expiresInMinutes = getChallengeMinutes();
  const expiresInSeconds = expiresInMinutes * 60;

  const token = jwt.sign(
    {
      sub: String(user._id),
      type: "two-factor-login",
      tokenVersion: Number(user.tokenVersion || 0),
      method: String(method || "password"),
      nonce: crypto.randomBytes(16).toString("hex"),
    },
    getChallengeSecret(),
    {
      expiresIn: `${expiresInMinutes}m`,
      issuer: "protrade-backend",
      audience: "protrade-two-factor",
    }
  );

  return { token, expiresInSeconds };
};

const verifyTwoFactorLoginChallenge = (token) => {
  const payload = jwt.verify(
    String(token || ""),
    getChallengeSecret(),
    {
      issuer: "protrade-backend",
      audience: "protrade-two-factor",
    }
  );

  if (
    payload.type !== "two-factor-login" ||
    !payload.sub ||
    !Number.isInteger(payload.tokenVersion)
  ) {
    throw new Error("Two-factor challenge is invalid.");
  }

  return payload;
};

module.exports = {
  assertTwoFactorConfiguration,
  encryptSecret,
  decryptSecret,
  generateAuthenticatorSecret,
  createAuthenticatorUri,
  normalizeAuthenticatorCode,
  verifyAuthenticatorCode,
  normalizeRecoveryCode,
  hashRecoveryCode,
  generateRecoveryCodes,
  recoveryCodeMatches,
  createTwoFactorLoginChallenge,
  verifyTwoFactorLoginChallenge,
};
