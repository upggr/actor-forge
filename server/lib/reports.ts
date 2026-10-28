import { fail } from "@agent-native/core/action";
import { resolveSecretDetailed } from "@agent-native/core/server";

import type { Platform, Report } from "./platforms.js";

type Format = "text" | "number" | "usd" | "percent" | "date";

export function getPath(obj: any, path: string | undefined): any {
  if (!path) return obj;
  let v = obj;
  for (const key of path.split(".")) v = v?.[key];
  return v;
}

export function formatValue(v: unknown, f: Format): string {
  if (v === null || v === undefined || v === "") return "–";
  if (f === "number") return typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);
  if (f === "usd") return typeof v === "number" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
  if (f === "percent") return typeof v === "number" ? `${Math.round(v * 100)}%` : String(v);
  if (f === "date") {
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? String(v) : new Date(t).toISOString().slice(0, 16).replace("T", " ");
  }
  return String(v);
}

function fill(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const v = getPath(vars, key);
    if (v === undefined || v === null) fail(`Report needs "${key}" which was not available.`, { statusCode: 502, errorCode: "missing_var" });
    return encodeURIComponent(String(v));
  });
}

async function call(p: Platform, url: string, authSpec: { secret: string } | undefined): Promise<any> {
  const u = new URL(url);
  if (u.protocol !== "https:") fail("Reports may only call https URLs.", { statusCode: 400, errorCode: "bad_report" });
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "actor-forge" };
  if (authSpec) {
    const cred = p.credentials.find((c) => c.key === authSpec.secret);
    if (!cred?.host || cred.host !== u.host)
      fail(`The ${authSpec.secret} token may only be sent to ${cred?.host ?? "a host declared in the manifest"}, not ${u.host}.`, {
        statusCode: 400,
        errorCode: "token_host_mismatch",
      });
    const secret = await resolveSecretDetailed(authSpec.secret);
    if (secret.lookupFailed) fail("Could not read the stored token. Try again.", { statusCode: 503, errorCode: "secret_lookup_failed" });
    if (!secret.value)
      fail(`Connect ${cred.label}: add ${cred.key} under Settings, API keys.`, { statusCode: 409, errorCode: "no_token" });
    headers.authorization = `Bearer ${secret.value}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
  if (res.status === 401 || res.status === 403)
    fail(`${u.host} rejected the token. Check it under Settings, API keys.`, { statusCode: 409, errorCode: "token_rejected" });
  if (!res.ok) fail(`${u.host} returned HTTP ${res.status}.`, { statusCode: 502, errorCode: "report_source_error" });
  return res.json();
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export async function runReport(p: Platform, r: Report) {
  const base = { id: r.id, title: r.title, description: r.description ?? null, type: r.type, fetchedAt: new Date().toISOString() };
  if (r.type === "link") return { ...base, href: r.href ?? null, linkLabel: r.linkLabel ?? r.title };
  if (!r.request) fail("This report has no request.", { statusCode: 400, errorCode: "bad_report" });

  const vars: Record<string, any> = { days30ago: new Date(Date.now() - 30 * 86_400_000).toISOString() };
  if (r.request.prefetch) {
    const pre = r.request.prefetch;
    vars[pre.as] = await call(p, pre.url, pre.auth);
  }
  const json = await call(p, fill(r.request.url, vars), r.request.auth);
  const rows = () => {
    const list = getPath(json, r.rows);
    if (!Array.isArray(list)) fail(`Expected a list at "${r.rows ?? ""}" in the response.`, { statusCode: 502, errorCode: "bad_shape" });
    return list as any[];
  };

  if (r.type === "stats") {
    const stats = (r.stats ?? []).map((s) => {
      let value: unknown;
      const op = s.op ?? "path";
      if (op === "path") value = getPath(json, s.path);
      else {
        const list = rows().filter((x) => !s.where || getPath(x, s.where.path) === s.where.equals);
        const nums = list.map((x) => num(getPath(x, s.path)));
        value =
          op === "count" ? list.length : op === "sum" ? nums.reduce((a, b) => a + b, 0) : op === "avg" ? (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null) : Math.max(0, ...nums);
      }
      return { label: s.label, display: formatValue(value, s.format) };
    });
    return { ...base, stats };
  }
  if (r.type === "table") {
    const cols = r.columns ?? [];
    const all = rows();
    return { ...base, columns: cols.map((c) => c.label), rows: all.slice(0, r.limit).map((x) => cols.map((c) => formatValue(getPath(x, c.path), c.format))), total: all.length };
  }
  const b = r.bars;
  if (!b) fail("A bars report needs a bars block.", { statusCode: 400, errorCode: "bad_report" });
  const label = (v: unknown) => (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? String(v).slice(0, 10) : String(v));
  const points = rows().slice(-r.limit).map((x) => ({ x: label(getPath(x, b.x)), y: num(getPath(x, b.y)) }));
  return { ...base, bars: points.map((pt) => ({ ...pt, display: formatValue(pt.y, b.format) })) };
}
