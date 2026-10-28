import { defineAction, fail } from "@agent-native/core/action";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, platformOr404, requireOwner } from "../server/lib/forge.js";
import { disabledPlatforms } from "../server/lib/enabled.js";
import { loadPlatforms } from "../server/lib/platforms.js";
import { scoutPlatform } from "../server/lib/scout.js";

export default defineAction({
  description:
    "Scout: query the live platform APIs (Apify Store, npm, MCP registry) for niches with real demand and weak or missing supply, and save them as opportunities ranked by gap score. Safe to repeat; existing opportunities are refreshed.",
  schema: z.object({
    platform: z.string().optional().describe("Platform id from list-platforms; omit to scout every platform"),
    topic: z.string().optional().describe("Scout only this seed topic of the platform (used by the UI to show progress)"),
  }),
  run: async (args, ctx) => {
    const owner = requireOwner(ctx);
    const off = await disabledPlatforms(owner);
    if (args.platform && off.has(args.platform))
      fail(`Platform "${args.platform}" is disabled. Enable it first with set-platform-enabled.`, { statusCode: 409, errorCode: "platform_disabled" });
    const all = args.platform ? [platformOr404(args.platform)] : loadPlatforms().platforms.filter((p) => !off.has(p.id));
    const targets = args.topic
      ? all.map((p) => ({ ...p, discover: { ...p.discover, seeds: p.discover.seeds.filter((s) => s.topic === args.topic) } })).filter((p) => p.discover.seeds.length)
      : all;
    if (args.topic && !targets.length) fail(`No seed topic "${args.topic}".`, { statusCode: 404, errorCode: "unknown_topic" });
    // Platforms are independent, so they are scouted in parallel; each one limits its own request rate.
    const scouted = await Promise.all(targets.map(async (p) => ({ p, ...(await scoutPlatform(p)) })));
    const summary: { platform: string; found: number; topScore: number; failures: { topic: string; error: string }[] }[] = [];
    for (const { p, results, failures } of scouted) {
      const t = now();
      for (const r of results) {
        await getDb()
          .insert(schema.opportunities)
          .values({
            id: crypto.randomUUID(),
            platform: p.id,
            topic: r.topic,
            query: r.query,
            score: r.score,
            summary: r.summary,
            evidence: JSON.stringify(r.evidence),
            ownerEmail: owner,
            createdAt: t,
            updatedAt: t,
          })
          .onConflictDoUpdate({
            target: [schema.opportunities.ownerEmail, schema.opportunities.platform, schema.opportunities.topic],
            set: {
              score: sql`excluded.score`,
              summary: sql`excluded.summary`,
              evidence: sql`excluded.evidence`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
      summary.push({ platform: p.id, found: results.length, topScore: results[0]?.score ?? 0, failures });
    }
    return { ranAt: now(), summary };
  },
});
