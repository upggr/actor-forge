import { describe, expect, it } from "vitest";

import { ApifyUploadError, createAndBuild, updateAndBuild, uploadableFiles } from "./apify.js";

type Call = { method: string; path: string; body?: any; auth?: string };

/** A scripted Apify: routes are matched in order by "METHOD path-prefix". */
function fakeApify(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const f: typeof fetch = async (url: any, init: any) => {
    const u = String(url).replace("https://api.apify.com/v2", "");
    const call: Call = { method: init?.method ?? "GET", path: u, body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.authorization };
    calls.push(call);
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => `${call.method} ${call.path}`.startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: { message: `no route for ${call.method} ${call.path}` } }), { status: 404 });
    const r = routes[key]!(call);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { f, calls };
}

const spec = {
  name: "demo-actor",
  title: "Demo actor",
  description: "d",
  files: { "package.json": "{}", "src/main.mjs": "x", ".actor/actor.json": "{}", "test/parse.test.mjs": "t", "listing.json": "{}" },
};

describe("uploadableFiles", () => {
  it("sends the project but not tests or app bookkeeping", () => {
    expect(uploadableFiles(spec.files).map((f) => f.name).sort()).toEqual([".actor/actor.json", "package.json", "src/main.mjs"]);
  });
});

describe("createAndBuild", () => {
  it("creates a PRIVATE actor with its source, builds it, and waits for the build", async () => {
    let polls = 0;
    const { f, calls } = fakeApify({
      "POST /actors": () => ({ body: { data: { id: "ACT1", name: "demo-actor" } } }),
      "POST /actors/ACT1/builds": () => ({ body: { data: { id: "B1", status: "RUNNING", buildNumber: "0.1.1" } } }),
      "GET /actors/ACT1/builds/B1": () => ({ body: { data: { id: "B1", status: ++polls < 2 ? "RUNNING" : "SUCCEEDED", buildNumber: "0.1.1" } } }),
    });
    const r = await createAndBuild("tok", spec, { fetchImpl: f, pollMs: 1 });
    expect(r).toMatchObject({ actorId: "ACT1", buildId: "B1", buildStatus: "SUCCEEDED", created: true, consoleUrl: "https://console.apify.com/actors/ACT1" });
    const create = calls[0]!;
    expect(create.body.isPublic).toBe(false);
    expect(create.body.versions[0]).toMatchObject({ versionNumber: "0.1", sourceType: "SOURCE_FILES" });
    expect(create.body.versions[0].sourceFiles.map((x: any) => x.name)).not.toContain("test/parse.test.mjs");
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(calls[1]!.path).toContain("/actors/ACT1/builds?version=0.1");
  });

  it("never asks for a public actor", async () => {
    const { f, calls } = fakeApify({
      "POST /actors": () => ({ body: { data: { id: "A", name: "n" } } }),
      "POST /actors/A/builds": () => ({ body: { data: { id: "B", status: "SUCCEEDED" } } }),
    });
    await createAndBuild("t", spec, { fetchImpl: f, pollMs: 1 });
    expect(JSON.stringify(calls)).not.toMatch(/"isPublic":true/);
  });

  it("tries name-2 when the name is taken", async () => {
    const names: string[] = [];
    const { f } = fakeApify({
      "POST /actors": (c) => {
        names.push(c.body.name);
        return names.length === 1 ? { status: 400, body: { error: { type: "actor-name-not-unique", message: "taken" } } } : { body: { data: { id: "A2", name: c.body.name } } };
      },
      "POST /actors/A2/builds": () => ({ body: { data: { id: "B", status: "SUCCEEDED" } } }),
    });
    const r = await createAndBuild("t", spec, { fetchImpl: f, pollMs: 1 });
    expect(names).toEqual(["demo-actor", "demo-actor-2"]);
    expect(r.name).toBe("demo-actor-2");
  });

  it("reports a failed build with the log tail and keeps the actor id", async () => {
    const { f } = fakeApify({
      "POST /actors": () => ({ body: { data: { id: "A", name: "n" } } }),
      "POST /actors/A/builds": () => ({ body: { data: { id: "B", status: "FAILED" } } }),
      "GET /actor-builds/B/log": () => ({ body: "line1\nnpm ERR! missing module\n" }),
    });
    const err: any = await createAndBuild("t", spec, { fetchImpl: f, pollMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApifyUploadError);
    expect(err.code).toBe("build_failed");
    expect(err.detail).toMatchObject({ actorId: "A", buildStatus: "FAILED" });
    expect(err.detail.logTail).toContain("npm ERR! missing module");
  });

  it("turns a rejected token into a clear error", async () => {
    const { f } = fakeApify({ "POST /actors": () => ({ status: 401, body: { error: { type: "token-not-valid" } } }) });
    await expect(createAndBuild("bad", spec, { fetchImpl: f, pollMs: 1 })).rejects.toMatchObject({ code: "token_rejected" });
  });

  it("gives up with a timeout error if the build never finishes", async () => {
    const { f } = fakeApify({
      "POST /actors": () => ({ body: { data: { id: "A", name: "n" } } }),
      "POST /actors/A/builds": () => ({ body: { data: { id: "B", status: "RUNNING" } } }),
      "GET /actors/A/builds/B": () => ({ body: { data: { id: "B", status: "RUNNING" } } }),
    });
    await expect(createAndBuild("t", spec, { fetchImpl: f, pollMs: 1, maxWaitMs: 20 })).rejects.toMatchObject({ code: "build_timeout" });
  });
});

describe("API errors", () => {
  it("keeps the HTTP status so callers can tell a deleted actor (404) from other failures", async () => {
    const { f } = fakeApify({ "PUT /actors/GONE/versions/0.1": () => ({ status: 404, body: { error: { type: "record-not-found", message: "Actor was not found" } } }) });
    const err: any = await updateAndBuild("t", "GONE", spec, { fetchImpl: f, pollMs: 1 }).catch((e) => e);
    expect(err.code).toBe("api_error");
    expect(err.detail.status).toBe(404);
  });
});

describe("updateAndBuild", () => {
  it("updates the existing actor's source instead of creating another one", async () => {
    const { f, calls } = fakeApify({
      "PUT /actors/ACT9/versions/0.1": () => ({ body: { data: {} } }),
      "POST /actors/ACT9/builds": () => ({ body: { data: { id: "B", status: "SUCCEEDED", buildNumber: "0.1.2" } } }),
    });
    const r = await updateAndBuild("t", "ACT9", spec, { fetchImpl: f, pollMs: 1 });
    expect(r).toMatchObject({ actorId: "ACT9", created: false, buildStatus: "SUCCEEDED" });
    expect(calls.some((c) => c.method === "POST" && c.path === "/actors")).toBe(false);
  });
});
