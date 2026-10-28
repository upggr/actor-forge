import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "forge-opportunities-and-builds",
      sql: `CREATE TABLE IF NOT EXISTS forge_opportunities (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  topic TEXT NOT NULL,
  query TEXT NOT NULL,
  score INTEGER NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'building', 'dismissed')),
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS forge_opp_owner_platform_topic ON forge_opportunities (owner_email, platform, topic);
CREATE TABLE IF NOT EXISTS forge_builds (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES forge_opportunities(id),
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting', 'awaiting_approval', 'approved', 'rejected', 'published_dry_run')),
  vet TEXT,
  keeper TEXT,
  decision_note TEXT,
  publish_result TEXT,
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forge_builds_owner_status ON forge_builds (owner_email, status)`,
    },
    {
      version: 2,
      name: "forge-suggestions",
      sql: `CREATE TABLE IF NOT EXISTS forge_suggestions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pricing', 'feature', 'fix')),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forge_suggestions_owner_status ON forge_suggestions (owner_email, status)`,
    },
    {
      version: 3,
      name: "forge-platform-state",
      sql: `CREATE TABLE IF NOT EXISTS forge_platform_state (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  platform_id TEXT NOT NULL,
  enabled TEXT NOT NULL DEFAULT 'on' CHECK (enabled IN ('on', 'off')),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forge_platform_state_owner ON forge_platform_state (owner_email)`,
    },
  ],
  { table: "forge_app_migrations" },
);
