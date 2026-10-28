# Writing a platform plugin

A platform is a place where people publish small tools (Apify Store, npm, Hugging Face...). Actor Forge needs four answers about it:

| Question | Manifest field |
|---|---|
| Where do I find gaps? | `discover` |
| What do I build? | `template` (starter files) |
| How do I know it is good? | `template.requiredFiles`, `template.test`, `template.rules`, plus the built-in checks |
| How does it get published? | `publish` (always a dry run in this build) |

A new platform that fits one of the existing discoverers needs **no TypeScript**: one manifest and one template folder.

## The quick way: ask the agent

In the chat, say what you want, for example *"add a platform for Node-RED nodes, they are npm packages with the keyword node-red"*. The agent reads `get-platform-guide` (the manifest schema generated from the validator, the rules and a complete worked example), drafts the manifest and starter files, and calls `propose-platform`. A proposal is checked for real before you ever see it:

- the manifest matches the schema, paths are safe, `liveEnabled` is false, and the kind is `template`;
- an existing token key (`APIFY_TOKEN`, `HF_TOKEN`, `NPM_TOKEN`) cannot be pointed at a different host;
- the untouched starter passes the platform's own vetting, and scouting the first two niches returns real data.

If anything fails, the agent gets the exact problems and fixes them. A valid proposal then **waits on the Plugins page**, showing what it would do (niches, publish command, which tokens go to which host, the reports it would run, the vetting results and a live probe). Only you can approve or reject it; the agent has no tool for that. Check that the niches are real product names before you approve.

To turn a platform off or on, use its switch on the Plugins page or tell the agent (*"disable the n8n platform"*). A disabled platform is skipped by Scout and hidden from the Radar and Portfolio; nothing is deleted.

The rest of this page is the manual route, and the reference the agent works from.

## 1. Pick a discoverer

`discover.type` chooses how Scout measures demand and supply. Every discoverer calls a public API and returns a gap score from 0 to 100 plus the evidence behind it.

| type | Source | Demand signal | Supply signal | Extra fields |
|---|---|---|---|---|
| `apify-store` | Apify Store API | Users across all actors for the site | Leader's rating and run failure rate | `apiUrl`, seed `category` |
| `mcp-npm` | npm search + MCP registry | Downloads of related packages | MCP servers found | `npmSearchUrl`, `registryUrl` |
| `npm-search` | npm search (+ optional built-in list) | Downloads of related packages | Packages with the `marker` text | `npmSearchUrl`, `marker`, `builtinIndexUrl` |
| `hf-spaces` | Hugging Face API | Downloads of related models | Spaces that match, and their likes | `apiUrl` |

Use `npm-search` for any ecosystem published on npm (n8n nodes, Raycast, VS Code, Obsidian, Node-RED...). Set `marker` to a word every package in that ecosystem contains. If the host app ships its own integrations, point `builtinIndexUrl` at a JSON list of `{ "name": ... }` so those count as supply (that is how n8n's built-in nodes are excluded).

## 2. Write the manifest

Create `platforms/<id>.json`:

```json
{
  "id": "raycast",
  "name": "Raycast Extensions",
  "blurb": "One sentence shown on the Plugins page.",
  "kind": "template",
  "template": {
    "dir": "raycast-template",
    "requiredFiles": ["package.json", "src/index.tsx", "README.md"],
    "test": ["node", "--test"],
    "rules": [
      { "type": "json-contains", "file": "package.json", "path": "keywords", "value": "raycast", "message": "package.json has the raycast keyword" },
      { "type": "file-regex", "file": "README.md", "pattern": "^# ", "message": "README has a title" }
    ]
  },
  "discover": {
    "type": "npm-search",
    "npmSearchUrl": "https://registry.npmjs.org/-/v1/search",
    "marker": "raycast",
    "seeds": [ { "topic": "Hotjar", "query": "hotjar" } ]
  },
  "vet": ["structure", "syntax", "unit-tests", "secrets"],
  "publish": { "type": "npm", "dryRunCommand": "npm publish --access public", "liveEnabled": false },
  "credentials": [
    { "key": "NPM_TOKEN", "label": "npm access token", "description": "Needed for live publishing.", "docsUrl": "https://www.npmjs.com/settings/~/tokens" }
  ]
}
```

Field notes:
- `seeds` are the niches Scout checks. Choose distinctive names (a generic word such as "wave" matches unrelated packages and inflates demand).
- `vet` is the list shown on the Plugins page. The checks that really run are in the table in step 4.
- `credentials` are registered with the framework's secrets store. The user adds them under **Settings, API keys** using the same key name, and the Plugins page shows connected or not.
- `publish.liveEnabled` stays `false` and `publish.liveSupported` is `false` for any plugin you write or the agent proposes. Publishing is then a dry run (it packages for real and records the command a live publish would run). `liveSupported` is a code capability: it is `true` only where a developer has written a real upload adapter (today `server/lib/live/apify.ts`, used by the Apify plugin), and a user must then switch "Publish for real" on for that platform.

## 3. Add reports (optional, for the platform's panel)

`reports` in the manifest become the cards on the **Portfolio** screen, one tab per platform. A report is a read-only `GET` plus a description of how to show it. No code is needed.

```json
"reports": [
  { "id": "runs-30d", "title": "Runs, last 30 days", "type": "stats",
    "request": { "url": "https://api.apify.com/v2/actor-runs?limit=1000&desc=true&startedAfter={{days30ago}}",
                 "auth": { "secret": "APIFY_TOKEN" } },
    "rows": "data.items",
    "stats": [ { "label": "Runs", "op": "count", "format": "number" },
               { "label": "Failed", "op": "count", "where": { "path": "status", "equals": "FAILED" } },
               { "label": "Cost", "op": "sum", "path": "usageTotalUsd", "format": "usd" } ] }
]
```

| type | Shows | Uses |
|---|---|---|
| `stats` | Big numbers | `stats[]`: `op` is `path` (read one value), `count`, `sum`, `avg` or `max` over the list at `rows`; optional `where` filter |
| `table` | A list | `rows` (path to the array, `""` for a top-level array), `columns[]` with `label`, `path`, `format`, and `limit` |
| `bars` | A small bar chart | `rows`, `bars: { x, y, format }`, `limit` |
| `link` | A button to a page | `href`, `linkLabel` (use it when the platform's API does not offer the data) |

`format` is `text`, `number`, `usd`, `percent` or `date`. Paths are dot paths (`stats.totalUsers30Days`).

Rules the engine enforces:
- Only `https` `GET`. Nothing is written to the platform.
- A report that sends a token (`auth.secret`) is refused unless the matching `credentials` entry declares a `host` equal to the request's host. A typo cannot send a token anywhere else.
- Variables: `{{days30ago}}`, and `{{<name>.<path>}}` from a `prefetch` request (for example look up the signed-in user's name first, then list their items). Substituted values are URL-encoded.
- If the platform's API does not provide something (Apify has no revenue endpoint), use a `link` report and say so in `description`. Do not estimate numbers the API does not give.

Check each endpoint against the platform's API documentation before you add it, and run `pnpm action run-report --platform <id> --report <id>` (needs the token under Settings, API keys).

## 4. Write the template folder

Create `platforms/<template.dir>/` with starter files that **work as they are**, tests included. Every text file may use `{{slug}}`, `{{topic}}`, `{{query}}` and `{{title}}`; they are replaced when a build starts. The agent then replaces the starter with the real implementation, so keep the logic in a small pure module with a test beside it.

## 5. What vetting runs

For every platform: required files exist, all `.json` files parse, JavaScript passes `node --check`, Python parses, the test command passes (`template.test`, default `node --test`; any `test/` or `tests/` folder counts), and no hardcoded secrets (API keys, bearer and npm tokens, private keys). Then your `template.rules`:

- `file-regex`: the file must match a regular expression (multi-line).
- `json-contains`: a dot path into a JSON file must equal the value, or be an array containing it.

Add a rule for every requirement the platform's review would enforce, since a rule is what turns "the file exists" into "the platform will accept it".

## 6. Check your work

```
pnpm typecheck                                  # manifest schema is validated at load time
pnpm action list-platforms                      # your plugin is listed, invalidManifests is empty
pnpm action scout-run --platform <id>           # real API calls; read the summaries for sense
pnpm action start-build --opportunityId <id>    # id from list-opportunities
pnpm action vet-build --id <build id>           # the untouched starter must score 100
```
Then break the build on purpose (a syntax error, a missing keyword) and confirm the right check fails. A rule that cannot fail is not checking anything.

Sanity-check the data by hand before you trust it: search the platform for the top three "gaps" yourself. If a tool already exists, fix the discoverer (this is how the n8n built-in list and the MCP search were corrected).

## When you need new code

A source the four discoverers cannot read needs a new function in `server/lib/scout.ts`: add a value to the `discover.type` enum in `server/lib/platforms.ts`, write a `scoutXxx(platform, seed)` that returns `{ topic, query, score, summary, evidence }`, and add a case to `scoutSeed`. Keep the score formula honest: demand must come from data, and supply must drop the score sharply (a tool that already exists is not a gap). The Radar and the build detail view also need one line each for the new `evidence.type` (see `supplyLine` and `Evidence` in `app/components/forge/RadarPage.tsx`).

## Platforms we chose not to build

Betting, trading and arbitrage bots. There is no public catalog to measure a gap against, nothing a vetting step could verify, real money is at risk, and bookmakers and exchanges forbid bots in their terms.
