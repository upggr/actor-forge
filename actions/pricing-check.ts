import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listActorHealth } from "../server/lib/apify.js";
import { now, requireOwner } from "../server/lib/forge.js";
import { comparePricing, findCompetitorsFor } from "../server/lib/pricing.js";

export default defineAction({
  description:
    "Compare the price of each of the user's Apify actors with the real prices of competing actors in the Store. Deterministic and read-only toward Apify; when an actor is priced well above or below the market it saves a pricing suggestion for the user to accept or dismiss. Needs APIFY_TOKEN.",
  schema: z.object({
    actorId: z.string().optional().describe("Check only this actor id; omit for every actor"),
  }),
  run: async ({ actorId }, ctx) => {
    const owner = requireOwner(ctx);
    const actors = (await listActorHealth(50)).filter((a) => a.isPublic && (!actorId || a.id === actorId));
    const results = [];
    for (const a of actors) {
      const { query, rivals } = await findCompetitorsFor(a.title, a.name, a.id);
      const v = comparePricing(a.pricePer1000, a.rating, rivals);
      let suggestion: string | null = null;
      const S = schema.suggestions;
      // A re-check replaces the open pricing suggestion for this actor, so a stale one never outlives its evidence.
      await getDb().delete(S).where(and(eq(S.ownerEmail, owner), eq(S.actorId, a.id), eq(S.kind, "pricing"), eq(S.status, "open")));
      if (v.verdict === "above" || v.verdict === "below") {
        suggestion = crypto.randomUUID();
        const t = now();
        await getDb().insert(S).values({
          id: suggestion,
          actorId: a.id,
          actorName: a.title ?? a.name,
          kind: "pricing",
          title: v.verdict === "above" ? "Price is above the market" : "Room to raise the price",
          rationale: v.recommendation,
          evidence: JSON.stringify({ ...v, searchedFor: query, competitors: rivals.slice(0, 5).map((r) => ({ title: r.title, price: r.pricePer1000, users30d: r.users30d, url: r.url })) }),
          ownerEmail: owner,
          createdAt: t,
          updatedAt: t,
        });
      }
      results.push({ actorId: a.id, name: a.title ?? a.name, ...v, suggestion });
    }
    return { checked: results.length, results };
  },
});
