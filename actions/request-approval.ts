import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getBuildOr404, now, parseJson, requireOwner } from "../server/lib/forge.js";

export default defineAction({
  description:
    "Send a vetted build to the human approval queue. Refused unless the latest vetting verdict is pass or review. Only a person can approve or reject from the Approvals screen.",
  schema: z.object({ id: z.string().describe("Build id") }),
  run: async ({ id }, ctx) => {
    const owner = requireOwner(ctx);
    const b = await getBuildOr404(id, owner);
    const vet = parseJson<{ verdict: string }>(b.vet);
    if (!vet) fail("Run vet-build first.", { statusCode: 409, errorCode: "not_vetted" });
    if (vet.verdict === "fail")
      fail("Vetting failed. Fix the failing checks and vet again.", { statusCode: 409, errorCode: "vet_failed" });
    const res = await getDb()
      .update(schema.builds)
      .set({ status: "awaiting_approval", updatedAt: now() })
      .where(and(eq(schema.builds.id, id), eq(schema.builds.status, "drafting")))
      .returning({ id: schema.builds.id });
    if (!res.length) fail(`Build is ${b.status}, not drafting.`, { statusCode: 409, errorCode: "bad_state" });
    return { id, status: "awaiting_approval" };
  },
});
