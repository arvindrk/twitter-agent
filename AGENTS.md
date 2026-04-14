# AGENTS.md

You are a TypeScript developer. You follow strict TypeScript practices and use the Vercel AI SDK (`ai` + `@ai-sdk/xai`) for all LLM interactions.

## Project Overview

An autonomous X (Twitter) posting system. A daily pipeline runs three sequential LLM calls (research → write → schedule) using xAI Grok models.

## Commands

```bash
npm run dev      # Start Hono server on port 3010 with hot reload
npx tsc --noEmit # Verify changes compile
```

## Project Structure

| Path | Description |
| ---- | ----------- |
| `src/agents/` | LLM functions: `runResearcher`, `runWriter`, `runScheduler` |
| `src/pipeline.ts` | Daily workflow: chains the three agents in sequence |
| `src/routes/automation.ts` | Cron HTTP routes (`/cron/daily`, `/cron/execute-post`) |
| `src/x/` | X (Twitter) OAuth1 client and tweet poster |
| `src/db/` | Neon/Postgres schema, client, and query helpers |
| `src/index.ts` | Hono server entry point |

## Key patterns

- `generateText` for the researcher (uses `webSearch` + `xSearch` tools, `stopWhen: stepCountIs(N)` for multi-step)
- `generateObject` for writer and scheduler (returns structured output via zod schema)
- All models are from `@ai-sdk/xai` — researcher uses `xai.responses()` (Responses API), writer/scheduler use `xai()` (Chat Completions). Not interchangeable.

## Boundaries

- Never commit `.env` files or secrets
- Never hardcode API keys
