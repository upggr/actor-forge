import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, platformOr404, requireOwner, writeFiles } from "../server/lib/forge.js";
import { scaffold, slugify } from "../server/lib/templates.js";

export default defineAction({
  description:
    "Start a build for an open opportunity: creates the build record and writes a runnable starter project (files under builds/<id>/). Then replace the starter files with the real implementation using write-build-file and run vet-build.",
  schema: z.object({
    opportunityId: z.string().describe("Opportunity id from list-opportunities"),
    name: z.string().min(2).max(60).optional().describe("Project name; defaults to the topic"),
  }),
  run: async (args, ctx) => {
    const owner = requireOwner(ctx);
    const o = schema.opportunities;
    const [opp] = await getDb()
      .select()
      .from(o)
      .where(and(eq(o.id, args.opportunityId), eq(o.ownerEmail, owner)))
      .limit(1);
    if (!opp) fail("Opportunity not found.", { statusCode: 404, errorCode: "not_found" });
    if (opp.status !== "open")
      fail(`Opportunity is already ${opp.status}.`, { statusCode: 409, errorCode: "not_open" });
    const platform = platformOr404(opp.platform);

    const name = args.name ?? opp.topic;
    const slug = slugify(name);
    const id = crypto.randomUUID();
    const t = now();

    await getDb().transaction(async (tx) => {
      const claimed = await tx
        .update(o)
        .set({ status: "building", updatedAt: t })
        .where(and(eq(o.id, opp.id), eq(o.status, "open")))
        .returning({ id: o.id });
      if (!claimed.length) fail("Opportunity is already being built.", { statusCode: 409, errorCode: "not_open" });
      await tx.insert(schema.builds).values({
        id,
        opportunityId: opp.id,
        platform: opp.platform,
        name,
        slug,
        ownerEmail: owner,
        createdAt: t,
        updatedAt: t,
      });
    });
    const files = scaffold(platform, slug, opp.topic, opp.query);
    writeFiles(id, files);
    return { id, name, slug, platform: platform.id, files: Object.keys(files), status: "drafting" };
  },
});
