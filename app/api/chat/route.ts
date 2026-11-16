import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getUser, workspaceForUser } from '@/lib/auth';
import { createSiteTools } from '@/lib/agent/tools';
import { HAND_OVER, modelForStep } from '@/lib/agent/route-model';
import { syncWorkBranch, type Turn } from '@/lib/github';
import { repairPrompt, systemPrompt } from '@/lib/agent/system';
import { buildLog } from '@/lib/vercel';
import { forModel, textOnly } from '@/lib/chat';
import { clearChat, loadChat, saveChat } from '@/lib/chat-store';
import { isUsedUp } from '@/lib/budget';
import { addSpend, budgetOf } from '@/lib/budget-store';

export const maxDuration = 300;

const openrouter = createOpenRouter();

// The agent loop re-sends a growing but byte-stable prefix (system prompt,
// tool schemas, history, tool results) on every step, so almost all input
// tokens are repeats. 1h TTL rather than the 5m default because editors chat
// across minutes and would otherwise miss the cache between turns.
const shared = { cache_control: { type: 'ephemeral', ttl: '1h' }, usage: { include: true } } as const;

// Two models, chosen step by step in modelForStep. The fast one costs about a
// twentieth of the strong one and does the everyday content changes.
const models = {
  fast: openrouter(process.env.SIGTIL_MODEL_FAST ?? 'anthropic/claude-haiku-5.5', {
    ...shared,
    // No thinking: a turn can change model halfway, and thinking written by
    // one model must not be replayed to the other.
    reasoning: { effort: 'none' },
  }),
  strong: openrouter(process.env.SIGTIL_MODEL ?? 'anthropic/claude-sonnet-5', {
    ...shared,
    // Sonnet 5 defaults to `high`; content edits don't need that depth, and
    // output tokens cost 5x input.
    reasoning: { effort: 'medium' },
  }),
};

type OpenRouterUsage = {
  promptTokens?: number;
  promptTokensDetails?: { cachedTokens?: number };
  completionTokens?: number;
  cost?: number;
};

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

// What the editor's browser is told when the chat cannot answer, so it can
// say why in plain words. Never the error itself, which may hold internals.
const BUDGET_USED = 'sigtil:budget';
const AI_UNAVAILABLE = 'sigtil:unavailable';

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const {
    message,
    siteId,
    repair,
  }: { message: UIMessage; siteId: string; repair?: { turn?: unknown; deploymentId?: unknown } } = await req.json();
  const site = await workspaceForUser(user, siteId);
  if (!site) return new Response('Forbidden', { status: 403 });
  if (message?.role !== 'user' || !Array.isArray(message.parts) || typeof message.id !== 'string') {
    return new Response('Bad request', { status: 400 });
  }
  // The budget is spent. A repair still runs: it mends a change the
  // editor already paid for, and costs far less than leaving the site broken.
  if (!repair && isUsedUp(await budgetOf(site))) return new Response(BUDGET_USED, { status: 402 });

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
  const tools = createSiteTools(site, turn);
  // The SDK's types reject typed tools here, though it only reads their schemas.
  const schemas = tools as unknown as Parameters<typeof validateUIMessages>[0]['tools'];

  // The saved conversation is the history; the browser only sends the new
  // message. Sending the same message again (a retry) replaces it.
  let messages = (await loadChat(site.id, user.id)).filter(m => m.id !== message.id);
  messages = [...messages, message];
  try {
    messages = await validateUIMessages({ messages, tools: schemas });
  } catch (e) {
    // History saved by an older version whose tool calls no longer fit: keep
    // what was said, drop what was done.
    console.error('[chat] stored history', e);
    messages = await validateUIMessages({ messages: textOnly(messages), tools: schemas }).catch(() => [message]);
  }
  const sent = forModel(messages);
  const last = sent.length - 1;

  // Every edit must start from the latest version of the site, never an older one.
  await syncWorkBranch(site);

  // Once the strong model has the turn there is nobody left to hand over to.
  const withoutHandOver = (Object.keys(tools) as Array<keyof typeof tools>).filter(name => name !== HAND_OVER);

  // Which model ran each step. The steps themselves all name the model the
  // turn started on, also after a hand-over.
  const ran: Array<'fast' | 'strong'> = [];

  const result = streamText({
    model: models[modelForStep([], !!repair)],
    system: systemPrompt(site),
    messages: await convertToModelMessages(
      sent.map((m, i) => withPageNote(withRepair(m, i === last ? log : null))),
    ),
    tools,
    stopWhen: isStepCount(15),
    prepareStep({ steps }) {
      const which = modelForStep(steps, !!repair);
      ran.push(which);
      return which === 'strong' ? { model: models.strong, activeTools: withoutHandOver } : { model: models.fast };
    },
    onFinish({ steps }) {
      // Each step is its own request with its own bill, so add them up.
      let prompt = 0;
      let cached = 0;
      let completion = 0;
      let cost = 0;
      for (const step of steps) {
        const usage = step.providerMetadata?.openrouter?.usage as OpenRouterUsage | undefined;
        prompt += usage?.promptTokens ?? 0;
        cached += usage?.promptTokensDetails?.cachedTokens ?? 0;
        completion += usage?.completionTokens ?? 0;
        cost += usage?.cost ?? 0;
      }
      // In the order they ran: "fast,strong" for a turn handed over.
      const which = [...new Set(ran)].join(',');
      addSpend(site.id, cost).catch(e => console.error('[chat] spend', e));
      console.log(
        `[chat] site=${site.id} models=${which} steps=${steps.length} prompt=${prompt} cached=${cached} (${prompt ? Math.round((cached / prompt) * 100) : 0}%) completion=${completion} cost=$${cost.toFixed(4)}`,
      );
    },
  });

  // Finish the turn, and save it, even if the editor closes the tab mid-answer.
  void result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
      // The provider is out of credits or down: nothing the editor can retry away.
      onError: e => {
        console.error('[chat] stream', e);
        const status = (e as { statusCode?: number } | null)?.statusCode;
        return status === 402 || status === 401 || status === 403 ? AI_UNAVAILABLE : 'error';
      },
      onEnd: ({ messages }) =>
        saveChat(site.id, user.id, messages).catch(e => console.error('[chat] save', e)),
    }),
  });
}

/** "Start forfra": forget this editor's conversation about the site. */
export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const siteId = new URL(req.url).searchParams.get('siteId') ?? '';
  const site = await workspaceForUser(user, siteId);
  if (!site) return new Response('Forbidden', { status: 403 });
  await clearChat(site.id, user.id);
  return new Response(null, { status: 204 });
}
