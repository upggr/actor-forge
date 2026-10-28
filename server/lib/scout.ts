import type { Platform, Seed } from "./platforms.js";

export interface GapResult {
  topic: string;
  query: string;
  score: number;
  summary: string;
  evidence: Record<string, unknown>;
}

async function getJson(url: string, attempt = 0): Promise<any> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json", "user-agent": "actor-forge" },
  });
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Gap = real demand around the topic, little or weak supply for the exact topic. */
export function gapScore(demand: number, weakness: number) {
  const base = 0.45 * clamp01(demand) + 0.55 * clamp01(weakness);
  // Missing supply only counts as a gap when someone wants the thing: with near-zero demand the score is cut sharply.
  const confidence = 0.35 + 0.65 * clamp01(demand * 5);
  return Math.round(100 * base * confidence);
}

async function scoutApify(p: Platform, seed: Seed, categoryCache: Map<string, number>): Promise<GapResult> {
  const api = p.discover.apiUrl!;
  const hits = await getJson(`${api}?search=${encodeURIComponent(seed.query)}&limit=30`);
  const needle = seed.query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matching = (hits.data.items as any[]).filter((a) =>
    `${a.title} ${a.name}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle),
  );
  matching.sort((a, b) => b.stats.totalUsers30Days - a.stats.totalUsers30Days);
  const best = matching[0];

  let categoryUsers = 0;
  if (seed.category) {
    if (!categoryCache.has(seed.category)) {
      const cat = await getJson(
        `${api}?category=${encodeURIComponent(seed.category)}&sortBy=popularity&limit=20`,
      );
      categoryCache.set(
        seed.category,
        (cat.data.items as any[]).reduce((s, a) => s + (a.stats?.totalUsers30Days ?? 0), 0),
      );
    }
    categoryUsers = categoryCache.get(seed.category)!;
  }

  const totalUsers = matching.reduce((n, a) => n + (a.stats?.totalUsers30Days ?? 0), 0);
  const bestUsers = best?.stats.totalUsers30Days ?? 0;
  const rating = best?.stats.actorReviewCount > 2 ? best.actorReviewRating : null;
  const run = best?.stats.publicActorRunStats30Days;
  const failRate = run && run.TOTAL >= 20 ? ((run.FAILED ?? 0) + (run["TIMED-OUT"] ?? 0)) / run.TOTAL : null;

  // Proven demand = users already paying across every actor for this site; weakness = how badly the leader serves them.
  // With no actor at all there is no proof of demand, so it falls back to a discounted category signal.
  const demand = best ? clamp01(Math.log10(1 + totalUsers) / 3.5) : 0.6 * clamp01(Math.log10(1 + categoryUsers) / 5);
  const weakness = best
    ? 0.5 * (rating !== null ? clamp01((4.6 - rating) / 1.6) : 0.4) + 0.5 * clamp01((failRate ?? 0.1) * 4)
    : 1;
  const score = gapScore(demand, weakness);

  const summary = best
    ? `${matching.length} actor(s) share ${totalUsers.toLocaleString()} users/30d for "${seed.query}". Leader: ${bestUsers} users${rating !== null ? `, ${rating.toFixed(1)} stars` : ""}${failRate !== null ? `, ${Math.round(failRate * 100)}% of runs fail` : ""}.`
    : `No actor found for "${seed.query}" in the Store.`;
  return {
    topic: seed.topic,
    query: seed.query,
    score,
    summary,
    evidence: {
      type: "apify-store",
      matchingActors: matching.length,
      totalUsers30d: totalUsers,
      categoryUsers30d: categoryUsers,
      category: seed.category ?? null,
      leader: best
        ? {
            title: best.title,
            url: `https://apify.com/${best.username}/${best.name}`,
            users30d: bestUsers,
            rating,
            reviews: best.stats.actorReviewCount,
            failRate,
          }
        : null,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function scoutMcp(p: Platform, seed: Seed): Promise<GapResult> {
  const d = p.discover;
  const q = encodeURIComponent(seed.query);
  // Not limited to the mcp-server keyword: many real servers are untagged, so match on name, description and keywords.
  const mcpNpm = await getJson(`${d.npmSearchUrl}?text=${encodeURIComponent(`${seed.query} mcp`)}&size=25`);
  const topicNpm = await getJson(`${d.npmSearchUrl}?text=${q}&size=20`);
  const registry = await getJson(`${d.registryUrl}?search=${q}&limit=20`);
  const needle = seed.query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mentions = (o: any) =>
    `${o.package.name} ${o.package.description ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle);
  const isMcp = (o: any) =>
    `${o.package.name} ${o.package.description ?? ""} ${(o.package.keywords ?? []).join(" ")}`.toLowerCase().includes("mcp");
  const relevant = (mcpNpm.objects as any[]).filter((o) => mentions(o) && isMcp(o));
  const registryHits = new Set(
    (registry.servers as any[])
      .filter((s) =>
        `${s.server?.name ?? ""} ${s.server?.description ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle),
      )
      .map((s) => s.server.name),
  ).size;
  const bestWeekly = Math.max(0, ...relevant.map((o) => o.downloads?.weekly ?? 0));
  const topicMonthly = (topicNpm.objects as any[]).filter(mentions).reduce((s, o) => s + (o.downloads?.monthly ?? 0), 0);

  const demand = Math.log10(1 + topicMonthly) / 6;
  const supply = relevant.length + registryHits;
  // Every existing server cuts the gap sharply; a popular one cuts it further.
  const weakness = (1 / (1 + 0.8 * supply)) * (1 - Math.min(0.5, Math.log10(1 + bestWeekly) / 8));
  const score = gapScore(demand, weakness);
  return {
    topic: seed.topic,
    query: seed.query,
    score,
    summary:
      supply === 0
        ? `No MCP server for "${seed.query}" on npm or the registry; ${topicMonthly.toLocaleString()} monthly downloads of related packages.`
        : `${relevant.length} npm MCP package(s) and ${registryHits} registry entr${registryHits === 1 ? "y" : "ies"} for "${seed.query}".`,
    evidence: {
      type: "mcp-npm",
      npmMcpPackages: relevant.map((o) => ({ name: o.package.name, weekly: o.downloads?.weekly ?? 0 })),
      registryEntries: registryHits,
      relatedPackageDownloads30d: topicMonthly,
      checkedAt: new Date().toISOString(),
    },
  };
}


const builtinCache = new Map<string, Promise<string[]>>();
function builtinNames(url: string): Promise<string[]> {
  if (!builtinCache.has(url))
    builtinCache.set(
      url,
      getJson(url).then((l: any[]) => l.map((x) => String(x.name))),
    );
  return builtinCache.get(url)!;
}

/** Generic npm catalog: supply = packages mentioning the topic and the marker (e.g. "n8n"); demand = downloads of topic packages. */
async function scoutNpm(p: Platform, seed: Seed): Promise<GapResult> {
  const d = p.discover;
  const marker = (d.marker ?? "").toLowerCase();
  const q = encodeURIComponent(seed.query);
  const needle = seed.query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const norm = (o: any) =>
    `${o.package.name} ${o.package.description ?? ""} ${(o.package.keywords ?? []).join(" ")}`.toLowerCase();
  const mentions = (o: any) => norm(o).replace(/[^a-z0-9]/g, "").includes(needle);
  const supplyHits = await getJson(`${d.npmSearchUrl}?text=${encodeURIComponent(`${seed.query} ${marker}`)}&size=25`);
  const topicHits = await getJson(`${d.npmSearchUrl}?text=${q}&size=20`);
  const relevant = (supplyHits.objects as any[]).filter((o) => mentions(o) && norm(o).includes(marker));
  const bestWeekly = Math.max(0, ...relevant.map((o) => o.downloads?.weekly ?? 0));
  const topicMonthly = (topicHits.objects as any[]).filter(mentions).reduce((s, o) => s + (o.downloads?.monthly ?? 0), 0);
  const demand = Math.log10(1 + topicMonthly) / 6;
  const builtin = d.builtinIndexUrl
    ? (await builtinNames(d.builtinIndexUrl)).filter((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle))
    : [];
  const supply = relevant.length + builtin.length;
  // A node that ships with the host app leaves no gap to fill.
  const weakness = builtin.length
    ? 0.03
    : (1 / (1 + 0.8 * supply)) * (1 - Math.min(0.5, Math.log10(1 + bestWeekly) / 8));
  return {
    topic: seed.topic,
    query: seed.query,
    score: gapScore(demand, weakness),
    summary:
      supply === 0
        ? `No ${marker} node for "${seed.query}" (built-in or community); ${topicMonthly.toLocaleString()} monthly downloads of related packages.`
        : builtin.length
          ? `${seed.query} already ships as a built-in ${marker} node (${builtin.join(", ")}).`
          : `${supply} ${marker} package(s) for "${seed.query}"; the best has ${bestWeekly.toLocaleString()} downloads/week.`,
    evidence: {
      type: "npm-search",
      marker,
      builtinNodes: builtin,
      packages: relevant.map((o) => ({ name: o.package.name, weekly: o.downloads?.weekly ?? 0 })),
      relatedPackageDownloads30d: topicMonthly,
      checkedAt: new Date().toISOString(),
    },
  };
}

/** Hugging Face: demand = downloads of models on the topic; supply = Spaces that already serve it. */
async function scoutHf(p: Platform, seed: Seed): Promise<GapResult> {
  const api = p.discover.apiUrl!;
  const q = encodeURIComponent(seed.query);
  const [spaces, models] = await Promise.all([
    getJson(`${api}/spaces?search=${q}&limit=30&sort=likes&direction=-1`),
    getJson(`${api}/models?search=${q}&limit=10&sort=downloads&direction=-1`),
  ]);
  const needle = seed.query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matching = (spaces as any[]).filter((s) => String(s.id).toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle));
  const bestLikes = Math.max(0, ...matching.map((s) => s.likes ?? 0));
  const modelDownloads = (models as any[]).reduce((n, m) => n + (m.downloads ?? 0), 0);
  const demand = Math.log10(1 + modelDownloads) / 6;
  const weakness = (1 / (1 + 0.5 * matching.length)) * (1 - Math.min(0.5, Math.log10(1 + bestLikes) / 5));
  return {
    topic: seed.topic,
    query: seed.query,
    score: gapScore(demand, weakness),
    summary:
      matching.length === 0
        ? `No Space matches "${seed.query}"; related models have ${modelDownloads.toLocaleString()} downloads.`
        : `${matching.length} Space(s) match "${seed.query}"; the best has ${bestLikes} likes. Related models: ${modelDownloads.toLocaleString()} downloads.`,
    evidence: {
      type: "hf-spaces",
      matchingSpaces: matching.length,
      bestSpace: matching.length ? { id: matching.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))[0].id, likes: bestLikes } : null,
      relatedModelDownloads: modelDownloads,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function scoutSeed(p: Platform, seed: Seed, categoryCache: Map<string, number>): Promise<GapResult> {
  switch (p.discover.type) {
    case "apify-store":
      return scoutApify(p, seed, categoryCache);
    case "mcp-npm":
      return scoutMcp(p, seed);
    case "npm-search":
      return scoutNpm(p, seed);
    case "hf-spaces":
      return scoutHf(p, seed);
  }
}

/** Run every seed of a platform with a small concurrency limit; per-seed failures are reported, not hidden. */
export async function scoutPlatform(p: Platform) {
  const categoryCache = new Map<string, number>();
  const results: GapResult[] = [];
  const failures: { topic: string; error: string }[] = [];
  const queue = [...p.discover.seeds];
  const worker = async () => {
    for (let seed = queue.shift(); seed; seed = queue.shift()) {
      try {
        results.push(await scoutSeed(p, seed, categoryCache));
      } catch (e) {
        failures.push({ topic: seed.topic, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  const workers = p.discover.type === "mcp-npm" || p.discover.type === "npm-search" ? 1 : 3;
  await Promise.all(Array.from({ length: workers }, worker));
  return { results: results.sort((a, b) => b.score - a.score), failures };
}

/** Re-check a single seed (used by Keeper to see whether supply changed). */
export async function scoutOne(p: Platform, seed: Seed): Promise<GapResult> {
  return scoutSeed(p, seed, new Map());
}
