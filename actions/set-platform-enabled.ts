import { defineAction } from "@agent-native/core/action";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, platformOr404, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description:
    "Turn a platform on or off for the current user. A disabled platform is skipped by Scout and hidden from the Radar and Portfolio; existing builds and opportunities are kept, and it can be turned back on at any time.",
  schema: z.object({
    platform: z.string().describe("Platform id from list-platforms"),
    enabled: z.boolean().describe("true to enable, false to disable"),
  }),
  run: async ({ platform, enabled }, ctx) => {
    const owner = requireOwner(ctx);
    const p = platformOr404(platform);
    await getDb()
      .insert(schema.platformState)
      .values({ id: `${owner}:${p.id}`, ownerEmail: owner, platformId: p.id, enabled: enabled ? "on" : "off", updatedAt: now() })
      .onConflictDoUpdate({
        target: schema.platformState.id,
        set: { enabled: sql`excluded.enabled`, updatedAt: sql`excluded.updated_at` },
      });
    return { platform: p.id, name: p.name, enabled };
  },
});
