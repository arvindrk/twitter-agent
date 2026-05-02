# AGENTS.md

You are a TypeScript developer. You follow strict TypeScript practices and use the Vercel AI SDK (`ai` + `@ai-sdk/xai`) for all LLM interactions.

An autonomous X (Twitter) posting system. Daily pipeline: research → write → schedule → persist. Inbound mentions/replies handled via Account Activity webhook.

## Commands

```bash
bun run dev      # Start Hono server on port 3010 with hot reload
bun run test     # Run all unit tests
bunx tsc --noEmit # Verify changes compile
```

## Key Patterns

- `generateText` for the researcher (`webSearch` + `xSearch` tools, `stopWhen: stepCountIs(10)` for multi-step)
- `generateObject` for writer, scheduler, inbound engagement (structured output via Zod)
- Researcher uses `xai.responses()` (Responses API); all others use `xai()` (Chat Completions). **Not interchangeable.**
- Routes delegate to services. Services orchestrate agents, repos, and `x/api`. No cross-layer shortcuts.

## Engineering Standards

### Layer Rules

Each layer has a fixed set of permitted dependencies. Violations break the architecture.

| Layer                            | Permitted imports                       | Forbidden                 |
| -------------------------------- | --------------------------------------- | ------------------------- |
| `src/routes/`                    | `hono`, middleware, services            | repos, `x/api`, agents    |
| `src/middleware/`                | `node:crypto`, `process.env`            | all app layers            |
| `src/services/`                  | repos, `x/api`, agents                  | `hono`, routes            |
| `src/agents/`                    | `ai`, `@ai-sdk/xai`, `zod`              | DB, `x/api`, services     |
| `src/db/*.repo.ts`               | `db/client`, `db/schema`, `drizzle-orm` | services, agents, `x/api` |
| `src/x/api.ts`                   | `x/client`, `process.env`               | DB, services, agents      |
| `src/config.ts`, `src/logger.ts` | `process.env`                           | everything else           |

Never import upward (repo → service) or sideways across unrelated branches (route → repo directly).

### Minimalism

- No abstractions until 2+ independent callsites need them.
- No wrapper functions that only forward a call.
- No barrel `index.ts` unless 3+ files are imported externally as a group.
- Never add a file "for future use."

### Pure Functions

- Data-transformation helpers (formatters, message builders, sanitizers) must be pure: no I/O, no side effects.
- Keep pure helpers co-located with their consumer unless used in 2+ files.

### Type Safety

- No `any` except inside `mock.module()` factory callbacks in tests.
- Inferred Drizzle types (`$inferSelect`, `$inferInsert`) from `db/schema.ts` are the canonical source of truth for DB row shapes. Never redefine them manually.
- All exported functions have explicit return type annotations.

### Dead / Unused / Duplicate Code — Run Before Every Commit

1. `bunx tsc --noEmit` — zero errors. Unused imports surface here.
2. Any exported symbol with no import site? Delete it.
3. Same logic in 2+ places? Extract or consolidate.
4. Commented-out code? Delete it — use git history.
5. Type manually defined that already exists in `db/schema.ts`? Replace with the canonical export.
6. Stale test mocks for renamed or deleted functions? Update alongside the source change.

## Boundaries

- Never commit `.env` files or secrets
- Never hardcode API keys
