import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description:
    "Record a feature or fix suggestion for one of the user's actors. The rationale must cite evidence you actually fetched (for example competitor-snapshot results or run failures); the user accepts or dismisses it. Never invent evidence.",
  schema: z.object({
    actorId: z.string().describe("Actor id from list-my-actors"),
    actorName: z.string().describe("Actor title"),
    kind: z.enum(["feature", "fix"]).describe("feature = something competitors offer; fix = something failing in this actor"),
    title: z.string().min(5).max(100).describe("One-line suggestion"),
    rationale: z.string().min(20).max(1200).describe("Evidence-based reason, naming the competitors or runs it comes from"),
  }),
  run: async (args, ctx) => {
    const owner = requireOwner(ctx);
    const t = now();
    const id = crypto.randomUUID();
    await getDb().insert(schema.suggestions).values({ id, ...args, ownerEmail: owner, createdAt: t, updatedAt: t });
    return { id, status: "open" };
  },
});
