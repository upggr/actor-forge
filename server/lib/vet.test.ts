import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { loadPlatforms } from "./platforms.js";
import { scaffold } from "./templates.js";
import { buildDir, vetBuild } from "./vet.js";

const { platforms } = loadPlatforms();
const made: string[] = [];

function make(p: any, edit?: (files: Record<string, string>) => void): string {
  const id = `_test-${p.id}-${made.length}-${Date.now()}`;
  const files = scaffold(p, "sample", "Sample", "sample");
  edit?.(files);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(buildDir(id), rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  made.push(id);
  return id;
}

afterAll(() => {
  for (const id of made) {
    const dir = buildDir(id);
    if (path.basename(dir).startsWith("_test-")) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("vetBuild on every platform's untouched starter", () => {
  for (const p of platforms) {
    it(`${p.id} passes with a full score`, async () => {
      const r = await vetBuild(p, make(p));
      expect(r.checks.filter((c) => c.status === "fail"), JSON.stringify(r.checks)).toEqual([]);
      expect(r.verdict).toBe("pass");
      expect(r.score).toBe(100);
    }, 60_000);
  }
});

describe("vetBuild catches real problems", () => {
  const mcp = platforms.find((p) => p.id === "mcp")!;
  const hf = platforms.find((p) => p.id === "huggingface")!;
  const n8n = platforms.find((p) => p.id === "n8n")!;
  const failing = (r: any) => r.checks.filter((c: any) => c.status === "fail").map((c: any) => c.id);

  it("a JavaScript syntax error", async () => {
    const r = await vetBuild(mcp, make(mcp, (f) => void (f["src/tools.mjs"] = "export async function (")));
    expect(r.verdict).toBe("fail");
    expect(failing(r)).toContain("syntax");
  });

  it("a Python syntax error", async () => {
    const r = await vetBuild(hf, make(hf, (f) => void (f["logic.py"] = "def run(x:\n  return")));
    expect(failing(r)).toContain("syntax");
  });

  it("a failing unit test", async () => {
    const r = await vetBuild(mcp, make(mcp, (f) => void (f["test/tools.test.mjs"] = "import test from 'node:test';\ntest('x', () => { throw new Error('no'); });\n")));
    expect(failing(r)).toContain("unit-tests");
  });

  it("a hardcoded secret", async () => {
    const r = await vetBuild(mcp, make(mcp, (f) => void (f["src/tools.mjs"] += '\nconst apiKey = "sk_live_abcdefghijklmnop1234";\n')));
    expect(failing(r)).toContain("secrets");
  });

  it("a missing required file", async () => {
    const r = await vetBuild(mcp, make(mcp, (f) => void delete f["server.json"]));
    expect(failing(r)).toContain("structure");
  });

  it("a platform rule (n8n keyword, Space SDK)", async () => {
    const a = await vetBuild(n8n, make(n8n, (f) => void (f["package.json"] = f["package.json"]!.replace("n8n-community-node-package", "other"))));
    expect(a.verdict).toBe("fail");
    const b = await vetBuild(hf, make(hf, (f) => void (f["README.md"] = f["README.md"]!.replace("sdk: gradio", "sdk: streamlit"))));
    expect(b.verdict).toBe("fail");
  });

  it("a mcpName that does not match server.json", async () => {
    const r = await vetBuild(mcp, make(mcp, (f) => void (f["package.json"] = f["package.json"]!.replace(/"mcpName": "[^"]+"/, '"mcpName": "io.github.other/x"'))));
    expect(failing(r)).toContain("registry-rules");
  });
});
