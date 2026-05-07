import { Hono } from "hono";
import { isAuthorized } from "../middleware/auth.js";
import { runDailyWorkflowAndPersist } from "../services/pipeline.js";
import { publishDuePosts, publishSinglePost } from "../services/publisher.js";

const cron = new Hono();

cron.get("/daily", async (c) => {
	if (!isAuthorized(c.req.raw))
		return c.json({ ok: false, error: "Unauthorized" }, 401);

	const runId = crypto.randomUUID();
	console.log(`[cron/daily] starting run ${runId}`);

	runDailyWorkflowAndPersist()
		.then(({ count, ids }) =>
			console.log(
				`[cron/daily] run ${runId} complete — ${count} posts (ids: ${ids.join(", ")})`,
			),
		)
		.catch((err: unknown) =>
			console.error(
				`[cron/daily] run ${runId} failed:`,
				err instanceof Error ? err.message : err,
			),
		);

	return c.json({ ok: true, runId }, 202);
});

cron.post("/execute-post", async (c) => {
	if (!isAuthorized(c.req.raw))
		return c.json({ ok: false, error: "Unauthorized" }, 401);

	const body = await c.req.json().catch(() => null);

	if (!body || typeof body.postId !== "number") {
		const result = await publishDuePosts();
		return c.json({ ok: true, ...result });
	}

	const result = await publishSinglePost(body.postId as number);
	if (!result.ok)
		return c.json({ ok: false, error: result.error }, result.httpStatus);
	if (result.status === "skipped")
		return c.json({ ok: true, status: "skipped" });
	return c.json({
		ok: true,
		tweetId: result.tweetId,
		tweetUrl: result.tweetUrl,
	});
});

export default cron;
