import { fail } from "@agent-native/core/action";
import { resolveSecretDetailed } from "@agent-native/core/server";

import { perThousandResults, priceLabel } from "./pricing.js";

const API = "https://api.apify.com/v2";

/** Calls the Apify API as the signed-in user. The token comes from the secrets store and never leaves this file. */
export async function apifyGet(path: string): Promise<any> {
  const secret = await resolveSecretDetailed("APIFY_TOKEN");
  if (secret.lookupFailed)
    fail("Could not read the stored Apify token. Try again.", { statusCode: 503, errorCode: "secret_lookup_failed" });
  if (!secret.value)
    fail("Connect Apify first: add APIFY_TOKEN under Settings, API keys.", { statusCode: 409, errorCode: "no_token" });
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${secret.value}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403)
    fail("Apify rejected the token. Check APIFY_TOKEN in Settings, API keys.", { statusCode: 409, errorCode: "token_rejected" });
  if (!res.ok) fail(`Apify returned HTTP ${res.status}.`, { statusCode: 502, errorCode: "apify_error" });
  return (await res.json()).data;
}

export interface ActorHealth {
  id: string;
  name: string;
  title: string | null;
  url: string;
  isPublic: boolean;
  users30d: number;
  totalRuns: number;
  runs30d: number;
  failRate30d: number | null;
  pricing: string | null;
  pricePer1000: number | null;
  rating: number | null;
  modifiedAt: string | null;
  issues: string[];
}

const current = (a: any) => a.currentPricingInfo ?? (Array.isArray(a.pricingInfos) ? a.pricingInfos[a.pricingInfos.length - 1] : null);

export function summarizeActor(a: any): ActorHealth {
  const s = a.stats ?? {};
  const run = s.publicActorRunStats30Days;
  const total = run?.TOTAL ?? 0;
  const failed = (run?.FAILED ?? 0) + (run?.["TIMED-OUT"] ?? 0);
  const failRate = total >= 10 ? failed / total : null;
  const issues: string[] = [];
  if (failRate !== null && failRate > 0.2) issues.push(`${Math.round(failRate * 100)}% of runs failed in the last 30 days`);
  if (a.isPublic && (s.totalUsers30Days ?? 0) === 0) issues.push("No users in the last 30 days");
  if (a.isPublic && !current(a)) issues.push("No pricing set");
  return {
    id: a.id,
    name: a.name,
    title: a.title ?? null,
    url: `https://console.apify.com/actors/${a.id}`,
    isPublic: Boolean(a.isPublic),
    users30d: s.totalUsers30Days ?? 0,
    totalRuns: s.totalRuns ?? 0,
    runs30d: total,
    failRate30d: failRate,
    pricing: priceLabel(current(a)),
    pricePer1000: perThousandResults(current(a)),
    rating: (a.stats?.actorReviewCount ?? 0) > 2 ? (a.stats?.actorReviewRating ?? null) : null,
    modifiedAt: a.modifiedAt ?? null,
    issues,
  };
}

/** Lists the user's own actors with health, five at a time to stay polite to the API. */
export async function listActorHealth(limit = 50): Promise<ActorHealth[]> {
  const mine = await apifyGet(`/acts?my=true&limit=${limit}&desc=true`);
  const ids: string[] = (mine.items ?? []).map((x: any) => x.id);
  const out: ActorHealth[] = [];
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map((id) => apifyGet(`/acts/${id}`)));
    out.push(...batch.map(summarizeActor));
  }
  return out;
}
