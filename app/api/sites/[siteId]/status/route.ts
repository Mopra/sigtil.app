import { getUser, workspaceForUser } from '@/lib/auth';
import { syncWorkBranch, turnOf } from '@/lib/github';
import { latestDeploymentForBranch } from '@/lib/vercel';

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Sync first: the preview must never show an older version than the live site.
  // Without waiting: if a chat edit or another tab is syncing, report as is.
  const sync = await syncWorkBranch(site, { wait: false }).catch(() => null);
  if (!sync) return Response.json({ error: 'Unavailable' }, { status: 503 });
  const { pending } = sync;
  const pendingShas = new Set(pending.map(c => c.sha));
  const productionUrl = site.productionUrl.replace(/\/+$/, '');

  // Only builds of the unpublished changes are newer than the live site. Every
  // replayed change sits on top of it, so any of them is a safe fallback.
  const preview =
    pending.length > 0
      ? await latestDeploymentForBranch(site, site.workBranch, sha => sha != null && pendingShas.has(sha)).catch(() => null)
      : null;

  // The newest change did not build, so the preview is stuck on an older one.
  // The editor repairs it with the AI once, or takes the change out again.
  const head = pending[pending.length - 1];
  let failed = null;
  if (head && preview?.state === 'ERROR' && preview.commitSha === head.sha && preview.id) {
    const turn = pending.map(c => turnOf(c.message)).filter(t => t !== null).at(-1) ?? null;
    failed = {
      sha: head.sha,
      deploymentId: preview.id,
      turn: turn?.id ?? null,
      repaired: turn ? pending.some(c => { const t = turnOf(c.message); return t?.id === turn.id && t.repair; }) : false,
    };
  }

  return Response.json({
    pendingChanges: pending.length,
    preview: {
      state: preview?.state ?? 'READY',
      // Nothing unpublished: the live site IS the latest version, so show it.
      // Otherwise the newest finished build of the changes, or the live site
      // while the first one builds. Never a URL that is still building, since
      // it cannot be framed.
      url: preview?.readyUrl ?? (/^https?:\/\//.test(productionUrl) ? productionUrl : `https://${productionUrl}`),
      upToDate: pending.length === 0 || preview?.commitSha === head.sha,
      failed,
    },
    productionUrl: site.productionUrl,
  });
}
