# Actor Forge

An agent-native app that finds gaps on marketplaces, builds a project for one, vets it with real checks, and hands it to a person for approval. Built for the Builder.io Agent-Native Hackathon.

See [SUBMISSION.md](SUBMISSION.md) for what it does and the demo script, and [docs/PLUGINS.md](docs/PLUGINS.md) for adding a platform.

## Run

```bash
pnpm install
cp .env.example .env     # add an LLM key (OPENROUTER_API_KEY or another provider)
pnpm dev                 # http://localhost:8080, then "Continue as local dev"
```

Needs Node 22 and pnpm. Local data lives in `data/` (PGlite). Generated projects are written to `builds/`.

Optional tokens (only for the Portfolio panels and, later, live publishing) are added in the app under **Settings, API keys**: `APIFY_TOKEN`, `NPM_TOKEN`, `HF_TOKEN`.

## Check

```bash
pnpm test                # 68 unit tests: scoring, pricing, report engine, vetting, proposals, Apify upload
pnpm typecheck
pnpm agent-native:doctor
pnpm build
```

## Layout

| Path | What |
|---|---|
| `actions/` | Every capability as a `defineAction()`, shared by the UI, the agent, HTTP and CLI |
| `platforms/` | One JSON manifest per platform, plus a starter template folder |
| `server/lib/` | Scout (discovery), vetting, report engine, pricing, proposals |
| `app/components/forge/` | Radar, Pipeline, Approvals, Portfolio and Plugins screens |
| `docs/PLUGINS.md` | How to write a platform plugin, by hand or by asking the agent |

Human-only actions (`decide-build`, `decide-suggestion`, `decide-platform-proposal`) are hidden from the agent, so it cannot approve its own work.
