"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let failed = false;

const pass = (message) => console.log(`PASS: ${message}`);
const fail = (message) => {
  failed = true;
  console.error(`FAIL: ${message}`);
};

const requiredFiles = [
  "utils/twoFactor.js",
  "middleware/twoFactorRateLimiter.js",
  "controllers/twoFactorController.js",
  "models/User.js",
  "controllers/authController.js",
  "routes/authRoutes.js",
];

console.log("ProTrade Batch 6A two-factor audit\n");

for (const relativePath of requiredFiles) {
  const filePath = path.join(root, relativePath);

  if (fs.existsSync(filePath)) {
    pass(`${relativePath} exists`);
  } else {
    fail(`${relativePath} is missing`);
  }
}

const checks = [
  ["models/User.js", "twoFactorSecretEncrypted", "encrypted 2FA secret field"],
  ["models/User.js", "twoFactorRecoveryCodeHashes", "recovery code hashes"],
  ["models/User.js", "twoFactorLastUsedCounter", "TOTP replay protection"],
  [
    "controllers/authController.js",
    "createTwoFactorLoginChallenge",
    "login challenge integration",
  ],
  [
    "controllers/authController.js",
    'code: "TWO_FACTOR_REQUIRED"',
    "2FA-required response",
  ],
  [
    "routes/authRoutes.js",
    '"/2fa/login/verify"',
    "2FA login verification route",
  ],
  [
    "routes/authRoutes.js",
    '"/2fa/recovery-codes/regenerate"',
    "recovery regeneration route",
  ],
  [
    "utils/twoFactor.js",
    'createCipheriv("aes-256-gcm"',
    "AES-256-GCM secret encryption",
  ],
  [
    "utils/twoFactor.js",
    "timingSafeEqual",
    "constant-time recovery-code comparison",
  ],
];

for (const [relativePath, needle, label] of checks) {
  const filePath = path.join(root, relativePath);

  if (!fs.existsSync(filePath)) {
    continue;
  }

  const source = fs.readFileSync(filePath, "utf8");

  if (source.includes(needle)) {
    pass(label);
  } else {
    fail(`${label} is missing`);
  }
}

const envNames = [
  "TWO_FACTOR_ENCRYPTION_KEY",
  "TWO_FACTOR_CHALLENGE_SECRET",
  "TWO_FACTOR_RECOVERY_PEPPER",
  "TWO_FACTOR_ISSUER",
  "TWO_FACTOR_CHALLENGE_MINUTES",
];

const envExamplePath = path.join(root, ".env.example");

if (fs.existsSync(envExamplePath)) {
  const envExample = fs.readFileSync(envExamplePath, "utf8");

  for (const name of envNames) {
    if (envExample.includes(`${name}=`)) {
      pass(`.env.example documents ${name}`);
    } else {
      fail(`.env.example is missing ${name}`);
    }
  }
}

try {
  require(path.join(root, "utils", "twoFactor.js"));
  require(path.join(root, "middleware", "twoFactorRateLimiter.js"));
  require(path.join(root, "controllers", "twoFactorController.js"));
  require(path.join(root, "routes", "authRoutes.js"));
  pass("Batch 6A modules load");
} catch (error) {
  fail(`Module load failed: ${error.message}`);
}

console.log("");

if (failed) {
  console.error("Batch 6A two-factor audit FAILED.");
  process.exit(1);
}

console.log("Batch 6A two-factor audit PASSED.");
