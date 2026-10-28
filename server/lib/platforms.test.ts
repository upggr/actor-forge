import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadPlatforms, platformsDir } from "./platforms.js";
import { scaffold } from "./templates.js";

const { platforms, errors } = loadPlatforms();

describe("platform manifests", () => {
  it("all load and validate", () => {
    expect(errors).toEqual([]);
    expect(platforms.length).toBeGreaterThanOrEqual(4);
  });

  it("have unique ids and at least one niche", () => {
    expect(new Set(platforms.map((p) => p.id)).size).toBe(platforms.length);
    for (const p of platforms) expect(p.discover.seeds.length, p.id).toBeGreaterThan(0);
  });

  it("never enable live publishing by default, and only Apify has a real upload adapter", () => {
    for (const p of platforms) expect(p.publish.liveEnabled, p.id).toBe(false);
    expect(platforms.filter((p) => p.publish.liveSupported).map((p) => p.id)).toEqual(["apify"]);
  });

  it("only send tokens to the host their credential declares", () => {
    for (const p of platforms) {
      for (const r of p.reports) {
        for (const spec of [r.request, r.request?.prefetch]) {
          if (!spec?.auth) continue;
          const cred = p.credentials.find((c) => c.key === spec.auth!.secret);
          const url = new URL((spec as any).url.replace(/\{\{[\w.]+\}\}/g, "x"));
          expect(cred?.host, `${p.id}/${r.id}`).toBe(url.host);
        }
      }
    }
  });

  it("have a template folder containing every required file", () => {
    for (const p of platforms.filter((x) => x.kind === "template")) {
      const files = Object.keys(scaffold(p, "sample", "Sample", "sample"));
      for (const req of p.template!.requiredFiles) expect(files, `${p.id}: ${req}`).toContain(req);
      expect(fs.existsSync(path.join(platformsDir(), p.template!.dir))).toBe(true);
    }
  });
});

describe("scaffold", () => {
  it("replaces every placeholder", () => {
    for (const p of platforms) {
      for (const [file, text] of Object.entries(scaffold(p, "sample", "Sample Topic", "sample"))) {
        expect(text, `${p.id}/${file}`).not.toMatch(/\{\{\w+\}\}/);
      }
    }
  });
});
