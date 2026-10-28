import { defineAction, fail } from "@agent-native/core/action";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, platformOr404, requireOwner } from "../server/lib/forge.js";

// Human-only: it decides whether approved builds are really uploaded to your account.
export default defineAction({
  description: "Turn real uploading on or off for a platform (Apify). When on, approved builds are uploaded to the user's account as private actors.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({ platform: z.string(), live: z.boolean() }),
  run: async ({ platform, live }, ctx) => {
    const owner = requireOwner(ctx);
    const p = platformOr404(platform);
    if (!p.publish.liveSupported)
      fail(`${p.name} has no real upload adapter yet; it stays a dry run.`, { statusCode: 409, errorCode: "live_unsupported" });
    await getDb()
      .insert(schema.platformState)
      .values({ id: `${owner}:${p.id}`, ownerEmail: owner, platformId: p.id, enabled: "on", live: live ? "on" : "off", updatedAt: now() })
      .onConflictDoUpdate({ target: schema.platformState.id, set: { live: sql`excluded.live`, updatedAt: sql`excluded.updated_at` } });
    return { platform: p.id, name: p.name, live };
  },
});
