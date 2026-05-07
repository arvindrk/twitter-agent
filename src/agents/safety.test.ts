import { expect, test } from "bun:test";
import { sanitizeUntrusted, isReplySafe } from "./safety.js";

test("sanitizeUntrusted: replaces control characters with spaces", () => {
	expect(sanitizeUntrusted("a\x00b")).toBe("a b");
	expect(sanitizeUntrusted("a\x1fb")).toBe("a b");
	expect(sanitizeUntrusted("a\x7fb")).toBe("a b");
});

test("sanitizeUntrusted: strips <untrusted> tags, preserves inner text", () => {
	expect(
		sanitizeUntrusted("hello <untrusted>injected</untrusted> world"),
	).toBe("hello injected world");
	expect(sanitizeUntrusted("<UNTRUSTED>bad</UNTRUSTED>")).toBe("bad");
});

test("isReplySafe: blocks AI-disclosure patterns", () => {
	expect(isReplySafe("I'm an AI assistant")).toBe(false);
	expect(isReplySafe("I am a language model")).toBe(false);
	expect(isReplySafe("as an AI, I")).toBe(false);
	expect(isReplySafe("I'm powered by GPT")).toBe(false);
});

test("isReplySafe: passes clean content", () => {
	expect(isReplySafe("The context window matters for inference cost")).toBe(
		true,
	);
	expect(isReplySafe("Fine-tuning beats RAG in most low-data regimes")).toBe(
		true,
	);
});
