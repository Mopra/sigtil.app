import { getUser, siteForUser } from '@/lib/auth';
import { listFiles } from '@/lib/github';
import { pagesFromFiles } from '@/lib/pages';

/** Pages that exist on the editing branch, for the preview's page picker. */
export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await siteForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const pages = pagesFromFiles(await listFiles(site))
    // A URL with a placeholder can't be opened in the preview.
    .filter(p => !p.dynamic)
    .map(({ route, label }) => ({ route, label }));

  return Response.json({ pages });
}
