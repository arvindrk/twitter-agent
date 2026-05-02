# X Agent

<p align="center">
  <a href="https://github.com/arvindrk/twitter-agent/actions/workflows/ci.yml">
    <img src="https://github.com/arvindrk/twitter-agent/actions/workflows/ci.yml/badge.svg" alt="ci" />
  </a>
</p>

Autonomous X account. Researches AI/dev topics daily, writes and schedules posts, and replies to mentions in real time — all driven by xAI Grok via the Vercel AI SDK.

## How it works

Two independent loops:

**Posting pipeline** — triggered once daily by cron:
```
GET /cron/daily → researcher → writer → scheduler → Neon → cron-job.org → POST /cron/execute-post → X API
```

1. **Researcher** (`grok-4-latest`, Responses API) — `webSearch` + `xSearch`, up to 10 steps. Produces a brief with 5–8 AI/infra content angles from the last 24 hours.
2. **Writer** (`grok-4-latest`, Chat Completions) — turns the brief into 4–6 posts. Structured output via Zod.
3. **Scheduler** (`grok-4-1-fast-non-reasoning`) — assigns times to named slots (morning/lunch/afternoon/evening/night), minimum 90 minutes apart. Structured output.

Posts land in Neon as `pending`. cron-job.org polls `/cron/execute-post` every 30 minutes to publish what's due.

**Engagement loop** — real-time via X Account Activity API:
```
X webhook → POST /webhooks/x → engagement agent → replyToTweet → X API
```

On every mention or reply, the engagement agent (`grok-4-latest`) reads full thread context and returns one of:
- **skip** — spam, low-effort, or nothing to add
- **reply/close** — self-contained reply that ends the exchange
- **reply/probe** — reply ending with one pointed, technical question

Claims are written to `engagement_log` before the LLM call. Duplicate webhook deliveries are no-ops.

## Stack

- **[Vercel AI SDK](https://sdk.vercel.ai)** — `generateText` (researcher) / `generateObject` (writer, scheduler, engagement)
- **[xAI Grok](https://x.ai)** — Responses API and Chat Completions (not interchangeable)
- **[Hono](https://hono.dev)** + **Node.js** — HTTP server on port 3010
- **[Neon](https://neon.tech)** + **[Drizzle ORM](https://orm.drizzle.team)** — Postgres (scheduled posts + engagement log)
- **[X API v2 (XDK)](https://developer.x.com)** — OAuth1 for posting; Bearer token for thread hydration
- **[Docker](https://docker.com)** — `oven/bun:1-alpine`
- **[Amazon ECR](https://aws.amazon.com/ecr/)** + **[EC2](https://aws.amazon.com/ec2/)** — t3.micro, us-east-2, behind Nginx
- **[GitHub Actions](https://github.com/features/actions)** — build → ECR push → SSH deploy on every `main` push

## Local development

```bash
npm install
cp .env.example .env
npx drizzle-kit push
npm run dev
```

```bash
npm run test:researcher
npm run test:writer
npm run test:scheduler
npm run test:agents          # full pipeline

npm run test:cron:daily
npm run test:cron:execute-post
```

## Environment variables

| Variable                | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `XAI_API_KEY`           | xAI API key                                         |
| `X_API_KEY`             | OAuth1 API key                                      |
| `X_API_SECRET`          | OAuth1 API secret (also used for webhook HMAC)      |
| `X_ACCESS_TOKEN`        | OAuth1 access token                                 |
| `X_ACCESS_TOKEN_SECRET` | OAuth1 access token secret                          |
| `X_USER_ID`             | Numeric user ID (filters self-events on webhooks)   |
| `X_BEARER_TOKEN`        | App-only bearer token (thread context hydration)    |
| `DATABASE_URL`          | Neon Postgres connection string                     |
| `CRON_SECRET`           | Shared secret for cron HTTP routes                  |

## HTTP API

| Method | Path                  | Description                                                  |
| ------ | --------------------- | ------------------------------------------------------------ |
| GET    | `/`                   | Health check                                                 |
| GET    | `/cron/daily`         | Trigger posting pipeline (async, returns 202)                |
| POST   | `/cron/execute-post`  | Publish due posts; no body = scan all, `{ postId }` = single |
| GET    | `/webhooks/x`         | X CRC handshake                                              |
| POST   | `/webhooks/x`         | Incoming mention/reply events (HMAC-verified)                |

Cron routes require `x-cron-secret` header or `?secret=` query param.

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
npx tsx scripts/subscribe-webhook.ts
```

## Cron schedule (cron-job.org)

| Job               | Endpoint                     | Schedule         |
| ----------------- | ---------------------------- | ---------------- |
| Daily pipeline    | `GET /cron/daily`            | Once daily       |
| Publish due posts | `POST /cron/execute-post`    | Every 30 minutes |
