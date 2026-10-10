import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getUser, workspaceForUser } from '@/lib/auth';
import { createSiteTools } from '@/lib/agent/tools';
import { syncWorkBranch, type Turn } from '@/lib/github';
import { repairPrompt, systemPrompt } from '@/lib/agent/system';
import { buildLog } from '@/lib/vercel';

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

/**
 * A repair request asks the AI to fix its own change that broke the preview.
 * The editor sees a short Danish note; the AI gets the instruction instead,
 * and on the turn itself the end of the build output.
 */
function withRepair(message: UIMessage, log: string | null): UIMessage {
  if (message.role !== 'user' || !(message.metadata as { repair?: unknown } | undefined)?.repair) return message;
  return { ...message, parts: [{ type: 'text', text: repairPrompt(log) }] };
}

const TURN_ID = /^[\w-]{1,64}$/;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const {
    messages,
    siteId,
    repair,
  }: { messages: UIMessage[]; siteId: string; repair?: { turn?: unknown; deploymentId?: unknown } } = await req.json();
  const site = await workspaceForUser(user, siteId);
  if (!site) return new Response('Forbidden', { status: 403 });

  // Every change this turn makes is marked with it. A repair continues the
  // turn it repairs, so a failed repair takes both out together.
  let turn: Turn = { id: crypto.randomUUID() };
  let log: string | null = null;
  if (repair) {
    if (typeof repair.turn !== 'string' || !TURN_ID.test(repair.turn) || typeof repair.deploymentId !== 'string') {
      return new Response('Bad request', { status: 400 });
    }
    turn = { id: repair.turn, repair: true };
    log = await buildLog(site, repair.deploymentId).catch(e => {
      console.error('[chat] build log', e);
      return null;
    });
  }
  const last = messages.length - 1;

  // Every edit must start from the latest version of the site, never an older one.
  await syncWorkBranch(site);

  const result = streamText({
    model,
    system: systemPrompt(site),
    messages: await convertToModelMessages(
      messages.map((m, i) => withPageNote(withRepair(m, i === last ? log : null))),
    ),
    tools: createSiteTools(site, turn),
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
