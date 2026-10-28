import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, requireOwner } from "../server/lib/forge.js";

// Human-only, like decide-build: the agent proposes, the person decides.
export default defineAction({
  description: "Accept or dismiss a suggestion.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({ id: z.string(), decision: z.enum(["accept", "dismiss"]) }),
  run: async ({ id, decision }, ctx) => {
    const owner = requireOwner(ctx);
    const S = schema.suggestions;
    const res = await getDb()
      .update(S)
      .set({ status: decision === "accept" ? "accepted" : "dismissed", updatedAt: now() })
      .where(and(eq(S.id, id), eq(S.ownerEmail, owner), eq(S.status, "open")))
      .returning({ id: S.id });
    if (!res.length) fail("Open suggestion not found.", { statusCode: 404, errorCode: "not_found" });
    return { id, status: decision === "accept" ? "accepted" : "dismissed" };
  },
});
