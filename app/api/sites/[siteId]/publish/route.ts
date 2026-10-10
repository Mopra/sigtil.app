import { getUser, workspaceForUser } from '@/lib/auth';
import { containsCommit, publishWork, syncWorkBranch } from '@/lib/github';
import { waitForProduction } from '@/lib/vercel';

// Publishing blocks until the production deployment is verified live.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Publish exactly what the preview showed: the changes on top of the live site.
  let mergeSha: string | null;
  try {
    mergeSha = await publishWork(site);
  } catch (e) {
    return Response.json({ live: false, error: e instanceof Error ? e.message : 'Merge failed' }, { status: 500 });
  }

  if (!mergeSha) return Response.json({ live: true, alreadyPublished: true });

  // Someone else may publish (or a developer push) right after: a production
  // build that already contains this one counts as live too.
  const result = await waitForProduction(site, mergeSha, { includes: sha => containsCommit(site, sha, mergeSha) });
  if (result.live) {
    // Catch up with the live site. Not a reset: edits made while this was
    // publishing stay, as the next changes to publish.
    await syncWorkBranch(site).catch(() => {});
    return Response.json({ live: true });
  }
  return Response.json({ live: false, error: result.error }, { status: 502 });
}
