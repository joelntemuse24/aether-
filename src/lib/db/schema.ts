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
