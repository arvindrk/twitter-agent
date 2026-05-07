export function sanitizeUntrusted(s: string): string {
	return s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/<\/?untrusted>/gi, "");
}

export const AI_DISCLOSURE_PATTERNS: RegExp[] = [
	/\bI(?:'m| am| was| have been| being)\s+(?:an?\s+)?(?:AI|bot|chatbot|language model|automated|assistant|LLM|machine|AGI)\b/i,
	/\bI(?:'m| am)\s+(?:powered by|built (?:on|with)|running on|trained by)\b/i,
	/\bas an?\s+(?:AI|language model|chatbot|machine learning|automated)\b/i,
];

export function isReplySafe(content: string): boolean {
	return !AI_DISCLOSURE_PATTERNS.some((p) => p.test(content));
}
