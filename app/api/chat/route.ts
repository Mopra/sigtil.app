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

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { messages, siteId }: { messages: UIMessage[]; siteId: string } = await req.json();
  const site = await siteForUser(user, siteId);
  if (!site) return new Response('Forbidden', { status: 403 });

  const result = streamText({
    model: openrouter(process.env.SIGTIL_MODEL ?? 'anthropic/claude-sonnet-5'),
    system: systemPrompt(site),
    messages: await convertToModelMessages(messages),
    tools: createSiteTools(site),
    stopWhen: isStepCount(15),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
