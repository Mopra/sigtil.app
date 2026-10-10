import { getUser, workspaceForUser } from '@/lib/auth';
import { resetWorkBranch, undoLastCommit } from '@/lib/github';

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { all }: { all?: boolean } = await req.json().catch(() => ({}));

  if (all) {
    await resetWorkBranch(site);
    return Response.json({ undone: true });
  }
  const undone = await undoLastCommit(site);
  return Response.json({ undone });
}
