import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Synced conversations for signed-in users (ChatGPT/Claude-class cloud history). */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title"),
    status: text("status").notNull().default("regular"),
    custom: jsonb("custom").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("conversations_user_updated_idx").on(t.userId, t.updatedAt)],
);

/**
 * Message history for a conversation, stored as the assistant-ui format repo
 * JSON (same shape as the previous localStorage `aether:messages:*` blob).
 */
export const conversationMessages = pgTable("conversation_messages", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  repo: jsonb("repo")
    .$type<{
      headId?: string | null;
      entries: Array<{
        id: string;
        parent_id: string | null;
        format: string;
        content: Record<string, unknown>;
      }>;
    }>()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMessagesRow = typeof conversationMessages.$inferSelect;

/** Agent harness runs (classify → clarify → act → verify). */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id"),
    intent: text("intent").notNull(),
    depth: text("depth").notNull(),
    status: text("status").notNull().default("acting"),
    planJson: jsonb("plan_json").$type<{ steps?: string[] } | null>(),
    classificationJson: jsonb("classification_json").$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_runs_user_created_idx").on(t.userId, t.createdAt)],
);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_run_events_run_idx").on(t.runId, t.createdAt)],
);

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AgentRunEventRow = typeof agentRunEvents.$inferSelect;

export const MEMORY_TYPES = [
  "preference",
  "person",
  "project",
  "belief_or_practice",
  "open_question",
  "writing_voice",
  "constraint",
  "note",
] as const;

/** Long-term curated memory the agent can write/search. */
export const memoryRecords = pgTable(
  "memory_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull().default("note"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    importance: text("importance").notNull().default("normal"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("memory_records_user_updated_idx").on(t.userId, t.updatedAt)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    pinnedFileIds: jsonb("pinned_file_ids").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_user_updated_idx").on(t.userId, t.updatedAt)],
);

/** Persisted artifacts (living documents) for a user. */
export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: text("project_id"),
    conversationId: text("conversation_id"),
    kind: text("kind").notNull().default("document"),
    title: text("title").notNull(),
    language: text("language"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("artifacts_user_updated_idx").on(t.userId, t.updatedAt)],
);

export type MemoryRecordRow = typeof memoryRecords.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
