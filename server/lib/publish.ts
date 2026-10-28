import { fail } from "@agent-native/core/action";
import { resolveSecretDetailed } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import { getDb, schema } from "../db/index.js";
import { now, parseJson } from "./forge.js";
import { ApifyUploadError, createAndBuild, updateAndBuild } from "./live/apify.js";
import type { Platform } from "./platforms.js";
import { buildDir, listFiles } from "./vet.js";

type Build = typeof schema.builds.$inferSelect;

export function readBuildFiles(id: string): Record<string, string> {
  const dir = buildDir(id);
  const out: Record<string, string> = {};
  for (const rel of listFiles(dir)) {
    const full = path.join(dir, rel);
    if (fs.statSync(full).size > 400_000) continue;
    out[rel] = fs.readFileSync(full, "utf8");
  }
  return out;
}

/**
 * Uploads an approved build to Apify as a private actor and builds it there. A failed build keeps the actor id,
 * so the next attempt updates that actor instead of creating a duplicate.
 */
export async function publishLive(owner: string, b: Build, platform: Platform, onProgress?: (m: string) => void) {
  const secret = await resolveSecretDetailed("APIFY_TOKEN");
  if (secret.lookupFailed) fail("Could not read the stored Apify token. Try again.", { statusCode: 503, errorCode: "secret_lookup_failed" });
  if (!secret.value) fail("Connect Apify first: add APIFY_TOKEN under Settings, API keys.", { statusCode: 409, errorCode: "no_token" });

  const prior = parseJson<{ uploaded?: { actorId?: string } }>(b.publishResult)?.uploaded?.actorId;
  const [opp] = await getDb().select().from(schema.opportunities).where(eq(schema.opportunities.id, b.opportunityId)).limit(1);
  const spec = {
    name: b.slug,
    title: b.name,
    description: `${opp?.topic ?? b.name}. Built with Actor Forge from a gap found on ${platform.name}; private until you publish it.`.slice(0, 300),
    files: readBuildFiles(b.id),
  };

  const S = schema.builds;
  try {
    const opts = onProgress ? { onProgress } : {};
    let uploaded;
    if (prior) {
      try {
        uploaded = await updateAndBuild(secret.value, prior, spec, opts);
      } catch (e) {
        // The actor was deleted in the Console since the last attempt: create it again instead of failing.
        if (e instanceof ApifyUploadError && e.code === "api_error" && (e.detail as any)?.status === 404) uploaded = await createAndBuild(secret.value, spec, opts);
        else throw e;
      }
    } else uploaded = await createAndBuild(secret.value, spec, opts);
    const result = { dryRun: false, uploaded, publishedAt: now(), note: "Uploaded as a private actor. Making it public, listing it in the Store and setting a price are your decisions in the Apify Console." };
    await getDb().update(S).set({ status: "published", publishResult: JSON.stringify(result), updatedAt: now() }).where(and(eq(S.id, b.id), eq(S.ownerEmail, owner)));
    return result;
  } catch (e) {
    if (e instanceof ApifyUploadError) {
      const partial = e.code === "build_failed" || e.code === "build_timeout" ? (e.detail as any) : null;
      await getDb()
        .update(S)
        .set({ publishResult: JSON.stringify({ dryRun: false, uploaded: partial, error: e.message, errorAt: now() }), updatedAt: now() })
        .where(and(eq(S.id, b.id), eq(S.ownerEmail, owner)));
      const status = e.code === "token_rejected" ? 409 : e.code === "name_taken" ? 409 : 502;
      fail(e.message + (partial?.logTail?.length ? ` Last build log lines: ${partial.logTail.slice(-6).join(" | ")}` : ""), { statusCode: status, errorCode: e.code });
    }
    throw e;
  }
}
