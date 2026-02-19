import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function remapDevSqliteDatabaseUrl(): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const current = process.env.DATABASE_URL?.trim();
  if (!current || !current.startsWith("file:")) {
    return;
  }

  const rawFilePart = current.slice("file:".length);
  if (!rawFilePart) {
    return;
  }

  const queryIndex = rawFilePart.indexOf("?");
  const filePart = queryIndex >= 0 ? rawFilePart.slice(0, queryIndex) : rawFilePart;
  const queryPart = queryIndex >= 0 ? rawFilePart.slice(queryIndex) : "";
  if (!filePart) {
    return;
  }

  const absoluteSource = path.isAbsolute(filePart) ? filePart : path.resolve(process.cwd(), filePart);
  const normalizedFilePart = filePart.replace(/^[.\\/]+/, "");
  const prismaRelativeSource = path.isAbsolute(filePart)
    ? filePart
    : path.resolve(process.cwd(), "prisma", normalizedFilePart || path.basename(filePart));
  const projectRoot = path.resolve(process.cwd());
  if (!isPathInside(projectRoot, absoluteSource) && !isPathInside(projectRoot, prismaRelativeSource)) {
    return;
  }

  const runtimeDir = path.join(os.homedir(), ".content-strategist-runtime");
  const targetPath = path.join(runtimeDir, path.basename(absoluteSource));

  const sourceCandidates = [absoluteSource, prismaRelativeSource]
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .map((candidate) => ({
      path: candidate,
      exists: fs.existsSync(candidate),
      size: fs.existsSync(candidate) ? fs.statSync(candidate).size : 0,
    }))
    .filter((candidate) => candidate.exists && candidate.size > 0)
    .sort((a, b) => b.size - a.size);

  const sourcePath = sourceCandidates[0]?.path ?? null;

  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const hasUsableTarget = fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
    if (!hasUsableTarget) {
      if (!sourcePath) {
        return;
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        const source = `${sourcePath}${suffix}`;
        const target = `${targetPath}${suffix}`;
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, target);
        }
      }
    }
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0) {
      return;
    }
    process.env.DATABASE_URL = `file:${targetPath.replace(/\\/g, "/")}${queryPart}`;
  } catch {
    // If remap fails, continue with the original DATABASE_URL.
  }
}

remapDevSqliteDatabaseUrl();

function ensureNeonServerlessParams(urlString: string): string {
  const trimmed = urlString.trim();
  if (!trimmed) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  if (protocol !== "postgres" && protocol !== "postgresql") {
    return trimmed;
  }

  const requiredParams: Record<string, string> = {
    sslmode: "require",
    pgbouncer: "false",
    prepare_threshold: "0",
    statement_timeout: "30000",
  };

  for (const [key, value] of Object.entries(requiredParams)) {
    if (!parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, value);
    }
  }

  return parsed.toString();
}

function resolveDatabaseUrl(): string | undefined {
  const existing = process.env.DATABASE_URL?.trim();
  const liveDirect = process.env.LIVE_DATABASE_POSTGRES_URL?.trim();

  const shouldPreferLiveDirect =
    !!liveDirect && (!existing || existing.startsWith("file:"));

  const candidate = shouldPreferLiveDirect ? liveDirect : existing || liveDirect;
  if (!candidate) {
    return undefined;
  }
  return ensureNeonServerlessParams(candidate);
}

const resolvedDatabaseUrl = resolveDatabaseUrl();
if (resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    datasources: resolvedDatabaseUrl
      ? {
          db: {
            url: resolvedDatabaseUrl,
          },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
