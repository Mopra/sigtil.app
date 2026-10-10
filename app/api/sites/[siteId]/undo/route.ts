import { getUser, workspaceForUser } from '@/lib/auth';
import { dropChange, dropTurn, resetWorkBranch, undoLastCommit } from '@/lib/github';

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const {
    all,
    failed,
    change,
  }: { all?: boolean; failed?: { sha?: unknown; turn?: unknown }; change?: { shas?: unknown; head?: unknown } } = await req
    .json()
    .catch(() => ({}));

  // One item of the what-changed list, as it was shown at `head`.
  if (change) {
    const { shas, head } = change;
    if (typeof head !== 'string' || !Array.isArray(shas) || !shas.length || !shas.every(s => typeof s === 'string')) {
      return Response.json({ error: 'Bad request' }, { status: 400 });
    }
    return Response.json({ undone: await dropChange(site, shas, head) });
  }

  // A change that broke the preview and could not be repaired.
  if (failed) {
    if (typeof failed.sha !== 'string' || (failed.turn !== null && typeof failed.turn !== 'string')) {
      return Response.json({ error: 'Bad request' }, { status: 400 });
    }
    return Response.json({ undone: await dropTurn(site, failed.turn, failed.sha) });
  }

  if (all) {
    await resetWorkBranch(site);
    return Response.json({ undone: true });
  }
  const undone = await undoLastCommit(site);
  return Response.json({ undone });
}
