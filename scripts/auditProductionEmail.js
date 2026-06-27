"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
let failed = false;

const pass = (message) => console.log(`PASS: ${message}`);

const fail = (message) => {
  failed = true;
  console.error(`FAIL: ${message}`);
};

console.log("ProTrade production email audit\n");

const requiredFiles = [
  "utils/sendEmail.js",
  ".env.example",
  ".gitignore",
];

for (const relativePath of requiredFiles) {
  const filePath = path.join(root, relativePath);

  if (fs.existsSync(filePath)) {
    pass(`${relativePath} exists`);
  } else {
    fail(`${relativePath} is missing`);
  }
}

const variables = [
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
];

const sendEmailPath = path.join(root, "utils", "sendEmail.js");

if (fs.existsSync(sendEmailPath)) {
  const source = fs.readFileSync(sendEmailPath, "utf8");

  for (const variable of variables) {
    source.includes(variable)
      ? pass(`sendEmail.js uses ${variable}`)
      : fail(`sendEmail.js is missing ${variable}`);
  }

  if (
    source.includes("api.brevo.com") &&
    source.includes("/v3/smtp/email")
  ) {
    pass("Brevo API endpoint configured");
  } else {
    fail("Brevo API endpoint missing");
  }
}

const envExamplePath = path.join(root, ".env.example");

if (fs.existsSync(envExamplePath)) {
  const envExample = fs.readFileSync(envExamplePath, "utf8");

  for (const variable of variables) {
    envExample.includes(`${variable}=`)
      ? pass(`.env.example documents ${variable}`)
      : fail(`.env.example is missing ${variable}`);
  }
}

const gitignorePath = path.join(root, ".gitignore");

if (fs.existsSync(gitignorePath)) {
  const lines = fs
    .readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim());

  lines.includes(".env")
    ? pass(".env is ignored by Git")
    : fail(".env is not ignored by Git");
}

try {
  const trackedEnv = execFileSync(
    "git",
    ["ls-files", ".env"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }
  ).trim();

  trackedEnv
    ? fail(".env is tracked by Git")
    : pass(".env is not tracked by Git");
} catch (error) {
  fail(`Git check failed: ${error.message}`);
}

console.log("");

if (failed) {
  console.error("Batch 5A production email audit FAILED.");
  process.exit(1);
}

console.log("Batch 5A production email audit PASSED.");
