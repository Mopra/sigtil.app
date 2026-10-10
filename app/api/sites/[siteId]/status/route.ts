import { getUser, siteForUser } from '@/lib/auth';
import { syncWorkBranch } from '@/lib/github';
import { latestDeploymentForBranch } from '@/lib/vercel';

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await siteForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Sync first: the preview must never show an older version than the live site.
  const sync = await syncWorkBranch(site).catch(() => null);
  if (!sync) return Response.json({ error: 'Unavailable' }, { status: 503 });
  const { pending, conflict } = sync;
  const pendingShas = new Set(pending.map(c => c.sha));
  const productionUrl = site.productionUrl.replace(/\/+$/, '');

  // Only builds of the unpublished changes are newer than the live site. Every
  // replayed change sits on top of it, so any of them is a safe fallback.
  const preview =
    pending.length > 0
      ? await latestDeploymentForBranch(site, site.workBranch, sha => sha != null && pendingShas.has(sha)).catch(() => null)
      : null;

  return Response.json({
    pendingChanges: pending.length,
    conflict,
    preview: {
      state: preview?.state ?? 'READY',
      // Nothing unpublished: the live site IS the latest version, so show it.
      // Otherwise the newest finished build of the changes, or the live site
      // while the first one builds. Never a URL that is still building, since
      // it cannot be framed.
      url: preview?.readyUrl ?? (/^https?:\/\//.test(productionUrl) ? productionUrl : `https://${productionUrl}`),
      upToDate: pending.length === 0 || preview?.commitSha === pending[pending.length - 1].sha,
    },
    productionUrl: site.productionUrl,
  });
}
