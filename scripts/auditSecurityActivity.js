"use strict";

const fs = require("fs");

let failed = false;

const pass = (message) => console.log(`PASS: ${message}`);
const fail = (message) => {
  failed = true;
  console.error(`FAIL: ${message}`);
};

const files = [
  "models/SecurityEvent.js",
  "utils/securityActivity.js",
  "middleware/securityActivityLogger.js",
  "controllers/securityActivityController.js",
  "routes/securityRoutes.js",
  "scripts/configureSecurityActivityEnv.js",
];

console.log("ProTrade Batch 6B security-activity audit\n");

for (const file of files) {
  if (fs.existsSync(file)) pass(`${file} exists`);
  else fail(`${file} is missing`);
}

const server = fs.readFileSync("server.js", "utf8");

for (const [needle, label] of [
  [
    'require("./routes/securityRoutes")',
    "security routes imported",
  ],
  [
    'require("./middleware/securityActivityLogger")',
    "security logger imported",
  ],
  [
    "app.use(securityActivityLogger)",
    "security logger mounted",
  ],
  [
    'app.use("/api/security", securityRoutes)',
    "security API mounted",
  ],
]) {
  if (server.includes(needle)) pass(label);
  else fail(label);
}

const envExample = fs.readFileSync(".env.example", "utf8");

for (const name of [
  "SECURITY_ACTIVITY_PEPPER",
  "SECURITY_ACTIVITY_RETENTION_DAYS",
]) {
  if (envExample.includes(`${name}=`)) {
    pass(`.env.example documents ${name}`);
  } else {
    fail(`.env.example is missing ${name}`);
  }
}

const accountAction = fs.readFileSync(
  "models/AccountAction.js",
  "utf8"
);

if (
  /expiresAt:\s*\{[\s\S]*?index:\s*true[\s\S]*?\}/.test(
    accountAction
  ) &&
  accountAction.includes(
    "accountActionSchema.index({ expiresAt: 1 }"
  )
) {
  fail("AccountAction duplicate TTL index remains");
} else {
  pass("AccountAction duplicate TTL index removed");
}

try {
  require("../models/SecurityEvent");
  require("../utils/securityActivity");
  require("../middleware/securityActivityLogger");
  require("../controllers/securityActivityController");
  require("../routes/securityRoutes");
  pass("Batch 6B modules load");
} catch (error) {
  fail(`Module load failed: ${error.message}`);
}

console.log("");

if (failed) {
  console.error("Batch 6B security-activity audit FAILED.");
  process.exit(1);
}

console.log("Batch 6B security-activity audit PASSED.");
