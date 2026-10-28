import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  resolveSecretDetailed: vi.fn(async () => ({ value: "tok-123", lookupFailed: false })),
}));

import { resolveSecretDetailed } from "@agent-native/core/server";

import { formatValue, getPath, runReport } from "./reports.js";

const platform: any = { id: "t", credentials: [{ key: "T_TOKEN", label: "T token", host: "api.example.com" }] };
const report = (r: any) => ({ id: "r", title: "R", limit: 20, ...r });
const calls: { url: string; auth?: string }[] = [];

function serve(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string, init?: any) => {
    calls.push({ url, auth: init?.headers?.authorization });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response("nope", { status: 404 });
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.mocked(resolveSecretDetailed).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("getPath and formatValue", () => {
  it("reads dot paths and the root", () => {
    expect(getPath({ a: { b: 3 } }, "a.b")).toBe(3);
    expect(getPath([1, 2], "")).toEqual([1, 2]);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });

  it("formats values and shows a dash for missing ones", () => {
    expect(formatValue(1234.5, "usd")).toBe("$1,234.50");
    expect(formatValue(0.256, "percent")).toBe("26%");
    expect(formatValue("2026-10-28T12:34:56.000Z", "date")).toBe("2026-10-28 12:34");
    expect(formatValue(undefined, "number")).toBe("–");
  });
});

describe("runReport", () => {
  const items = [
    { status: "SUCCEEDED", cost: 1.5, name: "a" },
    { status: "FAILED", cost: 0.5, name: "b" },
    { status: "SUCCEEDED", cost: 2, name: "c" },
  ];

  it("computes count, sum, avg, max and filtered counts", async () => {
    serve({ "https://api.example.com/runs": { data: { items, total: 3 } } });
    const out: any = await runReport(
      platform,
      report({
        type: "stats",
        request: { url: "https://api.example.com/runs" },
        rows: "data.items",
        stats: [
          { label: "Runs", op: "count", format: "number" },
          { label: "Succeeded", op: "count", where: { path: "status", equals: "SUCCEEDED" }, format: "number" },
          { label: "Cost", op: "sum", path: "cost", format: "usd" },
          { label: "Avg", op: "avg", path: "cost", format: "usd" },
          { label: "Max", op: "max", path: "cost", format: "usd" },
          { label: "Total", path: "data.total", format: "number" },
        ],
      }),
    );
    expect(out.stats.map((s: any) => s.display)).toEqual(["3", "2", "$4.00", "$1.33", "$2.00", "3"]);
  });

  it("builds tables and bars", async () => {
    serve({ "https://api.example.com/runs": { data: { items } } });
    const table: any = await runReport(platform, report({ type: "table", request: { url: "https://api.example.com/runs" }, rows: "data.items", columns: [{ label: "Name", path: "name" }, { label: "Cost", path: "cost", format: "usd" }], limit: 2 }));
    expect(table.rows).toEqual([["a", "$1.50"], ["b", "$0.50"]]);
    expect(table.total).toBe(3);
    const bars: any = await runReport(platform, report({ type: "bars", request: { url: "https://api.example.com/runs" }, rows: "data.items", bars: { x: "name", y: "cost", format: "usd" } }));
    expect(bars.bars.map((b: any) => b.x)).toEqual(["a", "b", "c"]);
  });

  it("chains a prefetch into the next URL and URL-encodes the value", async () => {
    serve({ "https://api.example.com/me": { name: "a b/c" }, "https://api.example.com/items": [] });
    await runReport(platform, report({ type: "table", request: { url: "https://api.example.com/items?owner={{me.name}}", prefetch: { url: "https://api.example.com/me", as: "me" } }, rows: "", columns: [] }));
    expect(calls[1]!.url).toBe("https://api.example.com/items?owner=a%20b%2Fc");
  });

  it("sends the token only to the host the manifest declares", async () => {
    serve({ "https://api.example.com/x": {} });
    await runReport(platform, report({ type: "stats", request: { url: "https://api.example.com/x", auth: { secret: "T_TOKEN" } }, stats: [] }));
    expect(calls[0]!.auth).toBe("Bearer tok-123");
  });

  it("refuses to send a token to another host, and never reads the secret first", async () => {
    serve({});
    await expect(runReport(platform, report({ type: "stats", request: { url: "https://evil.example.com/x", auth: { secret: "T_TOKEN" } }, stats: [] }))).rejects.toThrow(/may only be sent to api\.example\.com/);
    expect(resolveSecretDetailed).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("refuses a token the manifest never declared a host for", async () => {
    serve({});
    await expect(runReport(platform, report({ type: "stats", request: { url: "https://api.example.com/x", auth: { secret: "OTHER" } }, stats: [] }))).rejects.toThrow(/host declared in the manifest/);
  });

  it("refuses plain http", async () => {
    serve({});
    await expect(runReport(platform, report({ type: "stats", request: { url: "http://api.example.com/x" }, stats: [] }))).rejects.toThrow(/https/);
  });

  it("asks the user to connect when the token is missing", async () => {
    vi.mocked(resolveSecretDetailed).mockResolvedValueOnce({ value: null, lookupFailed: false } as any);
    serve({ "https://api.example.com/x": {} });
    await expect(runReport(platform, report({ type: "stats", request: { url: "https://api.example.com/x", auth: { secret: "T_TOKEN" } }, stats: [] }))).rejects.toThrow(/Connect T token/);
  });

  it("reports a rejected token and a bad response shape clearly", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }));
    await expect(runReport(platform, report({ type: "stats", request: { url: "https://api.example.com/x" }, stats: [] }))).rejects.toThrow(/rejected the token/);
    serve({ "https://api.example.com/x": { data: 5 } });
    await expect(runReport(platform, report({ type: "table", request: { url: "https://api.example.com/x" }, rows: "data", columns: [] }))).rejects.toThrow(/Expected a list/);
  });

  it("returns a link report without any request", async () => {
    serve({});
    const out: any = await runReport(platform, report({ type: "link", href: "https://example.com", linkLabel: "Go" }));
    expect(out).toMatchObject({ href: "https://example.com", linkLabel: "Go" });
    expect(calls).toHaveLength(0);
  });
});
