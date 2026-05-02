# Contributing

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- Node.js >= 20 (for TypeScript tooling)
- Access to xAI API and X (Twitter) API credentials

## Setup

```bash
git clone https://github.com/arvindrk/twitter-agent.git
cd twitter-agent
bun install
cp .env.example .env  # fill in your API keys
```

## Development

```bash
bun run dev       # start server on port 3010 with hot reload
bun run typecheck # type check without emitting
bun run test      # run the full test suite (no API tokens used)
```

## Project structure

| Path              | What lives here                                          |
| ----------------- | -------------------------------------------------------- |
| `src/agents/`     | LLM functions: researcher, writer, scheduler, engagement |
| `src/services/`   | Orchestration: pipeline, publisher, engagement handler   |
| `src/routes/`     | Hono HTTP routes: cron, webhooks                         |
| `src/middleware/` | Auth middleware (cron secret verification)               |
| `src/db/`         | Drizzle schema, Neon client, post/engagement repos       |
| `src/x/`          | X (Twitter) OAuth1 client and API wrapper                |
| `src/test/`       | Shared test helpers and mock factories                   |
| `scripts/`        | One-off run and test scripts                             |

## Making changes

1. Open an issue to discuss the change before starting large work.
2. Branch from `main`, keep commits focused and descriptive.
3. Run `bun run typecheck && bun run test` before pushing — CI enforces both.
4. Open a pull request against `main`. The CI workflow must pass before merging.

## Commit style

Follow the existing convention: `type: short description` (e.g. `feat:`, `fix:`, `chore:`, `test:`, `docs:`).

## Environment variables

Never commit `.env` or any file containing API keys. See `AGENTS.md` for the full list of required variables.
