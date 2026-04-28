# Twitter Agent

Autonomous X (Twitter) posting system. Runs a daily pipeline that researches trending AI topics, writes developer-focused posts, and schedules them throughout the day. Built with Vercel AI SDK and xAI Grok.

## Pipeline

```
Hono (GET /cron/daily) → researcher → writer → scheduler → Neon DB → cron-job.org → X API
```

1. **Researcher** — searches X and the web for AI news, model releases, infra patterns, and developer tooling from the last 24 hours. Produces a research brief with 5–8 content angles. Uses `grok-4-latest` via the Responses API with `webSearch` and `xSearch` tools (`stopWhen: stepCountIs(10)` for multi-step tool use).

2. **Writer** — turns the brief into 4–6 X posts (single tweets or threads). Practical, builder-focused voice: no hype, no emojis, no em dashes. Uses `grok-4-latest` with structured output.

3. **Scheduler** — assigns optimal posting times targeting developer-active windows (8–10 AM, 12–2 PM, 5–7 PM, 9–11 PM EST), minimum 90 minutes apart. Uses `grok-4-1-fast-non-reasoning` with structured output.

Posts are persisted to Neon and published via cron-job.org polling `/cron/execute-post` every 30 minutes.

## Stack

- **[Vercel AI SDK](https://sdk.vercel.ai)** — `generateText` / `generateObject` for all LLM calls
- **[xAI Grok](https://x.ai)** — model provider for all three agents
- **[Hono](https://hono.dev)** — HTTP server (Bun runtime)
- **[Neon](https://neon.tech)** + **[Drizzle ORM](https://orm.drizzle.team)** — Postgres storage
- **[X API (XDK)](https://developer.x.com)** — tweet publishing via OAuth1
- **[Docker](https://docker.com)** — containerized via `oven/bun:1-alpine`
- **[Amazon ECR](https://aws.amazon.com/ecr/)** — container registry
- **[Amazon EC2](https://aws.amazon.com/ec2/)** — t3.micro, Ubuntu 22.04, us-east-2
- **[Nginx](https://nginx.org)** — reverse proxy (port 80 → 3010)
- **[GitHub Actions](https://github.com/features/actions)** — CI/CD: build → ECR push → SSH deploy on every push to `main`

## Local Development

```bash
npm install
cp .env.example .env
# Fill in API keys
npx drizzle-kit push
npm run dev
```

```bash
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

## Environment Variables

| Variable                | Description                        |
| ----------------------- | ---------------------------------- |
| `XAI_API_KEY`           | xAI API key for Grok models        |
| `X_API_KEY`             | X OAuth1 API key                   |
| `X_API_SECRET`          | X OAuth1 API secret                |
| `X_ACCESS_TOKEN`        | X OAuth1 access token              |
| `X_ACCESS_TOKEN_SECRET` | X OAuth1 access token secret       |
| `DATABASE_URL`          | Neon Postgres connection string    |
| `CRON_SECRET`           | Shared secret for cron HTTP routes |

## HTTP API

| Method | Path                 | Description                                    |
| ------ | -------------------- | ---------------------------------------------- |
| GET    | `/`                  | Health check                                   |
| GET    | `/cron/daily`        | Trigger the full pipeline (async, returns 202) |
| POST   | `/cron/execute-post` | Publish due posts (no body = scan all due)     |

All cron routes require `x-cron-secret` header or `?secret=` query param matching `CRON_SECRET`.

## Deployment (AWS EC2 + Docker)

### Infrastructure

- EC2 t3.micro, Ubuntu 22.04, `us-east-2`
- Docker image stored in Amazon ECR
- Nginx reverse proxy: port 80 → 3010
- systemd unit auto-starts Docker Compose on reboot

### CI/CD (GitHub Actions)

Every push to `main` triggers `.github/workflows/deploy.yml`:

1. Builds `linux/amd64` Docker image
2. Pushes to ECR (tagged with git SHA + `latest`)
3. SSH deploys to EC2: `docker compose pull && up -d`

### Manual deploy (first time or from local)

```bash
# Build and push amd64 image
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com
docker buildx build --platform linux/amd64 -t <AWS_ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com/twitter/agent:latest --push .

# On EC2
cd ~/twitter-agent
docker compose pull && docker compose up -d
```

## Cron-job.org

### Daily Pipeline

- **URL:** `GET http://<EC2_IP>/cron/daily`
- **Header:** `x-cron-secret: <CRON_SECRET>`
- **Schedule:** once daily (e.g. `0 12 * * *` for noon UTC)
- **Timeout:** 10s (route returns 202 immediately, pipeline runs async)

### Publish Due Posts

- **URL:** `POST http://<EC2_IP>/cron/execute-post`
- **Headers:** `x-cron-secret: <CRON_SECRET>`, `Content-Type: application/json`
- **Body:** empty (scan mode — publishes all pending posts with `scheduled_at <= NOW()`)
- **Schedule:** every 30 minutes
