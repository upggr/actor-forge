import { defineAction } from "@agent-native/core/action";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { manifestJsonSchema, platformsDir } from "../server/lib/platforms.js";

function example() {
  const dir = path.join(platformsDir(), "n8n-template");
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return { manifest: JSON.parse(fs.readFileSync(path.join(platformsDir(), "n8n.json"), "utf8")), templateFiles: files };
}

export default defineAction({
  description:
    "Read this before proposing a new platform. Returns the exact manifest JSON Schema, the available discoverers, the rules a proposal must satisfy, and a complete worked example (manifest plus template files).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => ({
    purpose:
      "A platform is a marketplace or registry where people publish small tools. A plugin tells Actor Forge where to find gaps (discover), what to build (template), how to check it (template rules) and how it would be published (always a dry run).",
    workflow: [
      "1. Ask the user which platform, and for the URL of its public API documentation if you do not already know the endpoints. Never invent an endpoint, a field name or a price.",
      "2. Choose a discover.type that can read the platform: apify-store, mcp-npm, npm-search (any npm-published ecosystem, set marker) or hf-spaces. If none can read it, say so and stop; a new discoverer needs code a developer must write.",
      "3. Choose 8 to 15 distinctive seed topics (full product names, not generic words such as 'wave' or 'teamwork'). Check a few by hand against the real API before including them.",
      "4. Write starter template files that work as they are, with a test, and template.rules that encode what the platform's review enforces.",
      "5. Call propose-platform. If it returns problems, fix exactly those and call it again.",
      "6. Tell the user the proposal is waiting on the Plugins page; only they can approve it. Never claim it is live before they do.",
    ],
    rules: [
      "kind must be \"template\". id and template.dir are lowercase letters, digits and dashes.",
      "publish.liveEnabled must be false.",
      "credentials[].host is the only host a token may be sent to. An existing token key (APIFY_TOKEN, HF_TOKEN, NPM_TOKEN) cannot be pointed at a different host.",
      "Reports are read-only https GET requests. Use a type \"link\" report when the platform's API does not offer the data; never estimate numbers an API does not give.",
      "The untouched starter must pass the platform's own vetting, and scouting the first two seeds must return results, or the proposal is rejected.",
      "Placeholders {{slug}} {{topic}} {{query}} {{title}} are replaced in every template file.",
      "At most 40 seeds, 40 template files, 60 KB per file.",
    ],
    discoverers: [
      { type: "apify-store", needs: ["apiUrl", "seed.category (optional)"] },
      { type: "mcp-npm", needs: ["npmSearchUrl", "registryUrl"] },
      { type: "npm-search", needs: ["npmSearchUrl", "marker", "builtinIndexUrl (optional list of {name} that ships with the host app)"] },
      { type: "hf-spaces", needs: ["apiUrl"] },
    ],
    manifestSchema: manifestJsonSchema(),
    example: example(),
  }),
});
