import { describe, expect, it, vi } from "vitest";

vi.mock("./scout.js", () => ({
  scoutPlatform: vi.fn(async (p: any) => ({
    results: p.discover.seeds.map((s: any) => ({ topic: s.topic, query: s.query, score: 80, summary: "stub", evidence: {} })),
    failures: [],
  })),
}));

import { scoutPlatform } from "./scout.js";
import { validateProposal } from "./proposals.js";

const good = () => ({
  id: "demo-platform",
  name: "Demo Platform",
  blurb: "A demo platform used by the tests.",
  kind: "template",
  template: {
    dir: "demo-platform-template",
    requiredFiles: ["package.json", "src/index.mjs", "tests/index.test.mjs"],
    rules: [{ type: "json-contains", file: "package.json", path: "keywords", value: "demo", message: "demo keyword" }],
  },
  discover: { type: "npm-search", npmSearchUrl: "https://registry.npmjs.org/-/v1/search", marker: "demo", seeds: [{ topic: "A", query: "a" }, { topic: "B", query: "b" }, { topic: "C", query: "c" }] },
  vet: ["structure"],
  publish: { type: "npm", dryRunCommand: "npm publish", liveEnabled: false },
});
const files = (): Record<string, string> => ({
  "package.json": JSON.stringify({ name: "demo-{{slug}}", version: "0.1.0", keywords: ["demo"] }),
  "src/index.mjs": "export const run = (t) => String(t).trim();\n",
  "tests/index.test.mjs": "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { run } from '../src/index.mjs';\ntest('trims', () => assert.equal(run(' x '), 'x'));\n",
});

const reject = async (manifest: unknown, tf: Record<string, string>, pattern: RegExp) =>
  expect(validateProposal(manifest, tf, "t@t")).rejects.toThrow(pattern);

describe("validateProposal", () => {
  it("accepts a sound proposal, vets its starter and probes only the first two niches", async () => {
    const p = await validateProposal(good(), files(), "t@t");
    expect(p.starterVet.verdict).toBe("pass");
    expect(p.probe).toHaveLength(2);
    const calls = vi.mocked(scoutPlatform).mock.calls;
    expect(calls[calls.length - 1]![0].discover.seeds).toHaveLength(2);
  });

  it("rejects a manifest that fails the schema", async () => {
    const m: any = good();
    delete m.discover;
    await reject(m, files(), /discover/);
  });

  it("rejects turning live publishing on", async () => {
    const m: any = good();
    m.publish.liveEnabled = true;
    await reject(m, files(), /liveEnabled/);
  });

  it("rejects the built-in kinds, which need code", async () => {
    const m: any = good();
    m.kind = "apify-actor";
    await reject(m, files(), /kind must be "template"/);
  });

  it("rejects reusing an existing platform id or template folder", async () => {
    let m: any = good();
    m.id = "apify";
    await reject(m, files(), /already exists/);
    m = good();
    m.template.dir = "n8n-template";
    await reject(m, files(), /already exists/);
  });

  it("rejects pointing an existing token at another host", async () => {
    const m: any = good();
    m.credentials = [{ key: "NPM_TOKEN", label: "x", description: "x", host: "evil.example.com" }];
    await reject(m, files(), /already tied to host registry\.npmjs\.org/);
  });

  it("rejects a report that is not https", async () => {
    const m: any = good();
    m.reports = [{ id: "r", title: "r", type: "stats", request: { url: "http://x.example.com/a" }, stats: [] }];
    await reject(m, files(), /non-https/);
  });

  it("rejects unsafe or oversized template files and missing required files", async () => {
    await reject(good(), { ...files(), "../../evil.js": "x" }, /unsafe template path/);
    await reject(good(), { ...files(), "big.txt": "x".repeat(70_000) }, /larger than/);
    const tf = files();
    delete tf["src/index.mjs"];
    await reject(good(), tf, /requiredFiles lists "src\/index\.mjs"/);
  });

  it("rejects a starter that fails its own vetting", async () => {
    await reject(good(), { ...files(), "src/index.mjs": "export const run = (" }, /fails its own vetting/);
    await reject(good(), { ...files(), "package.json": JSON.stringify({ name: "x", keywords: ["other"] }) }, /fails its own vetting/);
  });

  it("rejects when discovery returns nothing", async () => {
    vi.mocked(scoutPlatform).mockResolvedValueOnce({ results: [], failures: [{ topic: "A", error: "HTTP 500" }] } as any);
    await reject(good(), files(), /returned nothing/);
  });
});
