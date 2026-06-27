"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const dns = require("node:dns");
const mongoose = require("mongoose");
const { spawnSync } = require("child_process");

require("dotenv").config({ quiet: true });

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const RESTORE_PREFIX = "protrade_restore_verify_";

const getBackupDirectory = () => {
  if (process.env.PROTRADE_BACKUP_DIR) {
    return path.resolve(process.env.PROTRADE_BACKUP_DIR);
  }

  const baseDirectory =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), "AppData", "Local");

  return path.join(baseDirectory, "ProTrade", "backups");
};

const safelyDelete = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(
      `Warning: temporary file could not be deleted: ${error.message}`
    );
  }
};

const calculateSha256 = (filePath) => {
  const hash = crypto.createHash("sha256");
  const file = fs.readFileSync(filePath);

  hash.update(file);
  return hash.digest("hex");
};

const getLatestArchive = (directory) => {
  if (!fs.existsSync(directory)) {
    throw new Error(`Backup directory does not exist: ${directory}`);
  }

  const archives = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".archive.gz"))
    .map((name) => {
      const filePath = path.join(directory, name);

      return {
        filePath,
        modifiedAt: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  if (archives.length === 0) {
    throw new Error("No .archive.gz backup was found.");
  }

  return archives[0].filePath;
};

const getArchivePath = () => {
  const archiveArgument = process.argv.find((argument) =>
    argument.startsWith("--archive=")
  );

  if (archiveArgument) {
    return path.resolve(
      archiveArgument.slice("--archive=".length)
    );
  }

  return getLatestArchive(getBackupDirectory());
};

const createSecureConfig = (mongoUri) => {
  const configPath = path.join(
    os.tmpdir(),
    `protrade-mongorestore-${process.pid}-${crypto.randomUUID()}.yml`
  );

  fs.writeFileSync(
    configPath,
    `uri: ${JSON.stringify(mongoUri)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );

  return configPath;
};

const dropVerificationDatabase = async (
  mongoUri,
  databaseName
) => {
  if (!databaseName.startsWith(RESTORE_PREFIX)) {
    throw new Error(
      `Refusing to delete unsafe database name: ${databaseName}`
    );
  }

  const connection = mongoose.createConnection(mongoUri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 30000,
  });

  try {
    await connection.asPromise();
    await connection.dropDatabase();
  } finally {
    await connection.close().catch(() => {});
  }
};

const main = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing from .env.");
  }

  const archivePath = getArchivePath();

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  const manifestPath = archivePath.replace(
    ".archive.gz",
    ".manifest.json"
  );

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

  const sourceDatabase =
    manifest.database ||
    process.env.MONGODB_DB_NAME ||
    "test";

  const actualHash = calculateSha256(archivePath);

  if (!manifest.sha256) {
    throw new Error("Manifest SHA-256 value is missing.");
  }

  if (actualHash !== manifest.sha256) {
    throw new Error(
      "Backup integrity verification failed: SHA-256 does not match."
    );
  }

  const restoreDatabase =
    `${RESTORE_PREFIX}${Date.now()}`;

  const configPath = createSecureConfig(mongoUri);

  let restoreCompleted = false;
  let verificationDatabaseDeleted = false;

  console.log("ProTrade restore verification");
  console.log(`Archive: ${archivePath}`);
  console.log(`Source database: ${sourceDatabase}`);
  console.log(`Temporary database: ${restoreDatabase}`);
  console.log("SHA-256 integrity: PASSED");
  console.log("");

  try {
    const result = spawnSync(
      "mongorestore",
      [
        `--config=${configPath}`,
        `--archive=${archivePath}`,
        "--gzip",
        `--nsFrom=${sourceDatabase}.*`,
        `--nsTo=${restoreDatabase}.*`,
        "--drop",
      ],
      {
        stdio: "inherit",
        windowsHide: true,
        shell: false,
      }
    );

    if (result.error) {
      if (result.error.code === "ENOENT") {
        throw new Error(
          "mongorestore command not found. Restart VS Code."
        );
      }

      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `mongorestore failed with exit code ${result.status}.`
      );
    }

    restoreCompleted = true;

    const connection = mongoose.createConnection(mongoUri, {
      dbName: restoreDatabase,
      serverSelectionTimeoutMS: 30000,
    });

    try {
      await connection.asPromise();

      const collections = await connection.db
        .listCollections({}, { nameOnly: true })
        .toArray();

      if (collections.length === 0) {
        throw new Error(
          "Restore completed but no collections were found."
        );
      }

      let totalDocuments = 0;

      console.log("");
      console.log("Restored collection counts:");

      for (
        const collectionInfo of collections.sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      ) {
        const count = await connection.db
          .collection(collectionInfo.name)
          .countDocuments();

        totalDocuments += count;

        console.log(
          `- ${collectionInfo.name}: ${count} document(s)`
        );
      }

      if (totalDocuments === 0) {
        throw new Error(
          "Restore completed but restored database is empty."
        );
      }

      console.log(`Total restored documents: ${totalDocuments}`);

      await connection.dropDatabase();
      verificationDatabaseDeleted = true;
    } finally {
      await connection.close().catch(() => {});
    }

    console.log("");
    console.log("Backup restore verification PASSED.");
    console.log(
      "Temporary verification database deleted successfully."
    );
    console.log(
      "Production database was not modified."
    );
  } finally {
    safelyDelete(configPath);

    if (
      restoreCompleted &&
      !verificationDatabaseDeleted
    ) {
      try {
        await dropVerificationDatabase(
          mongoUri,
          restoreDatabase
        );

        console.log(
          "Temporary verification database cleaned up."
        );
      } catch (cleanupError) {
        console.error(
          `Cleanup warning: ${cleanupError.message}`
        );
      }
    }
  }
};

main().catch((error) => {
  console.error("");
  console.error(`Restore verification failed: ${error.message}`);
  process.exit(1);
});
