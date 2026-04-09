# Twitter Agent

An AI-powered content automation system that researches trending AI topics, writes authentic developer-focused posts, and schedules them optimally on X (Twitter). Built with [Mastra](https://mastra.ai) and TypeScript.

## What it does

The system runs a three-stage agentic pipeline:

1. **Researcher** — Searches the web and X for trending AI news, model releases, infra patterns, and developer tools from the last 7 days. Produces a structured research brief with 5–8 content angles.

2. **Writer** — Transforms the research brief into 4–6 authentic X posts (individual tweets or threads). Writes in a practical, builder-focused voice: no hype, no emojis, no em dashes.

3. **Scheduler** — Assigns optimal posting times based on developer audience activity windows (EST/PST), with a minimum 90-minute gap between posts.

## Stack

- **[Mastra](https://mastra.ai)** — Agent orchestration, memory, storage, and observability
- **[xAI Grok](https://x.ai)** — Powers the researcher, writer, and scheduler agents
- **[X API (XDK)](https://developer.x.com)** — Real-time X search for trending posts
- **[Hono](https://hono.dev)** — HTTP server with Mastra integration
- **LibSQL + DuckDB** — Local storage and observability data
- **dotenvx** — Encrypted environment variable management

## Setup

```bash
bun install
cp .env.example .env
# Fill in your API keys in .env
```

**Required environment variables:**

| Variable              | Description                     |
| --------------------- | ------------------------------- |
| `XAI_API_KEY`         | xAI API key for Grok models     |
| `X_API_BEARER_TOKEN`  | X API bearer token              |
| `X_API_CLIENT_ID`     | X OAuth client ID               |
| `X_API_CLIENT_SECRET` | X OAuth client secret           |
| `DATABASE_URL`        | Neon database connection string |

## Usage

```bash
# Start Mastra Studio (dev UI at localhost:4111)
npm run dev

# Run the full research → write → schedule pipeline
npm run test:agents

# Run individual agents
npm run test:researcher
npm run test:writer
npm run test:scheduler
```

The server runs on port 3010. Mastra Studio is available at `localhost:4111` for visualizing agent traces and runs.

## Agents

### Researcher

Searches for AI content signals across the web and X. Focuses on frontier model releases, agentic frameworks, inference infrastructure, applied AI use cases, and emerging developer tools.

### Writer

Converts research into X posts with a specific voice: practical, technical, first-person, contrarian when warranted. Threads are 3–6 tweets, prose-based (no bullet points), max 1 hashtag, no emojis.

### Scheduler

Assigns posting times targeting developer-heavy windows: 8–10 AM, 12–2 PM, 5–7 PM, and 9–11 PM EST. Puts the most broadly appealing content in prime slots, niche/technical posts in off-peak times.
