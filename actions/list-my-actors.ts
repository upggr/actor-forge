import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listActorHealth } from "../server/lib/apify.js";
import { requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description:
    "List the user's own Apify actors with health: users and runs in the last 30 days, failure rate, pricing and issues. Read-only. Needs APIFY_TOKEN in Settings, API keys.",
  schema: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50).describe("Maximum actors to return") }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit }, ctx) => {
    requireOwner(ctx);
    const actors = await listActorHealth(limit);
    return {
      actors,
      totals: {
        actors: actors.length,
        withIssues: actors.filter((a) => a.issues.length).length,
        users30d: actors.reduce((n, a) => n + a.users30d, 0),
      },
    };
  },
});
