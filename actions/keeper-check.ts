import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { now, parseJson, requireOwner } from "../server/lib/forge.js";
import { getPlatform } from "../server/lib/platforms.js";
import { scoutOne } from "../server/lib/scout.js";
import { listActorHealth } from "../server/lib/apify.js";
import { resolveSecretDetailed } from "@agent-native/core/server";
import { isLive } from "../server/lib/enabled.js";
import { latestBuild } from "../server/lib/live/apify.js";
import { publishLive } from "../server/lib/publish.js";
import { vetBuild } from "../server/lib/vet.js";

export default defineAction({
  description:
    "Keeper: re-run vetting on every build that is awaiting approval, approved or published (dry run), and re-check the market for each one. Reports regressions and new competitors as alerts.",
  schema: z.object({}),
  run: async (_args, ctx) => {
    const owner = requireOwner(ctx);
    const b = schema.builds;
    const rows = await getDb()
      .select()
      .from(b)
      .where(and(eq(b.ownerEmail, owner), inArray(b.status, ["awaiting_approval", "approved", "published_dry_run", "published"])));
    const alerts: { buildId: string; name: string; kind: string; detail: string }[] = [];
    for (const row of rows) {
      const platform = getPlatform(row.platform);
      if (!platform) continue;
      const before = parseJson<{ verdict: string }>(row.vet);
      const vet = await vetBuild(platform, row.id);
      if (before && before.verdict !== vet.verdict && vet.verdict === "fail")
        alerts.push({ buildId: row.id, name: row.name, kind: "regression", detail: `Vetting went from ${before.verdict} to fail.` });

      const [opp] = await getDb().select().from(schema.opportunities).where(eq(schema.opportunities.id, row.opportunityId)).limit(1);
      let market: Record<string, unknown> | null = null;
      if (opp) {
        const seed = platform.discover.seeds.find((s) => s.topic === opp.topic);
        if (seed) {
          const fresh = await scoutOne(platform, seed);
          const old = parseJson<any>(opp.evidence);
          const was = old?.matchingActors ?? old?.npmMcpPackages?.length ?? 0;
          const nowCount = (fresh.evidence as any).matchingActors ?? (fresh.evidence as any).npmMcpPackages?.length ?? 0;
          market = { gapScoreThen: opp.score, gapScoreNow: fresh.score, competitorsThen: was, competitorsNow: nowCount };
          if (nowCount > was)
            alerts.push({ buildId: row.id, name: row.name, kind: "new-competitor", detail: `Competitors for "${opp.topic}" rose from ${was} to ${nowCount}.` });
        }
      }
      await getDb()
        .update(b)
        .set({ vet: JSON.stringify(vet), keeper: JSON.stringify({ ranAt: now(), market, vetVerdict: vet.verdict }), updatedAt: now() })
        .where(eq(b.id, row.id));
    }

    // Scheduled uploading and maintenance of actors this app built (only where real uploading is switched on).
    const uploads: { name: string; result: string }[] = [];
    const token = (await resolveSecretDetailed("APIFY_TOKEN")).value;
    for (const row of rows) {
      const platform = getPlatform(row.platform);
      if (!platform?.publish.liveSupported || !(await isLive(owner, platform.id))) continue;
      if (row.status === "approved") {
        try {
          await publishLive(owner, row, platform);
          uploads.push({ name: row.name, result: "uploaded as a private actor and built" });
        } catch (e) {
          alerts.push({ buildId: row.id, name: row.name, kind: "upload-failed", detail: e instanceof Error ? e.message.slice(0, 220) : "Upload failed" });
        }
      } else if (row.status === "published" && token) {
        const actorId = parseJson<{ uploaded?: { actorId?: string } }>(row.publishResult)?.uploaded?.actorId;
        if (!actorId) continue;
        try {
          const lb = await latestBuild(token, actorId);
          if (lb && lb.status !== "SUCCEEDED") alerts.push({ buildId: row.id, name: row.name, kind: "actor-build-failing", detail: `The latest Apify build is ${lb.status}.` });
        } catch { /* a transient API error should not raise a false alert */ }
      }
    }

    // Live actors: only when the user has connected Apify. A missing or rejected token is reported, never hidden.
    let portfolio: { checked: number } | { skipped: string } = { skipped: "not connected" };
    try {
      const actors = await listActorHealth(50);
      portfolio = { checked: actors.length };
      for (const a of actors.filter((x) => x.issues.length))
        alerts.push({ buildId: a.id, name: a.title ?? a.name, kind: "live-actor", detail: a.issues.join("; ") });
    } catch (e) {
      portfolio = { skipped: e instanceof Error ? e.message : "unavailable" };
    }
    return { checked: rows.length, uploads, portfolio, alerts, ranAt: now() };
  },
});
