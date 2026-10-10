import type { UIMessage } from 'ai';
import { and, eq } from 'drizzle-orm';
import { chats, db } from './db';
import { forStorage } from './chat';

const mine = (siteId: string, userId: string) => and(eq(chats.siteId, siteId), eq(chats.userId, userId));

/** This editor's conversation about this site, oldest first. */
export async function loadChat(siteId: string, userId: string): Promise<UIMessage[]> {
  const [row] = await db.select({ messages: chats.messages }).from(chats).where(mine(siteId, userId));
  return (row?.messages as UIMessage[] | undefined) ?? [];
}

export async function saveChat(siteId: string, userId: string, messages: UIMessage[]) {
  const kept = forStorage(messages);
  await db
    .insert(chats)
    .values({ siteId, userId, messages: kept })
    .onConflictDoUpdate({ target: [chats.siteId, chats.userId], set: { messages: kept, updatedAt: new Date() } });
}

export async function clearChat(siteId: string, userId: string) {
  await db.delete(chats).where(mine(siteId, userId));
}
