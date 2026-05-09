import { describe, it, expect } from "bun:test";
import { computeThreadMeta } from "./engagement.js";

const T = (handle: string, text = "x") => ({ handle, text });

describe("computeThreadMeta", () => {
	it("empty thread: no cap, no skip", () => {
		const m = computeThreadMeta([], "agent");
		expect(m.agentReplies).toBe(0);
		expect(m.uniqueOthers).toBe(0);
		expect(m.forceClose).toBe(false);
		expect(m.skip).toBe(false);
	});

	it("1 agent reply in 1:1: can still probe", () => {
		const thread = [T("user"), T("agent")];
		const m = computeThreadMeta(thread, "agent");
		expect(m.agentReplies).toBe(1);
		expect(m.uniqueOthers).toBe(1);
		expect(m.forceClose).toBe(false);
		expect(m.skip).toBe(false);
	});

	it("2 agent replies in 1:1: force close", () => {
		const thread = [T("user"), T("agent"), T("user"), T("agent")];
		const m = computeThreadMeta(thread, "agent");
		expect(m.agentReplies).toBe(2);
		expect(m.uniqueOthers).toBe(1);
		expect(m.forceClose).toBe(true);
		expect(m.skip).toBe(false);
	});

	it("3+ agent replies in 1:1: skip entirely", () => {
		const thread = [
			T("user"),
			T("agent"),
			T("user"),
			T("agent"),
			T("user"),
			T("agent"),
		];
		const m = computeThreadMeta(thread, "agent");
		expect(m.agentReplies).toBe(3);
		expect(m.uniqueOthers).toBe(1);
		expect(m.forceClose).toBe(false);
		expect(m.skip).toBe(true);
	});

	it("2 agent replies but multi-party: no cap", () => {
		const thread = [T("user"), T("agent"), T("alice"), T("agent")];
		const m = computeThreadMeta(thread, "agent");
		expect(m.agentReplies).toBe(2);
		expect(m.uniqueOthers).toBe(2);
		expect(m.forceClose).toBe(false);
		expect(m.skip).toBe(false);
	});

	it("handle comparison is case-insensitive", () => {
		const thread = [T("User"), T("AGENT"), T("user"), T("Agent")];
		const m = computeThreadMeta(thread, "agent");
		expect(m.agentReplies).toBe(2);
		expect(m.uniqueOthers).toBe(1);
		expect(m.forceClose).toBe(true);
		expect(m.skip).toBe(false);
	});
});
