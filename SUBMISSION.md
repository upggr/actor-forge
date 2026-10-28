# Actor Forge

An agent-native app that finds marketplace gaps, builds a project for one, vets it with real checks, and hands it to a person for approval.

**Problem.** Marketplaces such as the Apify Store and the MCP registry reward whoever ships the right tool first, but finding the gap, building the tool, and trusting the result is slow manual work.

**What it does**
- **Scout** queries live APIs (Apify Store, npm, MCP registry) and ranks niches by gap score: proven demand, weak or missing supply. Every score links to its evidence.
- **Build** creates a runnable starter project; the agent replaces it with a real implementation.
- **Vet** runs real checks (syntax, the project's own unit tests, secret scan, platform rules). Nothing is scored by the model.
- **Approve** is a human-only gate. The agent cannot approve; publishing is refused until a person does.
- **Keeper** re-vets shipped builds, re-checks the market for new competitors, and reports unhealthy live actors.
- **Portfolio**: one panel per platform. Reports (usage, limits, run totals, daily cost, recent runs) are defined in each platform's manifest, run read-only with the user's own token, and the token can only be sent to the host the manifest declares. A pricing check compares each Apify actor with real Store competitors, and the agent proposes feature ideas with evidence. Suggestions are accepted only by a person.
- **Scheduled agent**: a daily Scout + Keeper run and a weekly portfolio review, created as framework automations (they fire on a deployed app, not on a local dev machine).
- **Plugins**: four platforms today (Apify Store, MCP servers, n8n community nodes, Hugging Face Spaces). Each is one JSON manifest plus a template folder; `docs/PLUGINS.md` explains how to add one with no TypeScript, and the agent can do it from chat: it drafts and validates a proposal, and only the user can approve it. Platforms can be switched off and on from the Plugins page or by asking the agent.

**Agent-Native use.** Every capability is a `defineAction()` shared by the UI, the agent, HTTP and CLI. The approval action is hidden from the agent (`agentTool: false`). Tokens live in the shared secrets store.

**Honest limits.** Publishing is a dry run (real packaging, no upload). Apify's public API has no revenue endpoint, so income is a link to the Console, not an estimate. Gap scores are evidence-based but are a signal, not a guarantee of demand.

## Verified
- 57 automated tests (scoring, pricing, report engine and its token-host safety rules, vetting of every platform's starter and of deliberately broken builds, proposal validation).
- Full flow exercised in a real browser (Scout, build, vet, approve, publish dry run, Keeper, Plugins, Portfolio).
- The Portfolio panels and pricing check were run against a real Apify account (23 actors), read-only.
- The chat agent built a real MCP server end to end and proposed a new platform, which waited for approval.

## Run
```
pnpm install
cp .env.example .env   # add an LLM key, e.g. OPENROUTER_API_KEY
pnpm dev               # http://localhost:8080 -> "Continue as local dev"
```
Add `APIFY_TOKEN` / `NPM_TOKEN` under Settings -> API keys (needed only for live publishing, which is off).

## Before recording
1. `pnpm dev`, open http://localhost:8080, click Continue as local dev.
2. Optional, for the Portfolio panel: Settings, API keys, add `APIFY_TOKEN`.
3. Optional, scheduled agent: in the chat, ask the agent to create two automations: "daily-scout-and-keeper" (cron `0 8 * * *`: run scout-run, then keeper-check, report the top new gaps and any alert, never start builds) and "weekly-portfolio-review" (cron `0 9 * * 1`: run list-my-actors and pricing-check, then propose at most two evidence-based feature suggestions per actor, never change anything on Apify). Schedules fire on a deployed app, not on a local dev machine.
4. Press Run Scout once so the Radar is full, then record.

## Demo script (about 2 minutes)
1. Radar: press Run Scout; tiles light up from live data. Click a zero-supply niche (e.g. Mollie) and read the evidence.
2. Build this: open Pipeline, watch the agent write real files in chat.
3. Vetting: show the real checks and the 100 score; break a file to show a failure (optional).
4. Approvals: the build is waiting for you. Approve it yourself.
5. Publish (dry run), then Run Keeper.
6. Plugins: show four platforms, each just a JSON file and a template folder.

## Third-party
Agent-Native framework and chat template (`@agent-native/core`), React, Tailwind, Drizzle, Playwright (testing only). Data comes from the public Apify Store, npm and MCP registry APIs.
