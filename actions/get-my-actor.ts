import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { apifyGet, summarizeActor } from "../server/lib/apify.js";
import { requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description: "Get one of the user's Apify actors with its health and its 10 most recent runs. Read-only.",
  schema: z.object({ id: z.string().regex(/^[A-Za-z0-9]{6,32}$/).describe("Actor id from list-my-actors") }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }, ctx) => {
    requireOwner(ctx);
    const [actor, runs] = await Promise.all([apifyGet(`/acts/${id}`), apifyGet(`/acts/${id}/runs?limit=10&desc=true`)]);
    return {
      ...summarizeActor(actor),
      description: actor.description ?? null,
      runs: (runs.items ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        startedAt: r.startedAt ?? null,
        seconds: r.stats?.runTimeSecs ?? null,
        costUsd: r.usageTotalUsd ?? null,
      })),
    };
  },
});
