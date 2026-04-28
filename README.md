# Twitter Agent

Autonomous X (Twitter) posting system. Runs a daily pipeline that researches trending AI topics, writes developer-focused posts, and schedules them throughout the day. Built with Vercel AI SDK and xAI Grok.

## Pipeline

```
Hono (GET /cron/daily) → researcher → writer → scheduler → Neon DB → pg_cron → X API
```

1. **Researcher** — searches X and the web for AI news, model releases, infra patterns, and developer tooling from the last 24 hours. Produces a research brief with 5–8 content angles. Uses `grok-4-latest` via the Responses API with `webSearch` and `xSearch` tools (`stopWhen: stepCountIs(10)` for multi-step tool use).

2. **Writer** — turns the brief into 4–6 X posts (single tweets or threads). Practical, builder-focused voice: no hype, no emojis, no em dashes. Uses `grok-4-latest` with structured output.

3. **Scheduler** — assigns optimal posting times targeting developer-active windows (8–10 AM, 12–2 PM, 5–7 PM, 9–11 PM EST), minimum 90 minutes apart. Uses `grok-4-1-fast-non-reasoning` with structured output.

Posts are persisted to Neon and published via `pg_cron` calling `/cron/execute-post`.

## Stack

- **[Vercel AI SDK](https://sdk.vercel.ai)** — `generateText` / `generateObject` for all LLM calls
- **[xAI Grok](https://x.ai)** — model provider for all three agents
- **[Hono](https://hono.dev)** — HTTP server
- **[Neon](https://neon.tech)** + **[Drizzle ORM](https://orm.drizzle.team)** — Postgres storage
- **[X API (XDK)](https://developer.x.com)** — tweet publishing via OAuth1
- **[pg_cron](https://neon.tech/docs/extensions/pg_cron)** — Postgres-native cron that calls `/cron/execute-post` to publish due posts

## Setup

```bash
npm install
cp .env.example .env
# Fill in API keys
npx drizzle-kit push
```

**Required environment variables:**

| Variable                | Description                        |
| ----------------------- | ---------------------------------- |
| `XAI_API_KEY`           | xAI API key for Grok models        |
| `X_API_KEY`             | X OAuth1 API key                   |
| `X_API_SECRET`          | X OAuth1 API secret                |
| `X_ACCESS_TOKEN`        | X OAuth1 access token              |
| `X_ACCESS_TOKEN_SECRET` | X OAuth1 access token secret       |
| `DATABASE_URL`          | Neon Postgres connection string    |
| `CRON_SECRET`           | Shared secret for cron HTTP routes |

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

# Verify TypeScript compiles
npx tsc --noEmit

# Trigger cron routes manually
npm run test:cron:daily
npm run test:cron:execute-post
```

## HTTP API

| Method | Path                 | Description                                    |
| ------ | -------------------- | ---------------------------------------------- |
| GET    | `/`                  | Health check                                   |
| POST   | `/test/post`         | Publish a tweet directly `{ text: string }`    |
| GET    | `/cron/daily`        | Trigger the full pipeline (async, returns 202) |
| POST   | `/cron/execute-post` | Publish a scheduled post `{ postId: number }`  |

All cron routes require `x-cron-secret` header (or `?secret=` query param) matching `CRON_SECRET`.

## Cron-job.org

### Daily Pipeline (cron-job.org)

Create a job on [cron-job.org](https://cron-job.org) to trigger the full pipeline once per day:

- **URL:** `GET https://<your-vercel-url>/cron/daily`
- **Headers:** `x-cron-secret: <CRON_SECRET>`
- **Schedule:** once daily (e.g. `0 12 * * *` for noon UTC)

### Publish-Due Cron (cron-job.org)

Create a second job on [cron-job.org](https://cron-job.org):

- **URL:** `POST https://<your-vercel-url>/cron/execute-post`
- **Headers:** `x-cron-secret: <CRON_SECRET>`, `Content-Type: application/json`
- **Body:** empty
- **Schedule:** every 30 minutes

No body means scan mode: queries all `pending` posts with `scheduled_at <= NOW()` and publishes each.
