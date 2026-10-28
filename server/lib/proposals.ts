import { fail } from "@agent-native/core/action";
import fs from "node:fs";
import path from "node:path";

import { loadPlatforms, platformsDir, proposalsDir, refinedManifest, type Platform } from "./platforms.js";
import { scoutPlatform } from "./scout.js";
import { renderTemplate } from "./templates.js";
import { buildDir, buildsRoot, vetBuild } from "./vet.js";

export interface Proposal {
  manifest: Platform;
  templateFiles: Record<string, string>;
  createdAt: string;
  createdBy: string;
  starterVet: { verdict: string; score: number; checks: { label: string; status: string; detail: string }[] };
  probe: { topic: string; score: number; summary: string }[];
  probeFailures: string[];
}

function writeTemplateFiles(buildId: string, files: Record<string, string>) {
  const dir = buildDir(buildId);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.resolve(dir, rel);
    if (!full.startsWith(dir + path.sep)) throw new Error(`Unsafe path ${rel}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

const MAX_FILES = 40;
const MAX_FILE_BYTES = 60_000;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

const invalid = (issues: string[]): never =>
  fail(`The proposal is not valid:\n- ${issues.join("\n- ")}`, { statusCode: 422, errorCode: "invalid_proposal" });

export function proposalFile(id: string) {
  return path.join(proposalsDir(), `${id}.proposal.json`);
}

export function readProposal(id: string): Proposal | null {
  try {
    return JSON.parse(fs.readFileSync(proposalFile(id), "utf8")) as Proposal;
  } catch {
    return null;
  }
}

export function listProposalIds(): string[] {
  if (!fs.existsSync(proposalsDir())) return [];
  return fs
    .readdirSync(proposalsDir())
    .filter((f) => f.endsWith(".proposal.json"))
    .map((f) => f.replace(/\.proposal\.json$/, ""));
}

/** Everything that can be checked without a person: shape, safe paths, token hosts, a starter that passes its own vetting, and a live probe of discovery. */
export async function validateProposal(rawManifest: unknown, templateFiles: Record<string, string>, createdBy: string): Promise<Proposal> {
  const parsed = refinedManifest.safeParse(rawManifest);
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`));
  const m = parsed.data;
  const issues: string[] = [];

  if (!SAFE_NAME.test(m.id)) issues.push("id must be lowercase letters, digits and dashes");
  if (loadPlatforms().platforms.some((p) => p.id === m.id)) issues.push(`a platform with id "${m.id}" already exists`);
  if (m.kind !== "template") issues.push('kind must be "template" (the built-in kinds need code, so they cannot be proposed)');
  if (!m.template) issues.push("template block is missing");
  if (m.discover.seeds.length > 40) issues.push("at most 40 seeds");
  if (m.publish.liveSupported) issues.push("publish.liveSupported must be false; only a developer can add a real upload adapter");
  if (m.publish.liveEnabled) issues.push("publish.liveEnabled must be false; live publishing cannot be switched on by a proposal");

  if (m.template) {
    if (!SAFE_NAME.test(m.template.dir)) issues.push("template.dir must be lowercase letters, digits and dashes");
    if (fs.existsSync(path.join(platformsDir(), m.template.dir))) issues.push(`platforms/${m.template.dir} already exists; choose another template.dir`);
    const paths = Object.keys(templateFiles);
    if (!paths.length) issues.push("templateFiles is empty");
    if (paths.length > MAX_FILES) issues.push(`at most ${MAX_FILES} template files`);
    for (const p of paths) {
      if (p.startsWith("/") || p.includes("..") || p.includes("\0")) issues.push(`unsafe template path "${p}"`);
      if (Buffer.byteLength(templateFiles[p]!) > MAX_FILE_BYTES) issues.push(`template file "${p}" is larger than ${MAX_FILE_BYTES} bytes`);
    }
    for (const req of m.template.requiredFiles) if (!paths.includes(req)) issues.push(`requiredFiles lists "${req}" but templateFiles has no such file`);
  }

  // A token key that already exists may only go to the host it already goes to.
  const known = new Map<string, string | undefined>();
  for (const p of loadPlatforms().platforms) for (const c of p.credentials) known.set(c.key, c.host);
  for (const c of m.credentials) {
    const existing = known.get(c.key);
    if (known.has(c.key) && existing !== c.host)
      issues.push(`credential ${c.key} is already tied to host ${existing ?? "(none)"}; a proposal cannot point it at ${c.host ?? "(none)"}`);
  }
  for (const r of m.reports) {
    for (const u of [r.request?.url, r.request?.prefetch?.url].filter(Boolean) as string[]) {
      try {
        if (new URL(u.replace(/\{\{[\w.]+\}\}/g, "x")).protocol !== "https:") issues.push(`report "${r.id}" uses a non-https URL`);
      } catch {
        issues.push(`report "${r.id}" has an invalid URL`);
      }
    }
  }
  if (issues.length) return invalid(issues);

  // The untouched starter must pass the platform's own vetting, otherwise every build on it would start broken.
  const tmpId = `_proposal-${crypto.randomUUID()}`;
  let starterVet: Proposal["starterVet"];
  try {
    writeTemplateFiles(tmpId, renderTemplate(templateFiles, { slug: "sample", topic: "Sample", query: "sample", title: "Sample" }));
    const report = await vetBuild(m, tmpId);
    starterVet = { verdict: report.verdict, score: report.score, checks: report.checks.map((c) => ({ label: c.label, status: c.status, detail: c.detail })) };
  } finally {
    const dir = buildDir(tmpId);
    if (dir.startsWith(buildsRoot() + path.sep) && path.basename(dir).startsWith("_proposal-")) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (starterVet.verdict === "fail")
    return invalid(["the untouched starter fails its own vetting:", ...starterVet.checks.filter((c) => c.status === "fail").map((c) => `  ${c.label}: ${c.detail}`)]);

  // Prove the discoverer can actually read this source: scout the first two seeds for real.
  const probed = await scoutPlatform({ ...m, discover: { ...m.discover, seeds: m.discover.seeds.slice(0, 2) } });
  if (!probed.results.length) return invalid(["scouting the first seeds returned nothing:", ...probed.failures.map((f) => `  ${f.topic}: ${f.error}`)]);

  return {
    manifest: m,
    templateFiles,
    createdAt: new Date().toISOString(),
    createdBy,
    starterVet,
    probe: probed.results.map((r) => ({ topic: r.topic, score: r.score, summary: r.summary })),
    probeFailures: probed.failures.map((f) => `${f.topic}: ${f.error}`),
  };
}
