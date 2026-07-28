import { sql } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type AppDb =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

let dbPromise: Promise<AppDb> | null = null;
let migrated = false;

/** True when cloud conversation sync can run (Neon URL or local PGlite). */
export function isCloudDbConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (url && /^postgres(ql)?:\/\//i.test(url)) return true;
  if (process.env.AETHER_PGLITE === "1") return true;
  return false;
}

async function ensureSchema(db: AppDb): Promise<void> {
  if (migrated) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'regular',
      custom JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
      ON conversations (user_id, updated_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      conversation_id TEXT PRIMARY KEY
        REFERENCES conversations(id) ON DELETE CASCADE,
      repo JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  migrated = true;
}

async function createDb(): Promise<AppDb> {
  const url = process.env.DATABASE_URL?.trim();

  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    const client = neon(url);
    const db = drizzleNeon(client, { schema });
    await ensureSchema(db as AppDb);
    return db as AppDb;
  }

  if (process.env.AETHER_PGLITE === "1") {
    const pglite = new PGlite("./.data/aether-pglite");
    await pglite.waitReady;
    const db = drizzlePglite(pglite, { schema });
    await ensureSchema(db as AppDb);
    return db as AppDb;
  }

  throw new Error(
    "Cloud DB not configured. Set DATABASE_URL (Neon Postgres) or AETHER_PGLITE=1 for local.",
  );
}

export async function getDb(): Promise<AppDb> {
  if (!isCloudDbConfigured()) {
    throw new Error("Cloud DB not configured");
  }
  if (!dbPromise) {
    dbPromise = createDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
