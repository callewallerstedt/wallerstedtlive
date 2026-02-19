import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const baseDbUrl = process.env.LIVE_DATABASE_POSTGRES_URL || process.env.DATABASE_URL;

if (!baseDbUrl) {
  throw new Error("Missing LIVE_DATABASE_POSTGRES_URL or DATABASE_URL");
}

const dbUrl = `${baseDbUrl}?connection_limit=1&pool_timeout=5&pgbouncer=true&prepare_threshold=0`;

export const prisma =
  globalThis.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
