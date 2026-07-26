import { getUser, siteForUser } from '@/lib/auth';
import { unpublishedCommits } from '@/lib/github';
import { latestDeploymentForBranch } from '@/lib/vercel';

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await siteForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const [pending, preview] = await Promise.all([
    unpublishedCommits(site).catch(() => []),
    latestDeploymentForBranch(site, site.workBranch).catch(() => null),
  ]);

  return Response.json({
    pendingChanges: pending.length,
    preview: preview
      ? {
          state: preview.state,
          url: preview.url,
          // Preview is only current when it was built from the branch tip
          upToDate: pending.length === 0 || preview.commitSha === pending[pending.length - 1]?.sha,
        }
      : null,
    productionUrl: site.productionUrl,
  });
}
