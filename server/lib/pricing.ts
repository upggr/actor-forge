const STORE = "https://api.apify.com/v2/store";

/** Comparable list price in USD per 1,000 results, or null when the model is not per-result (e.g. a monthly rental). */
export function perThousandResults(info: any): number | null {
  if (!info) return null;
  if (info.pricingModel === "PRICE_PER_DATASET_ITEM" && typeof info.pricePerUnitUsd === "number")
    return round(info.pricePerUnitUsd * 1000);
  if (info.pricingModel === "PAY_PER_EVENT") {
    const events = info.pricingPerEvent?.actorChargeEvents ?? {};
    const primary =
      Object.values<any>(events).find((e) => e.isPrimaryEvent) ?? events["apify-default-dataset-item"] ?? null;
    if (!primary) return null;
    const price = primary.eventPriceUsd ?? primary.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd;
    return typeof price === "number" ? round(price * 1000) : null;
  }
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function priceLabel(info: any): string | null {
  const p = perThousandResults(info);
  if (p !== null) return `$${p} per 1,000 results`;
  if (info?.pricingModel === "FLAT_PRICE_PER_MONTH") return `$${info.pricePerUnitUsd}/month rental`;
  if (info?.pricingModel === "PAY_PER_EVENT") return "pay per event";
  return info?.pricingModel ? String(info.pricingModel).toLowerCase().replace(/_/g, " ") : null;
}

export interface Competitor {
  id: string;
  title: string;
  url: string;
  users30d: number;
  rating: number | null;
  pricePer1000: number | null;
  priceLabel: string | null;
  description: string;
}

const NOISE = new Set(["scraper", "scrapers", "actor", "api", "crawler", "extractor", "tool", "data", "bot", "by", "and", "the", "all", "no", "cap", "ai", "pro", "fast", "cheap"]);

/** Search words for "who else does this": the leading meaningful words of the title, without prices or marketing. */
export function competitorWords(title: string | null, name: string): string[] {
  // A title carries marketing after a separator ("Foo Scraper | $1 | No Cap"); a name is slug-like ("foo-scraper").
  const text = title ? title.split(/[|·•–—:(]|\s-\s/)[0]! : name.replace(/[-_]+/g, " ");
  const words = text
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^[\d.]+$/.test(w) && !NOISE.has(w.toLowerCase()));
  return words.length ? words : name.split(/[-_]/).filter(Boolean);
}

export const competitorQuery = (title: string | null, name: string) => competitorWords(title, name).slice(0, 3).join(" ");

/** Tries 3, then 2, then 1 leading words until enough competitors turn up. */
export async function findCompetitorsFor(title: string | null, name: string, ownId: string | null, limit = 10): Promise<{ query: string; rivals: Competitor[] }> {
  const words = competitorWords(title, name);
  let best = { query: words.slice(0, 3).join(" "), rivals: [] as Competitor[] };
  for (const n of [3, 2, 1]) {
    if (n > words.length && n !== 1) continue;
    const query = words.slice(0, n).join(" ");
    const rivals = relevantTo(await findCompetitors(query, ownId, 30), words.slice(0, n)).slice(0, limit);
    if (rivals.length > best.rivals.length) best = { query, rivals };
    if (rivals.filter((r) => r.pricePer1000 !== null).length >= 3) return { query, rivals };
  }
  return best;
}

/** Keeps competitors whose title mentions every key word, so "YouTube Comments" is not compared with a generic "YouTube Scraper". */
export function relevantTo(rivals: Competitor[], words: string[]): Competitor[] {
  const need = words.map((w) => w.toLowerCase());
  return rivals.filter((r) => {
    const hay = r.title.toLowerCase();
    return need.every((w) => hay.includes(w));
  });
}

export async function findCompetitors(query: string, ownId: string | null, limit = 10): Promise<Competitor[]> {
  const res = await fetch(`${STORE}?search=${encodeURIComponent(query)}&limit=30&sortBy=popularity`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Apify Store search returned HTTP ${res.status}`);
  const items: any[] = (await res.json()).data.items ?? [];
  return items
    .filter((a) => a.id !== ownId)
    .map((a) => ({
      id: a.id as string,
      title: a.title as string,
      url: `https://apify.com/${a.username}/${a.name}`,
      users30d: a.stats?.totalUsers30Days ?? 0,
      rating: (a.actorReviewCount ?? 0) > 2 ? (a.actorReviewRating as number) : null,
      pricePer1000: perThousandResults(a.currentPricingInfo),
      priceLabel: priceLabel(a.currentPricingInfo),
      description: String(a.description ?? "").slice(0, 200),
    }))
    .sort((a, b) => b.users30d - a.users30d)
    .slice(0, limit);
}

export interface PricingVerdict {
  verdict: "above" | "in-line" | "below" | "unknown";
  ownPrice: number | null;
  median: number | null;
  comparable: number;
  deltaPct: number | null;
  recommendation: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Rule-based and deterministic: a verdict needs at least 5 comparable competitors, and only a gap of more than 50% either way is called out (store prices vary widely). */
export function comparePricing(ownPrice: number | null, ownRating: number | null, rivals: Competitor[]): PricingVerdict {
  // Actors with almost no users are not a market signal, so they are left out of the comparison.
  const priced = rivals.filter((r) => r.pricePer1000 !== null && r.users30d >= 5);
  if (ownPrice === null)
    return { verdict: "unknown", ownPrice, median: null, comparable: priced.length, deltaPct: null, recommendation: "No per-result price is set, so there is nothing to compare." };
  if (priced.length < 5)
    return { verdict: "unknown", ownPrice, median: null, comparable: priced.length, deltaPct: null, recommendation: `Only ${priced.length} comparable competitor(s) found; not enough to judge pricing.` };
  const m = median(priced.map((r) => r.pricePer1000!));
  const deltaPct = Math.round(((ownPrice - m) / m) * 100);
  const topRated = Math.max(0, ...priced.map((r) => r.rating ?? 0));
  if (deltaPct > 50) {
    const justified = ownRating !== null && ownRating >= topRated;
    return {
      verdict: "above", ownPrice, median: round(m), comparable: priced.length, deltaPct,
      recommendation: justified
        ? `Priced ${deltaPct}% above the median ($${round(m)}) but rated at or above every competitor, so the premium may be justified. Watch conversion.`
        : `Priced ${deltaPct}% above the median ($${round(m)}) of ${priced.length} competitors without a rating lead. Consider lowering toward $${round(m * 1.15)}.`,
    };
  }
  if (deltaPct < -50)
    return {
      verdict: "below", ownPrice, median: round(m), comparable: priced.length, deltaPct,
      recommendation: `Priced ${Math.abs(deltaPct)}% below the median ($${round(m)}) of ${priced.length} competitors. There is room to raise toward $${round(m * 0.85)} if quality holds.`,
    };
  return { verdict: "in-line", ownPrice, median: round(m), comparable: priced.length, deltaPct, recommendation: `In line with the market (median $${round(m)} across ${priced.length} competitors).` };
}
