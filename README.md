# X (Twitter) AI Agent - Autonomous Posting & Engagement

<p align="center">
  <a href="https://github.com/arvindrk/twitter-agent/actions/workflows/ci.yml">
    <img src="https://github.com/arvindrk/twitter-agent/actions/workflows/ci.yml/badge.svg" alt="ci" />
  </a>
</p>

Autonomous X account. Researches AI/dev topics daily, writes and schedules posts, and replies to mentions in real time — all driven by xAI Grok via the Vercel AI SDK.

## How it works

Three independent loops:

**Posting pipeline** — triggered once daily by cron:

```
GET /cron/daily → researcher → writer → scheduler → Neon → cron-job.org → POST /cron/execute-post → X API
```

1. **Researcher** (`grok-4-latest`, Responses API) — `webSearch` + `xSearch`, up to 10 steps. Produces a brief with 5–8 AI/infra content angles from the last 24 hours.
2. **Writer** (`grok-4-latest`, Chat Completions) — turns the brief into 4–6 posts. Structured output via Zod.
3. **Scheduler** (`grok-4-1-fast-non-reasoning`) — assigns times to named slots (morning/lunch/afternoon/evening/night), minimum 90 minutes apart. Structured output.

Posts land in Neon as `pending`. cron-job.org polls `/cron/execute-post` every 30 minutes to publish what's due.

**Outbound engagement loop** — triggered on a schedule:

```
POST /cron/outbound-engagement → getHomeFeed(100) → signal filter → outbound agent → like/retweet/follow → X API
```

1. Fetches up to 100 tweets from the home timeline (accounts the user follows).
2. Deduplicates by tweet ID; filters by signal threshold (≥10 likes, 100–500K author followers).
3. Queries `outbound_engagement_log` to skip already-acted tweets and authors on a 6-hour follow cooldown.
4. **Outbound agent** (`grok-4-latest`, Chat Completions) — scores each candidate and returns like/retweet/follow decisions. Per-run caps: 10 likes, 3 retweets, 3 follows.
5. Executes actions via X API; logs all outcomes for dedup and cooldown enforcement.

**Inbound engagement loop** — real-time via X Account Activity API:

```
X webhook → POST /webhooks/x → inbound engagement agent → replyToTweet → X API
```

On every mention or reply, the inbound engagement agent (`grok-4-latest`) reads full thread context and returns one of:

- **skip** — spam, low-effort, or nothing to add
- **reply/close** — self-contained reply that ends the exchange
- **reply/probe** — reply ending with one pointed, technical question

Claims are written to `engagement_log` before the LLM call. Duplicate webhook deliveries are no-ops.

## Stack

- **[Vercel AI SDK](https://sdk.vercel.ai)** — `generateText` (researcher) / `generateObject` (writer, scheduler, engagement)
- **[xAI Grok](https://x.ai)** — Responses API and Chat Completions (not interchangeable)
- **[Bun](https://bun.sh)** — runtime, package manager, test runner
- **[Hono](https://hono.dev)** — HTTP server on port 3010
- **[Neon](https://neon.tech)** + **[Drizzle ORM](https://orm.drizzle.team)** — Postgres (scheduled posts + engagement log)
- **[X API v2 (XDK)](https://developer.x.com)** — OAuth1 for posting; Bearer token for thread hydration
- **[Docker](https://docker.com)** — `oven/bun:1-alpine`
- **[Amazon ECR](https://aws.amazon.com/ecr/)** + **[EC2](https://aws.amazon.com/ec2/)** — t3.micro, us-east-2, behind Nginx
- **[GitHub Actions](https://github.com/features/actions)** — build → ECR push → SSH deploy on every `main` push

## Local development

```bash
bun install
cp .env.example .env
bunx drizzle-kit push
bun run dev
```

```bash
bun run test:researcher
bun run test:writer
bun run test:scheduler
bun run test:agents          # full pipeline

bun run test:cron:daily
bun run test:cron:execute-post
```

## Environment variables

| Variable                | Description                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `XAI_API_KEY`           | xAI API key                                                                            |
| `X_API_KEY`             | OAuth1 API key                                                                         |
| `X_API_SECRET`          | OAuth1 API secret (also used for webhook HMAC)                                         |
| `X_ACCESS_TOKEN`        | OAuth1 access token                                                                    |
| `X_ACCESS_TOKEN_SECRET` | OAuth1 access token secret                                                             |
| `X_USER_ID`             | Numeric user ID — required for like, retweet, follow, and webhook self-event filtering |
| `X_BEARER_TOKEN`        | App-only bearer token (thread context hydration)                                       |
| `X_HANDLE`              | Agent's X handle without `@` — used to enforce the 1:1 thread depth cap                |
| `DATABASE_URL`          | Neon Postgres connection string                                                        |
| `CRON_SECRET`           | **Required.** Shared secret for `/cron/*` routes                                       |

## HTTP API

| Method | Path                        | Description                                                  |
| ------ | --------------------------- | ------------------------------------------------------------ |
| GET    | `/`                         | Health check                                                 |
| GET    | `/cron/daily`               | Trigger posting pipeline (async, returns 202)                |
| POST   | `/cron/execute-post`        | Publish due posts; no body = scan all, `{ postId }` = single |
| POST   | `/cron/outbound-engagement` | Trigger outbound engagement run (async, returns 202)         |
| GET    | `/webhooks/x`               | X CRC handshake                                              |
| POST   | `/webhooks/x`               | Incoming mention/reply events (HMAC-verified)                |

Cron routes require the `x-cron-secret` header. Query-param auth is not supported (avoids leaking secrets to access logs).

## Deployment

Every push to `main` builds a `linux/amd64` image, pushes to ECR, and SSH-deploys to EC2 via `docker compose pull && up -d`.

```bash
aws ecr get-login-password --region us-east-2 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com
docker buildx build --platform linux/amd64 \
  -t <ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com/twitter/agent:latest --push .

# On EC2
cd ~/twitter-agent && docker compose pull && docker compose up -d
```

**Register the webhook** (once after deploy):

```bash
bun scripts/subscribe-webhook.ts
```

## Cron schedule (cron-job.org)

| Job                 | Endpoint                         | Schedule                     |
| ------------------- | -------------------------------- | ---------------------------- |
| Daily pipeline      | `GET /cron/daily`                | Once daily                   |
| Publish due posts   | `POST /cron/execute-post`        | Every 30 minutes             |
| Outbound engagement | `POST /cron/outbound-engagement` | Configurable (e.g. every 2h) |
