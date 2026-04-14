# twitter-agent

Autonomous X (Twitter) posting system. Runs a daily pipeline that researches trending AI topics, writes developer-focused posts, and schedules them throughout the day.

## Pipeline

```
researcher → writer → scheduler → neon DB → pg_cron → X API
```

1. **Researcher** — searches X and the web for AI news, model releases, infra patterns, and developer tooling from the last 24 hours. Produces a research brief with 5–8 content angles. Uses `grok-4-latest` via the Responses API with `webSearch` and `xSearch` tools.

2. **Writer** — turns the brief into 4–6 X posts (single tweets or threads). Practical, builder-focused voice: no hype, no emojis, no em dashes. Uses `grok-4-latest` with structured output.

3. **Scheduler** — assigns optimal posting times targeting developer-active windows (8–10 AM, 12–2 PM, 5–7 PM, 9–11 PM EST), minimum 90 minutes apart. Uses `grok-4-1-fast-non-reasoning` with structured output.

Posts are persisted to Neon and published via `pg_cron` calling `/cron/execute-post`.

## Stack

- **[Vercel AI SDK](https://sdk.vercel.ai)** — `generateText` / `generateObject` for all LLM calls
- **[xAI Grok](https://x.ai)** — model provider for all three agents
- **[Hono](https://hono.dev)** — HTTP server
- **[Neon](https://neon.tech)** + **[Drizzle ORM](https://orm.drizzle.team)** — Postgres storage
- **[X API (XDK)](https://developer.x.com)** — tweet publishing via OAuth1

## Setup

```bash
npm install
cp .env.example .env
# Fill in API keys
```

**Required environment variables:**

| Variable                 | Description                          |
| ------------------------ | ------------------------------------ |
| `XAI_API_KEY`            | xAI API key for Grok models          |
| `X_API_KEY`              | X OAuth1 API key                     |
| `X_API_SECRET`           | X OAuth1 API secret                  |
| `X_ACCESS_TOKEN`         | X OAuth1 access token                |
| `X_ACCESS_TOKEN_SECRET`  | X OAuth1 access token secret         |
| `DATABASE_URL`           | Neon Postgres connection string      |
| `CRON_SECRET`            | Shared secret for cron HTTP routes   |

## Development

```bash
# Start server (port 3010, hot reload)
npm run dev

# Test individual agents against real APIs
npm run test:researcher
npm run test:writer
npm run test:scheduler

# Run the full pipeline end-to-end
npm run test:agents

# Trigger cron routes manually
npm run test:cron:daily
npm run test:cron:execute-post
```

## HTTP API

| Method | Path                  | Description                                              |
| ------ | --------------------- | -------------------------------------------------------- |
| GET    | `/`                   | Health check                                             |
| GET    | `/cron/daily`         | Trigger the full pipeline (async, returns 202)           |
| POST   | `/cron/execute-post`  | Publish a scheduled post `{ postId: number }`            |

All cron routes require `x-cron-secret` header (or `?secret=` query param) matching `CRON_SECRET`.

## Project structure

```
src/
  agents/
    researcher.ts   — web + X search → research brief
    writer.ts       — brief → structured posts
    scheduler.ts    — posts → schedule with timestamps
  pipeline.ts       — orchestrates the three agents
  db.ts             — schema, client, and query helpers
  x.ts              — X OAuth1 client and tweet publisher
  index.ts          — Hono server and all routes
  run-daily.ts      — CLI script to run the pipeline locally
  test-agents.ts    — per-agent and end-to-end test script
  test-post.ts      — direct tweet publish test
```
