"use strict";

const fs = require("fs");

const envPath = ".env";

if (!fs.existsSync(envPath)) {
  throw new Error(".env file was not found in the backend root.");
}

const desired = {
  SECURITY_ALERT_RETENTION_DAYS: "180",
  SECURITY_ALERT_FAILED_LOGIN_THRESHOLD: "3",
  SECURITY_ALERT_FAILED_2FA_THRESHOLD: "3",
  SECURITY_ALERT_WINDOW_MINUTES: "15",
  SECURITY_ALERT_COOLDOWN_MINUTES: "60",
};

let lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
const names = new Set(Object.keys(desired));
const existing = new Map();

for (const line of lines) {
  const separator = line.indexOf("=");

  if (separator === -1) continue;

  existing.set(
    line.slice(0, separator).trim(),
    line.slice(separator + 1).trim()
  );
}

lines = lines.filter((line) => {
  const separator = line.indexOf("=");

  if (separator === -1) return true;

  return !names.has(line.slice(0, separator).trim());
});

while (lines.length && lines.at(-1).trim() === "") {
  lines.pop();
}

lines.push(
  "",
  "# Batch 7 suspicious-activity alerts",
  ...Object.entries(desired).map(
    ([name, fallback]) =>
      `${name}=${existing.get(name) || fallback}`
  )
);

fs.writeFileSync(
  envPath,
  `${lines.join("\r\n")}\r\n`,
  "utf8"
);

console.log("Batch 7 environment variables configured.");
console.log("No secret values were added or displayed.");
