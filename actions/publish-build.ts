import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getBuildOr404, now, platformOr404, requireOwner } from "../server/lib/forge.js";
import { buildDir, listFiles } from "../server/lib/vet.js";

const run = promisify(execFile);

export default defineAction({
  description:
    "Publish an approved build as a DRY RUN. It really packages the project (npm pack --dry-run) and writes the listing, then records exactly which command a live publish would run. Nothing is sent to Apify, npm or the MCP registry.",
  schema: z.object({ id: z.string().describe("Build id of an approved build") }),
  run: async ({ id }, ctx) => {
    const owner = requireOwner(ctx);
    const b = await getBuildOr404(id, owner);
    if (b.status !== "approved")
      fail("Only approved builds can be published. Request approval first.", { statusCode: 409, errorCode: "not_approved" });
    const platform = platformOr404(b.platform);
    const dir = buildDir(id);

    let pack: { name?: string; size?: number; unpackedSize?: number; files: string[] };
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      // Not an npm project (e.g. a Python Space): the package is the file list.
      const all = listFiles(dir).filter((f) => f !== "listing.json");
      pack = { files: all, size: all.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) };
    } else try {
      const { stdout } = await run("npm", ["pack", "--dry-run", "--json"], { cwd: dir, timeout: 60_000 });
      const parsed = JSON.parse(stdout)[0];
      pack = { name: parsed.filename, size: parsed.size, unpackedSize: parsed.unpackedSize, files: parsed.files.map((f: any) => f.path) };
    } catch (e: any) {
      fail(`Packaging failed: ${String(e.stderr ?? e.message).slice(0, 300)}`, { statusCode: 422, errorCode: "pack_failed" });
    }

    const listing = {
      platform: platform.id,
      title: b.name,
      pricing: platform.pricing ?? null,
      readme: fs.readFileSync(path.join(dir, "README.md"), "utf8"),
      createdAt: now(),
    };
    fs.writeFileSync(path.join(dir, "listing.json"), JSON.stringify(listing, null, 2));

    const result = {
      dryRun: true,
      wouldRun: platform.publish.dryRunCommand,
      liveEnabled: platform.publish.liveEnabled,
      package: pack,
      listingFile: "listing.json",
      note: "No live publish was performed. A live publish needs the platform token and is disabled in this build.",
    };
    const res = await getDb()
      .update(schema.builds)
      .set({ status: "published_dry_run", publishResult: JSON.stringify(result), updatedAt: now() })
      .where(and(eq(schema.builds.id, id), eq(schema.builds.status, "approved")))
      .returning({ id: schema.builds.id });
    if (!res.length) fail("Build changed state; reload and try again.", { statusCode: 409, errorCode: "bad_state" });
    return { id, ...result };
  },
});
