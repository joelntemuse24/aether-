import path from "node:path";
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
let schemaPromise: Promise<void> | null = null;

/** True when cloud conversation sync can run (Neon URL or local PGlite). */
export function isCloudDbConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (url && /^postgres(ql)?:\/\//i.test(url)) return true;
  if (process.env.AETHER_PGLITE === "1") return true;
  return false;
}

async function ensureSchema(db: AppDb): Promise<void> {
  // Idempotent DDL — re-run safe CREATE IF NOT EXISTS after deploys/HMR.
  if (!schemaPromise) {
    schemaPromise = (async () => {
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
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      intent TEXT NOT NULL,
      depth TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'acting',
      plan_json JSONB,
      classification_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agent_runs_user_created_idx
      ON agent_runs (user_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agent_run_events_run_idx
      ON agent_run_events (run_id, created_at)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      importance TEXT NOT NULL DEFAULT 'normal',
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS memory_records_user_updated_idx
      ON memory_records (user_id, updated_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT,
      pinned_file_ids JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS projects_user_updated_idx
      ON projects (user_id, updated_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      conversation_id TEXT,
      kind TEXT NOT NULL DEFAULT 'document',
      title TEXT NOT NULL,
      language TEXT,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artifacts_user_updated_idx
      ON artifacts (user_id, updated_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vault_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vault_notes_user_updated_idx
      ON vault_notes (user_id, updated_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pending_confirmations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      run_id TEXT,
      request_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pending_confirmations_user_idx
      ON pending_confirmations (user_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      tool_approval_mode TEXT NOT NULL DEFAULT 'ask',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
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
    // Absolute path — Next bundling can turn relative paths into URL objects.
    const dataDir = path.join(process.cwd(), ".data", "aether-pglite");
    const pglite = new PGlite(dataDir);
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
