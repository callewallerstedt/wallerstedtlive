-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tiktokHandle" TEXT,
    "spotifyArtistId" TEXT,
    "spotifyArtistName" TEXT DEFAULT 'Wallerstedt',
    "objective" TEXT NOT NULL DEFAULT 'spotify_streams',
    "openAiApiKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TikTokVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "coverUrl" TEXT,
    "durationSec" INTEGER,
    "postedAt" DATETIME,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "musicTitle" TEXT,
    "musicAuthor" TEXT,
    "scrapedSource" TEXT,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SpotifyTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spotifyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artistName" TEXT,
    "albumName" TEXT,
    "popularity" INTEGER,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "previewUrl" TEXT,
    "uri" TEXT,
    "isrc" TEXT,
    "releaseDate" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rank" INTEGER NOT NULL DEFAULT 0,
    "ideaTitle" TEXT NOT NULL,
    "postFormat" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "shotPlan" TEXT NOT NULL,
    "editingNotes" TEXT NOT NULL,
    "patternKey" TEXT,
    "rationale" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "expectedSpotifyLift" REAL NOT NULL DEFAULT 0,
    "expectedViews" INTEGER NOT NULL DEFAULT 0,
    "expectedSaveRate" REAL NOT NULL DEFAULT 0,
    "songSpotifyId" TEXT,
    "songName" TEXT,
    "songSegmentStartSec" INTEGER,
    "songSegmentLengthSec" INTEGER,
    "promptSnapshot" JSONB,
    "score" REAL
);

-- CreateTable
CREATE TABLE "ExperimentReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendationId" TEXT,
    "screenshotPath" TEXT,
    "notes" TEXT,
    "hoursSincePost" INTEGER,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "watchTimeSec" REAL,
    "completionRate" REAL,
    "profileVisits" INTEGER,
    "linkClicks" INTEGER,
    "spotifyStreamsDelta" INTEGER,
    "analysisSummary" TEXT,
    "analysisJson" JSONB,
    "patternKey" TEXT,
    "score" REAL,
    CONSTRAINT "ExperimentReport_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceExperimentId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "impactScore" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Insight_sourceExperimentId_fkey" FOREIGN KEY ("sourceExperimentId") REFERENCES "ExperimentReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrategyPattern" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "avgScore" REAL NOT NULL DEFAULT 0,
    "avgSpotifyLift" REAL NOT NULL DEFAULT 0,
    "avgViewRate" REAL NOT NULL DEFAULT 0,
    "lastUpdatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "meta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TikTokVideo_platformId_key" ON "TikTokVideo"("platformId");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyTrack_spotifyId_key" ON "SpotifyTrack"("spotifyId");

