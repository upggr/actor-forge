import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const opportunities = pgTable(
  "forge_opportunities",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    topic: text("topic").notNull(),
    query: text("query").notNull(),
    score: integer("score").notNull(),
    summary: text("summary").notNull(),
    evidence: text("evidence").notNull(),
    status: text("status", { enum: ["open", "building", "dismissed"] }).notNull().default("open"),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("forge_opp_owner_platform_topic").on(t.ownerEmail, t.platform, t.topic)],
);

export const builds = pgTable(
  "forge_builds",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id").notNull(),
    platform: text("platform").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", {
      enum: ["drafting", "awaiting_approval", "approved", "rejected", "published_dry_run", "published"],
    })
      .notNull()
      .default("drafting"),
    vet: text("vet"),
    keeper: text("keeper"),
    decisionNote: text("decision_note"),
    publishResult: text("publish_result"),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("forge_builds_owner_status").on(t.ownerEmail, t.status)],
);

export const suggestions = pgTable(
  "forge_suggestions",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    kind: text("kind", { enum: ["pricing", "feature", "fix"] }).notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    evidence: text("evidence"),
    status: text("status", { enum: ["open", "accepted", "dismissed"] }).notNull().default("open"),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("forge_suggestions_owner_status").on(t.ownerEmail, t.status)],
);

export const platformState = pgTable("forge_platform_state", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  platformId: text("platform_id").notNull(),
  enabled: text("enabled", { enum: ["on", "off"] }).notNull().default("on"),
  live: text("live", { enum: ["on", "off"] }).notNull().default("off"),
  updatedAt: text("updated_at").notNull(),
});
