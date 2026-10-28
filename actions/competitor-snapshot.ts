import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { findCompetitors } from "../server/lib/pricing.js";
import { requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description:
    "Public Apify Store snapshot of actors matching a search: title, short description, users in the last 30 days, rating and price. Use it as the evidence for feature suggestions; no token needed.",
  schema: z.object({
    query: z.string().min(2).max(80).describe("What the actor does, e.g. 'trustpilot reviews'"),
    limit: z.coerce.number().int().min(1).max(15).default(8),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ query, limit }, ctx) => {
    requireOwner(ctx);
    return { query, competitors: await findCompetitors(query, null, limit) };
  },
});
