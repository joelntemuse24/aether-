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
