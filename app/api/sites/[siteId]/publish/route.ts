import { getUser, siteForUser } from '@/lib/auth';
import { mergeWorkIntoDefault, resetWorkBranch, syncWorkBranch } from '@/lib/github';
import { waitForProduction } from '@/lib/vercel';

// Publishing blocks until the production deployment is verified live.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await siteForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Publish exactly what the preview showed: the changes on top of the live site.
  const { pending, conflict } = await syncWorkBranch(site);
  if (conflict) return Response.json({ live: false, conflict: true }, { status: 409 });
  if (pending.length === 0) return Response.json({ live: true, alreadyPublished: true });

  let mergeSha: string | null;
  try {
    mergeSha = await mergeWorkIntoDefault(site);
  } catch (e) {
    return Response.json({ live: false, error: e instanceof Error ? e.message : 'Merge failed' }, { status: 500 });
  }

  if (!mergeSha) return Response.json({ live: true, alreadyPublished: true });

  const result = await waitForProduction(site, mergeSha);
  if (result.live) {
    // Fresh start for the next round of edits.
    await resetWorkBranch(site).catch(() => {});
    return Response.json({ live: true });
  }
  return Response.json({ live: false, error: result.error }, { status: 502 });
}
