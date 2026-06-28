"use strict";

const fs = require("fs");
const crypto = require("node:crypto");

const envPath = ".env";

if (!fs.existsSync(envPath)) {
  throw new Error(".env file was not found in the backend root.");
}

const newline = "\r\n";
let lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

const existing = new Map();

for (const line of lines) {
  const separator = line.indexOf("=");
  if (separator === -1) continue;

  existing.set(
    line.slice(0, separator).trim(),
    line.slice(separator + 1)
  );
}

const values = {
  SECURITY_ACTIVITY_PEPPER:
    String(existing.get("SECURITY_ACTIVITY_PEPPER") || "").trim() ||
    crypto.randomBytes(32).toString("base64"),
  SECURITY_ACTIVITY_RETENTION_DAYS:
    String(
      existing.get("SECURITY_ACTIVITY_RETENTION_DAYS") || "180"
    ).trim() || "180",
};

const names = new Set(Object.keys(values));

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
  "# Security activity audit log",
  ...Object.entries(values).map(
    ([name, value]) => `${name}=${value}`
  )
);

fs.writeFileSync(
  envPath,
  `${lines.join(newline)}${newline}`,
  "utf8"
);

console.log("Security activity environment configured.");
console.log("Secret value was not displayed.");
