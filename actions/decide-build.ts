import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getBuildOr404, now, requireOwner } from "../server/lib/forge.js";

// agentTool: false keeps this out of the agent's toolset: approval is a human decision made in the UI.
export default defineAction({
  description: "Human decision on a build awaiting approval: approve it or send it back with a note.",
  agentTool: false,
  mcpTool: false,
  schema: z.object({
    id: z.string().describe("Build id"),
    decision: z.enum(["approve", "reject"]).describe("approve unlocks publishing; reject returns the build to drafting"),
    note: z.string().max(1000).optional().describe("Reason shown to the agent when rejecting"),
  }),
  run: async ({ id, decision, note }, ctx) => {
    const owner = requireOwner(ctx);
    await getBuildOr404(id, owner);
    const next = decision === "approve" ? "approved" : "drafting";
    const res = await getDb()
      .update(schema.builds)
      .set({ status: next, decisionNote: note ?? null, updatedAt: now() })
      .where(and(eq(schema.builds.id, id), eq(schema.builds.status, "awaiting_approval")))
      .returning({ id: schema.builds.id });
    if (!res.length) fail("Build is not awaiting approval.", { statusCode: 409, errorCode: "bad_state" });
    return { id, status: next };
  },
});
