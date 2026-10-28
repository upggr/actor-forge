import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getBuildOr404, now, requireOwner, safeBuildPath } from "../server/lib/forge.js";
import { listFiles, buildDir } from "../server/lib/vet.js";

export default defineAction({
  description:
    "Create or overwrite ONE file in a build that is still drafting. Always pass all three arguments: buildId, path (for example nodes/Starter/helpers.js) and the full content. Editing a file clears the previous vetting report, so run vet-build again afterwards.",
  schema: z.object({
    buildId: z.string().describe("Build id"),
    path: z.string().min(1).max(200).describe("Build-relative path, e.g. src/parse.mjs"),
    content: z.string().max(200_000).describe("Full file contents (UTF-8)"),
  }),
  run: async (args, ctx) => {
    const owner = requireOwner(ctx);
    const b = await getBuildOr404(args.buildId, owner);
    if (b.status !== "drafting")
      fail(`Build is ${b.status}; only drafting builds can be edited.`, { statusCode: 409, errorCode: "not_drafting" });
    const full = safeBuildPath(args.buildId, args.path);
    if (!fs.existsSync(full) && listFiles(buildDir(args.buildId)).length >= 80)
      fail("A build can hold at most 80 files.", { statusCode: 400, errorCode: "too_many_files" });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, args.content);
    await getDb().update(schema.builds).set({ vet: null, updatedAt: now() }).where(eq(schema.builds.id, b.id));
    return { id: b.id, path: args.path, bytes: Buffer.byteLength(args.content) };
  },
});
