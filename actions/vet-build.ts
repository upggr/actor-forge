import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getBuildOr404, now, platformOr404, requireOwner } from "../server/lib/forge.js";
import { vetBuild } from "../server/lib/vet.js";

export default defineAction({
  description:
    "Vet a build by really running its checks: required files, JSON validity, node --check syntax, the build's own unit tests, a secret scan and platform rules. Returns a pass / review / fail verdict with one line of evidence per check.",
  schema: z.object({ id: z.string().describe("Build id") }),
  run: async ({ id }, ctx) => {
    const owner = requireOwner(ctx);
    const b = await getBuildOr404(id, owner);
    if (b.status !== "drafting" && b.status !== "awaiting_approval")
      fail(`Build is ${b.status}; vetting only applies while drafting or awaiting approval.`, {
        statusCode: 409,
        errorCode: "bad_state",
      });
    const report = await vetBuild(platformOr404(b.platform), id);
    await getDb()
      .update(schema.builds)
      .set({ vet: JSON.stringify(report), updatedAt: now() })
      .where(eq(schema.builds.id, id));
    return { id, ...report };
  },
});
