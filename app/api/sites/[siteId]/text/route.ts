import { getUser, workspaceForUser } from '@/lib/auth';
import { syncWorkBranch } from '@/lib/github';
import { replaceText } from '@/lib/inline-edit';

const MAX_TEXT = 2000;

/** Save a text the editor changed by clicking on it in the preview. */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { oldText, newText } = (await req.json().catch(() => ({}))) as { oldText?: unknown; newText?: unknown };
  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const from = oldText.trim();
  const to = newText.trim();
  if (!from || !to || from.length > MAX_TEXT || to.length > MAX_TEXT) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  if (from === to) return Response.json({ status: 'saved' });

  // Every edit must start from the latest version of the site, never an older one.
  await syncWorkBranch(site);

  return Response.json(await replaceText(site, from, to));
}
