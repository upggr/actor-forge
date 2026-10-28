import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getBuildOr404, parseJson, requireOwner, safeBuildPath } from "../server/lib/forge.js";
import { buildDir, listFiles } from "../server/lib/vet.js";

export default defineAction({
  description:
    "Get one build with its opportunity evidence, file list, vetting report, Keeper report and publish result. Pass file to also read one file's contents.",
  schema: z.object({
    id: z.string().describe("Build id from list-builds"),
    file: z.string().optional().describe("Build-relative path of a file to read, e.g. src/parse.mjs"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id, file }, ctx) => {
    const owner = requireOwner(ctx);
    const b = await getBuildOr404(id, owner);
    const [opp] = await getDb()
      .select()
      .from(schema.opportunities)
      .where(eq(schema.opportunities.id, b.opportunityId))
      .limit(1);
    let fileContent: string | undefined;
    if (file) {
      const full = safeBuildPath(id, file);
      fileContent = fs.existsSync(full) ? fs.readFileSync(full, "utf8").slice(0, 60_000) : undefined;
    }
    return {
      id: b.id,
      name: b.name,
      platform: b.platform,
      status: b.status,
      opportunity: opp
        ? { id: opp.id, topic: opp.topic, score: opp.score, summary: opp.summary, evidence: parseJson(opp.evidence) }
        : null,
      files: listFiles(buildDir(id)),
      fileContent,
      vet: parseJson(b.vet),
      keeper: parseJson(b.keeper),
      decisionNote: b.decisionNote,
      publishResult: parseJson(b.publishResult),
    };
  },
});
