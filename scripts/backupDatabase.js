"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

require("dotenv").config({ quiet: true });

const getBackupDirectory = () => {
  if (process.env.PROTRADE_BACKUP_DIR) {
    return path.resolve(process.env.PROTRADE_BACKUP_DIR);
  }

  const baseDirectory =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), "AppData", "Local");

  return path.join(baseDirectory, "ProTrade", "backups");
};

const createTimestamp = () =>
  new Date().toISOString().replace(/[:.]/g, "-");

const calculateSha256 = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const safelyDelete = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(
      `Warning: could not remove temporary file: ${error.message}`
    );
  }
};

const removeExpiredBackups = (directory, retentionDays) => {
  const cutoffTime =
    Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const fileName of fs.readdirSync(directory)) {
    const isBackupFile =
      fileName.startsWith("protrade-") &&
      (
        fileName.endsWith(".archive.gz") ||
        fileName.endsWith(".manifest.json")
      );

    if (!isBackupFile) continue;

    const filePath = path.join(directory, fileName);
    const stats = fs.statSync(filePath);

    if (stats.mtimeMs < cutoffTime) {
      fs.unlinkSync(filePath);
      console.log(`Removed expired backup: ${fileName}`);
    }
  }
};

const createSecureConfig = (mongoUri) => {
  const configPath = path.join(
    os.tmpdir(),
    `protrade-mongodump-${process.pid}-${crypto.randomUUID()}.yml`
  );

  const contents = `uri: ${JSON.stringify(mongoUri)}\n`;

  fs.writeFileSync(configPath, contents, {
    encoding: "utf8",
    mode: 0o600,
  });

  return configPath;
};

const main = async () => {
  const mongoUri = process.env.MONGODB_URI;
  const databaseName =
    process.env.MONGODB_DB_NAME || "test";

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing from .env.");
  }

  if (!databaseName) {
    throw new Error("MONGODB_DB_NAME is missing.");
  }

  const backupDirectory = getBackupDirectory();
  fs.mkdirSync(backupDirectory, { recursive: true });

  const timestamp = createTimestamp();
  const archiveName =
    `protrade-${databaseName}-${timestamp}.archive.gz`;

  const archivePath = path.join(
    backupDirectory,
    archiveName
  );

  const configPath = createSecureConfig(mongoUri);

  console.log("Creating secure ProTrade database backup...");
  console.log(`Database: ${databaseName}`);
  console.log(`Backup: ${archivePath}`);

  let result;

  try {
    result = spawnSync(
      "mongodump",
      [
        `--config=${configPath}`,
        `--db=${databaseName}`,
        `--archive=${archivePath}`,
        "--gzip",
      ],
      {
        stdio: "inherit",
        windowsHide: true,
        shell: false,
      }
    );
  } finally {
    safelyDelete(configPath);
  }

  if (result.error) {
    safelyDelete(archivePath);

    if (result.error.code === "ENOENT") {
      throw new Error(
        "mongodump command not found. Restart VS Code."
      );
    }

    throw result.error;
  }

  if (result.status !== 0) {
    safelyDelete(archivePath);

    throw new Error(
      `mongodump failed with exit code ${result.status}.`
    );
  }

  if (!fs.existsSync(archivePath)) {
    throw new Error("Backup archive was not created.");
  }

  const stats = fs.statSync(archivePath);

  if (stats.size === 0) {
    safelyDelete(archivePath);
    throw new Error("Backup archive is empty.");
  }

  const sha256 = await calculateSha256(archivePath);

  const manifest = {
    application: "ProTrade",
    database: databaseName,
    createdAt: new Date().toISOString(),
    archive: archiveName,
    sizeBytes: stats.size,
    sha256,
    compressed: true,
    format: "MongoDB archive",
    databaseToolsVersion: "100.17.0",
  };

  const manifestPath = archivePath.replace(
    ".archive.gz",
    ".manifest.json"
  );

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  const retentionDays = Number.parseInt(
    process.env.BACKUP_RETENTION_DAYS || "30",
    10
  );

  if (
    Number.isInteger(retentionDays) &&
    retentionDays > 0
  ) {
    removeExpiredBackups(
      backupDirectory,
      retentionDays
    );
  }

  console.log("");
  console.log("Database backup completed successfully.");
  console.log(`Database: ${databaseName}`);
  console.log(`Archive: ${archivePath}`);
  console.log(`Size: ${stats.size} bytes`);
  console.log(`SHA-256: ${sha256}`);
  console.log(`Manifest: ${manifestPath}`);
};

main().catch((error) => {
  console.error("");
  console.error(`Backup failed: ${error.message}`);
  process.exit(1);
});
