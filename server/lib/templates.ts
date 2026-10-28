import fs from "node:fs";
import path from "node:path";

import { platformsDir, type Platform } from "./platforms.js";

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "project";
}

/** Starter files for a build. They run as-is; the agent then replaces them with the real logic. */
export function scaffold(p: Platform, slug: string, topic: string, query: string): Record<string, string> {
  if (p.kind === "template") return fromTemplate(p, slug, topic, query);
  return p.kind === "apify-actor" ? apifyActor(slug, topic, query) : mcpServer(p, slug, topic, query);
}

function apifyActor(slug: string, topic: string, query: string): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      { name: slug, version: "0.1.0", type: "module", private: true, scripts: { start: "node src/main.mjs", test: "node --test" }, dependencies: { apify: "^3.2.0" } },
      null,
      2,
    ),
    ".actor/actor.json": JSON.stringify(
      {
        actorSpecification: 1,
        name: slug,
        title: `${topic} Scraper`,
        version: "0.1",
        dockerfile: "../Dockerfile",
        input: "./input_schema.json",
      },
      null,
      2,
    ),
    ".actor/input_schema.json": JSON.stringify(
      {
        title: `${topic} input`,
        type: "object",
        schemaVersion: 1,
        properties: {
          startUrls: {
            title: "Start URLs",
            type: "array",
            description: `Public ${query} pages to scrape.`,
            editor: "requestListSources",
            prefill: [],
          },
          maxItems: { title: "Max items", type: "integer", description: "Stop after this many results.", default: 100, minimum: 1 },
        },
        required: ["startUrls"],
      },
      null,
      2,
    ),
    Dockerfile: `FROM apify/actor-node:22\nCOPY package*.json ./\nRUN npm install --omit=dev --omit=optional\nCOPY . ./\nCMD node src/main.mjs\n`,
    "src/parse.mjs": `// Pure parser: HTML in, records out. Kept free of I/O so it can be tested on saved fixtures.\nexport function parsePage(html, url) {\n  const title = /<title[^>]*>([^<]*)<\\/title>/i.exec(html)?.[1]?.trim() ?? null;\n  return { url, title };\n}\n`,
    "src/main.mjs": `import { Actor } from "apify";\nimport { parsePage } from "./parse.mjs";\n\nawait Actor.init();\nconst { startUrls = [], maxItems = 100 } = (await Actor.getInput()) ?? {};\nlet count = 0;\nfor (const { url } of startUrls) {\n  if (count >= maxItems) break;\n  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; actor-forge)" } });\n  if (!res.ok) { console.warn(\`\${url} -> HTTP \${res.status}\`); continue; }\n  await Actor.pushData(parsePage(await res.text(), url));\n  count++;\n}\nawait Actor.exit();\n`,
    "test/fixtures/sample.html": `<html><head><title>Sample ${topic}</title></head><body></body></html>\n`,
    "test/parse.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport { parsePage } from "../src/parse.mjs";\n\ntest("parses the page title from a saved fixture", () => {\n  const html = fs.readFileSync(new URL("./fixtures/sample.html", import.meta.url), "utf8");\n  assert.equal(parsePage(html, "https://example.com").title, "Sample ${topic}");\n});\n`,
    "README.md": `# ${topic} Scraper\n\nExtracts public ${query} data from public pages. No login, no personal data.\n\n## Input\n- \`startUrls\`: public pages to scrape\n- \`maxItems\`: result limit\n\n## Output\nOne dataset item per page.\n`,
  };
}

function mcpServer(p: Platform, slug: string, topic: string, query: string): Record<string, string> {
  const ns = p.publish.namespace ?? "io.github.example";
  const name = `${ns}/${slug}`;
  const description = `MCP server for ${topic}.`.slice(0, 100);
  return {
    "package.json": JSON.stringify(
      {
        name: slug,
        version: "0.1.0",
        description,
        type: "module",
        main: "src/index.mjs",
        bin: { [slug]: "src/index.mjs" },
        files: ["src", "server.json", "README.md"],
        mcpName: name,
        keywords: ["mcp", "mcp-server", query],
        license: "MIT",
        scripts: { test: "node --test" },
        dependencies: { "@modelcontextprotocol/sdk": "^1.0.0", zod: "^3.23.0" },
      },
      null,
      2,
    ),
    "server.json": JSON.stringify(
      {
        $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
        name,
        description,
        version: "0.1.0",
        packages: [{ registryType: "npm", identifier: slug, version: "0.1.0", transport: { type: "stdio" } }],
      },
      null,
      2,
    ),
    "src/tools.mjs": `// Tool logic lives here so it can be tested without starting the server.\nexport async function describeTopic() {\n  return { topic: ${JSON.stringify(topic)}, status: "starter" };\n}\n`,
    "src/index.mjs": `#!/usr/bin/env node\nimport { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";\nimport { describeTopic } from "./tools.mjs";\n\nconst server = new McpServer({ name: ${JSON.stringify(slug)}, version: "0.1.0" });\nserver.tool("describe_topic", "Describe what this server covers.", {}, async () => ({\n  content: [{ type: "text", text: JSON.stringify(await describeTopic()) }],\n}));\nawait server.connect(new StdioServerTransport());\n`,
    "test/tools.test.mjs": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { describeTopic } from "../src/tools.mjs";\n\ntest("describeTopic names the topic", async () => {\n  assert.equal((await describeTopic()).topic, ${JSON.stringify(topic)});\n});\n`,
    "README.md": `# ${slug}\n\nMCP server for ${topic}.\n\n## Install\n\`npx ${slug}\`\n`,
  };
}

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))],
  );
}

/** Starter files come from platforms/<template.dir>/; {{slug}} {{topic}} {{query}} {{title}} are replaced in text files. */
function fromTemplate(p: Platform, slug: string, topic: string, query: string): Record<string, string> {
  const root = path.resolve(platformsDir(), p.template!.dir);
  if (!root.startsWith(platformsDir() + path.sep) || !fs.existsSync(root))
    throw new Error(`Template folder "${p.template!.dir}" not found under platforms/`);
  const vars: Record<string, string> = { slug, topic, query, title: topic };
  const out: Record<string, string> = {};
  for (const rel of walk(root)) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    out[rel] = text.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
  }
  return out;
}

/** Same placeholder substitution as scaffolding, for templates that only exist in memory (proposals). */
export function renderTemplate(files: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(files)) out[rel] = text.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
  return out;
}
