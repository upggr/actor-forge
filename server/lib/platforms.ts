import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const seed = z.object({
  topic: z.string(),
  query: z.string(),
  category: z.string().optional(),
});

const credential = z.object({
  key: z.string().regex(/^[A-Z0-9_]+$/),
  host: z.string().optional().describe("The only host this token may be sent to, e.g. api.apify.com. Required by any report that uses it."),
  label: z.string(),
  description: z.string(),
  docsUrl: z.string().url().optional(),
});

const vetRule = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file-regex"),
    file: z.string(),
    pattern: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("json-contains"),
    file: z.string(),
    path: z.string().describe("Dot path into the JSON file, e.g. keywords"),
    value: z.string(),
    message: z.string(),
  }),
]);

const template = z.object({
  dir: z.string().describe("Folder under platforms/ holding the starter files; {{slug}} {{topic}} {{query}} are replaced"),
  requiredFiles: z.array(z.string()).min(1),
  test: z.array(z.string()).optional().describe("Command and args run in the build folder, e.g. [\"node\",\"--test\"]"),
  rules: z.array(vetRule).default([]),
});

const format = z.enum(["text", "number", "usd", "percent", "date"]).default("text");
const auth = z.object({ secret: z.string().regex(/^[A-Z0-9_]+$/), scheme: z.literal("bearer").default("bearer") });

const report = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  description: z.string().optional(),
  type: z.enum(["stats", "table", "bars", "link"]),
  request: z
    .object({
      url: z.string().describe("https GET. {{days30ago}} and {{<as>.<path>}} from the prefetch are substituted"),
      auth: auth.optional(),
      prefetch: z.object({ url: z.string().url(), auth: auth.optional(), as: z.string() }).optional(),
    })
    .optional(),
  rows: z.string().optional().describe('Dot path to the array in the response; "" means the response itself'),
  stats: z
    .array(
      z.object({
        label: z.string(),
        op: z.enum(["path", "count", "sum", "avg", "max"]).default("path"),
        path: z.string().optional(),
        where: z.object({ path: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
        format,
      }),
    )
    .optional(),
  columns: z.array(z.object({ label: z.string(), path: z.string(), format })).optional(),
  bars: z.object({ x: z.string(), y: z.string(), format }).optional(),
  limit: z.number().int().min(1).max(200).default(20),
  href: z.string().url().optional(),
  linkLabel: z.string().optional(),
});

export type Report = z.infer<typeof report>;

const manifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  blurb: z.string(),
  kind: z.enum(["apify-actor", "mcp-server", "template"]),
  template: template.optional(),
  discover: z.object({
    type: z.enum(["apify-store", "mcp-npm", "npm-search", "hf-spaces"]),
    builtinIndexUrl: z.string().url().optional().describe("npm-search: JSON list of {name} for nodes shipped with the host app, counted as supply"),
    marker: z.string().optional().describe("npm-search: text a package must contain to count as supply, e.g. n8n"),
    apiUrl: z.string().url().optional(),
    npmSearchUrl: z.string().url().optional(),
    registryUrl: z.string().url().optional(),
    seeds: z.array(seed).min(1),
  }),
  vet: z.array(z.string()),
  publish: z.object({
    type: z.string(),
    dryRunCommand: z.string(),
    liveEnabled: z.boolean().default(false),
    liveSupported: z.boolean().default(false).describe("True only where the app has a real upload adapter for this platform. Proposals cannot set it."),
    namespace: z.string().optional(),
  }),
  credentials: z.array(credential).default([]),
  reports: z.array(report).default([]),
  pricing: z
    .object({ model: z.string(), suggested: z.string() })
    .optional(),
});

export const refinedManifest = manifest.refine((m) => m.kind !== "template" || m.template, {
  message: 'kind "template" needs a template block',
});

export type Platform = z.infer<typeof manifest>;
export type VetRule = z.infer<typeof vetRule>;
export type Seed = z.infer<typeof seed>;

export function platformsDir() {
  return path.join(process.cwd(), "platforms");
}

/** Every platforms/*.json file is a plugin; a file that fails validation is reported, not loaded. */
export function loadPlatforms(): {
  platforms: Platform[];
  errors: { file: string; error: string }[];
} {
  const dir = platformsDir();
  const platforms: Platform[] = [];
  const errors: { file: string; error: string }[] = [];
  if (!fs.existsSync(dir)) return { platforms, errors };
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      platforms.push(refinedManifest.parse(raw));
    } catch (e) {
      errors.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { platforms, errors };
}

export function getPlatform(id: string): Platform | undefined {
  return loadPlatforms().platforms.find((p) => p.id === id);
}

export function proposalsDir() {
  return path.join(platformsDir(), "_proposed");
}

/** JSON Schema of the manifest, generated from the validator itself so a guide can never drift from it. */
export function manifestJsonSchema() {
  return z.toJSONSchema(manifest);
}
