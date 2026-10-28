import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Platform } from "./platforms.js";

const run = promisify(execFile);

export interface Check {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export function buildsRoot() {
  return path.join(process.cwd(), "builds");
}

export function buildDir(id: string) {
  return path.join(buildsRoot(), id);
}

export function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

const REQUIRED: Record<Exclude<Platform["kind"], "template">, string[]> = {
  "apify-actor": [".actor/actor.json", ".actor/input_schema.json", "src/main.mjs", "README.md", "Dockerfile"],
  "mcp-server": ["package.json", "server.json", "src/index.mjs", "README.md"],
};

function readJson(file: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ["API key assignment", /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-./+]{16,}["']/i],
  ["Bearer token", /Bearer\s+[A-Za-z0-9_\-.]{20,}/],
  ["npm token", /npm_[A-Za-z0-9]{30,}/],
  ["Apify token", /apify_api_[A-Za-z0-9]{20,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

export async function vetBuild(p: Platform, id: string) {
  const dir = buildDir(id);
  const files = listFiles(dir);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const required = p.kind === "template" ? p.template!.requiredFiles : REQUIRED[p.kind];
  const missing = required.filter((f) => !files.includes(f));
  add({
    id: "structure",
    label: "Required files",
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `Missing: ${missing.join(", ")}` : `${files.length} files, all required files present`,
  });

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const badJson = jsonFiles.flatMap((f) => {
    const r = readJson(path.join(dir, f));
    return r.ok ? [] : [`${f}: ${r.error}`];
  });
  add({
    id: "json",
    label: "JSON files parse",
    status: badJson.length ? "fail" : "pass",
    detail: badJson.length ? badJson.join("; ") : `${jsonFiles.length} JSON files valid`,
  });

  const jsFiles = files.filter((f) => f.endsWith(".mjs") || f.endsWith(".js"));
  const syntaxErrors: string[] = [];
  for (const f of jsFiles) {
    try {
      await run(process.execPath, ["--check", path.join(dir, f)], { timeout: 15_000 });
    } catch (e: any) {
      syntaxErrors.push(`${f}: ${String(e.stderr ?? e.message).split("\n").slice(0, 3).join(" ")}`);
    }
  }
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  for (const f of pyFiles) {
    try {
      await run("python3", ["-I", "-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", path.join(dir, f)], { timeout: 15_000 });
    } catch (e: any) {
      syntaxErrors.push(`${f}: ${String(e.stderr ?? e.message).trim().split("\n").slice(-1)[0]}`);
    }
  }
  add({
    id: "syntax",
    label: pyFiles.length ? "Source syntax" : "JavaScript syntax",
    status: syntaxErrors.length ? "fail" : "pass",
    detail: syntaxErrors.length
      ? syntaxErrors.join("; ")
      : `${jsFiles.length + pyFiles.length} files parse${pyFiles.length ? "" : " (node --check)"}`,
  });

  const testCmd = p.template?.test ?? [process.execPath, "--test"];
  const hasTests = files.some((f) => /^tests?\//.test(f));
  if (hasTests) {
    try {
      const { stdout, stderr } = await run(testCmd[0]!, testCmd.slice(1), { cwd: dir, timeout: 90_000 });
      const out = `${stdout}\n${stderr}`;
      const passed = /# pass (\d+)/.exec(out)?.[1] ?? /Ran (\d+) test/.exec(out)?.[1] ?? "all";
      add({ id: "unit-tests", label: "Unit tests", status: "pass", detail: `${passed} passing (${testCmd.map((c) => path.basename(c)).join(" ")})` });
    } catch (e: any) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      const fails = /# fail (\d+)/.exec(out)?.[1] ?? /FAILED \((?:failures|errors)=(\d+)/.exec(out)?.[1];
      add({
        id: "unit-tests",
        label: "Unit tests",
        status: "fail",
        detail: fails ? `${fails} failing` : out.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300),
      });
    }
  } else {
    add({ id: "unit-tests", label: "Unit tests", status: "fail", detail: "No tests found in test/ or tests/" });
  }

  const secretHits: string[] = [];
  for (const f of files) {
    if (!/\.(mjs|js|py|txt|json|md|ya?ml|env)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) secretHits.push(`${f} (${label})`);
  }
  add({
    id: "secrets",
    label: "No hardcoded secrets",
    status: secretHits.length ? "fail" : "pass",
    detail: secretHits.length ? secretHits.join(", ") : "No credentials found in source",
  });

  if (p.vet.includes("terms")) {
    const source = files
      .filter((f) => /^(src|\.actor|nodes|credentials)\//.test(f) || /^[^/]+\.py$/.test(f))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    const flags: string[] = [];
    if (/type=["']?password|login\s*\(|signin|sign-in|cookie\s*:/i.test(source)) flags.push("login or session handling");
    if (/\b(e-?mail|phone|telephone|mobile)\b/i.test(source)) flags.push("possible personal contact data");
    add({
      id: "terms",
      label: "Terms and personal data",
      status: flags.length ? "warn" : "pass",
      detail: flags.length ? `Review manually: ${flags.join("; ")}` : "Public pages only; no login or personal contact fields detected",
    });
  }

  if (p.vet.includes("registry-rules") && files.includes("package.json") && files.includes("server.json")) {
    const pkg = readJson(path.join(dir, "package.json"));
    const srv = readJson(path.join(dir, "server.json"));
    const problems: string[] = [];
    if (pkg.ok && srv.ok) {
      if (pkg.value.mcpName !== srv.value.name) problems.push("package.json mcpName must equal server.json name");
      if (p.publish.namespace && !String(srv.value.name).startsWith(`${p.publish.namespace}/`))
        problems.push(`name must start with ${p.publish.namespace}/`);
      if (String(srv.value.description ?? "").length > 100) problems.push("description is longer than 100 characters");
      if (!srv.value.packages?.length && !srv.value.remotes?.length) problems.push("needs packages or remotes");
    }
    add({
      id: "registry-rules",
      label: "MCP registry rules",
      status: problems.length ? "fail" : "pass",
      detail: problems.length ? problems.join("; ") : "mcpName, namespace and description limit satisfied",
    });
  }

  if (p.kind === "apify-actor" && files.includes(".actor/input_schema.json")) {
    const sch = readJson(path.join(dir, ".actor/input_schema.json"));
    const problems: string[] = [];
    if (sch.ok) {
      if (sch.value.type !== "object") problems.push('type must be "object"');
      if (!sch.value.properties || !Object.keys(sch.value.properties).length) problems.push("no input properties");
      for (const [k, v] of Object.entries<any>(sch.value.properties ?? {}))
        if (!v.title || !v.description) problems.push(`${k} needs title and description`);
    }
    add({
      id: "input-schema",
      label: "Apify input schema",
      status: problems.length ? "fail" : "pass",
      detail: problems.length ? problems.join("; ") : "Valid object schema with described fields",
    });
  }

  for (const rule of p.template?.rules ?? []) {
    const file = path.join(dir, rule.file);
    let ok = false;
    try {
      if (rule.type === "file-regex") ok = new RegExp(rule.pattern, "m").test(fs.readFileSync(file, "utf8"));
      else {
        let v: any = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const key of rule.path.split(".")) v = v?.[key];
        ok = Array.isArray(v) ? v.includes(rule.value) : String(v) === rule.value;
      }
    } catch {
      ok = false;
    }
    add({ id: `rule:${rule.file}:${checks.length}`, label: rule.message, status: ok ? "pass" : "fail", detail: ok ? `${rule.file} satisfies the rule` : `${rule.file} does not satisfy it` });
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const passed = checks.filter((c) => c.status === "pass").length;
  return {
    verdict: failed ? ("fail" as const) : warned ? ("review" as const) : ("pass" as const),
    score: Math.round((100 * (passed + warned * 0.5)) / checks.length),
    checks,
    ranAt: new Date().toISOString(),
  };
}
