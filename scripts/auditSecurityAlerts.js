"use strict";

const fs = require("fs");

let failed = false;

const pass = (message) => console.log(`PASS: ${message}`);
const fail = (message) => {
  failed = true;
  console.error(`FAIL: ${message}`);
};

const files = [
  "models/SecurityAlert.js",
  "models/SecurityAlertPreference.js",
  "utils/securityAlertEngine.js",
  "controllers/securityAlertController.js",
  "routes/securityAlertRoutes.js",
  "scripts/configureSecurityAlertEnv.js",
];

console.log("ProTrade Batch 7 security-alert audit\n");

for (const file of files) {
  if (fs.existsSync(file)) pass(`${file} exists`);
  else fail(`${file} is missing`);
}

const server = fs.readFileSync("server.js", "utf8");

for (const [needle, label] of [
  [
    'require("./routes/securityAlertRoutes")',
    "security alert routes imported",
  ],
  [
    'app.use("/api/security/alerts", securityAlertRoutes)',
    "security alert API mounted",
  ],
]) {
  if (server.includes(needle)) pass(label);
  else fail(label);
}

const activityUtility = fs.readFileSync(
  "utils/securityActivity.js",
  "utf8"
);

if (
  activityUtility.includes(
    'require("./securityAlertEngine")'
  )
) {
  pass("security activity invokes alert engine");
} else {
  fail("security activity is not connected to alert engine");
}

const activityLogger = fs.readFileSync(
  "middleware/securityActivityLogger.js",
  "utf8"
);

for (const [needle, label] of [
  ["newDeviceDetected", "new-device metadata captured"],
  ["refresh_token_reuse", "refresh-token reuse captured"],
  ["SecurityAlert.deleteMany", "account deletion removes alerts"],
]) {
  if (activityLogger.includes(needle)) pass(label);
  else fail(label);
}

const envExample = fs.readFileSync(".env.example", "utf8");

for (const name of [
  "SECURITY_ALERT_RETENTION_DAYS",
  "SECURITY_ALERT_FAILED_LOGIN_THRESHOLD",
  "SECURITY_ALERT_FAILED_2FA_THRESHOLD",
  "SECURITY_ALERT_WINDOW_MINUTES",
  "SECURITY_ALERT_COOLDOWN_MINUTES",
]) {
  if (envExample.includes(`${name}=`)) {
    pass(`.env.example documents ${name}`);
  } else {
    fail(`.env.example is missing ${name}`);
  }
}

try {
  require("../models/SecurityAlert");
  require("../models/SecurityAlertPreference");
  require("../utils/securityAlertEngine");
  require("../controllers/securityAlertController");
  require("../routes/securityAlertRoutes");
  pass("Batch 7 modules load");
} catch (error) {
  fail(`Module load failed: ${error.message}`);
}

console.log("");

if (failed) {
  console.error("Batch 7 security-alert audit FAILED.");
  process.exit(1);
}

console.log("Batch 7 security-alert audit PASSED.");
