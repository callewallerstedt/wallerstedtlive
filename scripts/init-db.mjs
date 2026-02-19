import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const schemaPath = path.join(projectRoot, "prisma", "schema.prisma");
const sqlPath = path.join(projectRoot, "prisma", "init.sql");
const dbPath = path.join(projectRoot, "prisma", "dev.db");
const shouldReset = process.argv.includes("--reset");

function run(command) {
  execSync(command, { stdio: "inherit", cwd: projectRoot });
}

function ensureSpotifyTrackColumns() {
  if (!fs.existsSync(dbPath)) {
    return;
  }

  const db = new DatabaseSync(dbPath);
  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='SpotifyTrack'")
      .all().length > 0;
    if (!tableExists) {
      return;
    }

    const rows = db.prepare("PRAGMA table_info('SpotifyTrack')").all();
    const existingColumns = new Set(rows.map((row) => String(row.name)));

    const addColumnStatements = [
      { name: "albumLabel", sql: "ALTER TABLE SpotifyTrack ADD COLUMN albumLabel TEXT" },
      { name: "publisher", sql: "ALTER TABLE SpotifyTrack ADD COLUMN publisher TEXT" },
      { name: "externalUrl", sql: "ALTER TABLE SpotifyTrack ADD COLUMN externalUrl TEXT" },
      {
        name: "ownershipStatus",
        sql: "ALTER TABLE SpotifyTrack ADD COLUMN ownershipStatus TEXT NOT NULL DEFAULT 'AUTO'",
      },
      {
        name: "isOwnedByYou",
        sql: "ALTER TABLE SpotifyTrack ADD COLUMN isOwnedByYou BOOLEAN NOT NULL DEFAULT 0",
      },
      {
        name: "ownershipShare",
        sql: "ALTER TABLE SpotifyTrack ADD COLUMN ownershipShare REAL NOT NULL DEFAULT 0.5",
      },
    ];

    for (const statement of addColumnStatements) {
      if (!existingColumns.has(statement.name)) {
        db.exec(statement.sql);
      }
    }
  } finally {
    db.close();
  }
}

function ensureTikTokLiveTables() {
  if (!fs.existsSync(dbPath)) {
    return;
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "TikTokLiveSession" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "roomId" TEXT,
        "source" TEXT NOT NULL DEFAULT 'tiktok-live',
        "isLive" BOOLEAN NOT NULL DEFAULT false,
        "statusCode" INTEGER,
        "title" TEXT,
        "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endedAt" DATETIME,
        "viewerCountStart" INTEGER NOT NULL DEFAULT 0,
        "viewerCountPeak" INTEGER NOT NULL DEFAULT 0,
        "viewerCountAvg" REAL NOT NULL DEFAULT 0,
        "likeCountLatest" INTEGER NOT NULL DEFAULT 0,
        "enterCountLatest" INTEGER NOT NULL DEFAULT 0,
        "totalCommentEvents" INTEGER NOT NULL DEFAULT 0,
        "totalGiftEvents" INTEGER NOT NULL DEFAULT 0,
        "totalGiftDiamonds" INTEGER NOT NULL DEFAULT 0,
        "warnings" TEXT,
        "error" TEXT
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS "TikTokLiveSample" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "sessionId" TEXT NOT NULL,
        "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "viewerCount" INTEGER NOT NULL DEFAULT 0,
        "likeCount" INTEGER NOT NULL DEFAULT 0,
        "enterCount" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "TikTokLiveSample_sessionId_fkey"
          FOREIGN KEY ("sessionId") REFERENCES "TikTokLiveSession" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS "TikTokLiveComment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "sessionId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "userUniqueId" TEXT,
        "nickname" TEXT,
        "comment" TEXT NOT NULL,
        CONSTRAINT "TikTokLiveComment_sessionId_fkey"
          FOREIGN KEY ("sessionId") REFERENCES "TikTokLiveSession" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS "TikTokLiveGift" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "sessionId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "userUniqueId" TEXT,
        "nickname" TEXT,
        "giftName" TEXT,
        "diamondCount" INTEGER NOT NULL DEFAULT 0,
        "repeatCount" INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT "TikTokLiveGift_sessionId_fkey"
          FOREIGN KEY ("sessionId") REFERENCES "TikTokLiveSession" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
  } finally {
    db.close();
  }
}

if (shouldReset && fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { force: true });
}

if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0 && !shouldReset) {
  ensureSpotifyTrackColumns();
  ensureTikTokLiveTables();
  run("npx prisma generate");
  console.log("Database already exists. Applied schema patch checks and generated client.");
  process.exit(0);
}

const sql = execSync(
  `npx prisma migrate diff --from-empty --to-schema-datamodel "${schemaPath}" --script`,
  {
    cwd: projectRoot,
    encoding: "utf8",
  }
);

fs.writeFileSync(sqlPath, sql, { encoding: "utf8" });
run(`npx prisma db execute --file "${sqlPath}" --schema "${schemaPath}"`);
run("npx prisma generate");

console.log("Database initialized using prisma/init.sql");
