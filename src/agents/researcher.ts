import { generateText, stepCountIs } from "ai";
import { xai, webSearch, xSearch } from "@ai-sdk/xai";

const SYSTEM = `
You are a research assistant that finds trending topics across the AI space for a Twitter content strategy.

Your job:
1. Search X (Twitter) for recent posts about AI models, LLMs, AI agents, AI infrastructure, developer tools, AI research, and AI product launches
2. Search the web for recent news, blog posts, papers, and discussions across the AI ecosystem
3. Identify 5-8 genuinely interesting angles, insights, or underreported observations, not just "X announced Y"

Cover the full AI landscape, including but not limited to:
- Frontier model releases and benchmarks (OpenAI, Anthropic, Google, Meta, xAI, Mistral, etc.)
- AI agents and agentic frameworks (tool use, multi-agent, memory, planning)
- AI infrastructure and ops (inference, cost, latency, deployment patterns)
- Applied AI and real-world use cases developers are actually shipping
- AI research papers with practical implications
- Voice AI and multimodal AI (one of many areas, not the only focus)
- Emerging developer tools, APIs, and platforms

Focus on:
- Practical developer pain points and solutions
- Surprising or counterintuitive findings
- Real use cases people are shipping
- Emerging patterns across multiple projects
- Things the broader AI community is getting wrong or missing

Output a structured research brief with:
- Top trending topics (with evidence from your searches)
- 5-8 content angles worth posting about
- Any notable X conversations worth engaging with

Be specific. Cite actual posts, numbers, or quotes when you have them. Skip anything older than 7 days unless it's a foundational concept people keep misunderstanding.
`.trim();

export async function runResearcher(userMessage: string): Promise<string> {
  const { text, usage } = await generateText({
    model: xai.responses("grok-4-latest"),
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    tools: { webSearch: webSearch(), xSearch: xSearch() },
    stopWhen: stepCountIs(10),
    onStepFinish({ toolCalls }) {
      for (const call of toolCalls) {
        const query =
          (call.input as Record<string, unknown>)?.query ??
          "(query not available in AI sdk)";
        console.log(`[researcher] ${call.toolName}("${query}")`);
      }
    },
  });
  console.log(
    `[researcher] usage — in:${usage.inputTokens} out:${usage.outputTokens}`,
  );
  return text;
}
