import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getUser, siteForUser } from '@/lib/auth';
import { createSiteTools } from '@/lib/agent/tools';
import { systemPrompt } from '@/lib/agent/system';

export const maxDuration = 300;

const openrouter = createOpenRouter();

const model = openrouter(process.env.SIGTIL_MODEL ?? 'anthropic/claude-sonnet-5', {
  // The agent loop re-sends a growing but byte-stable prefix (system prompt,
  // tool schemas, history, tool results) on every step, so almost all input
  // tokens are repeats. 1h TTL rather than the 5m default because editors chat
  // across minutes and would otherwise miss the cache between turns.
  cache_control: { type: 'ephemeral', ttl: '1h' },
  // Sonnet 5 defaults to `high`; content edits don't need that depth, and
  // output tokens cost 5x input.
  reasoning: { effort: 'medium' },
  usage: { include: true },
});

/**
 * Tell the agent which page the editor had open when they wrote, so "denne
 * side" resolves. Rebuilt from metadata on every request, so the history stays
 * byte-identical between turns and the prompt cache keeps hitting.
 */
function withPageNote(message: UIMessage): UIMessage {
  const page = (message.metadata as { page?: unknown } | undefined)?.page;
  if (message.role !== 'user' || typeof page !== 'string' || !page.startsWith('/')) return message;
  return { ...message, parts: [{ type: 'text', text: `[Brugeren ser på siden ${page.slice(0, 200)}]` }, ...message.parts] };
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { messages, siteId }: { messages: UIMessage[]; siteId: string } = await req.json();
  const site = await siteForUser(user, siteId);
  if (!site) return new Response('Forbidden', { status: 403 });

  const result = streamText({
    model,
    system: systemPrompt(site),
    messages: await convertToModelMessages(messages.map(withPageNote)),
    tools: createSiteTools(site),
    stopWhen: isStepCount(15),
    onFinish({ providerMetadata }) {
      const usage = providerMetadata?.openrouter?.usage as
        | { promptTokens?: number; promptTokensDetails?: { cachedTokens?: number }; completionTokens?: number; cost?: number }
        | undefined;
      if (!usage) return;
      const cached = usage.promptTokensDetails?.cachedTokens ?? 0;
      const prompt = usage.promptTokens ?? 0;
      console.log(
        `[chat] site=${site.id} prompt=${prompt} cached=${cached} (${prompt ? Math.round((cached / prompt) * 100) : 0}%) completion=${usage.completionTokens ?? 0} cost=$${(usage.cost ?? 0).toFixed(4)}`,
      );
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
