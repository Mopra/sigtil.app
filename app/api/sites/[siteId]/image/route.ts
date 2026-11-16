import { getUser, workspaceForUser } from '@/lib/auth';
import { syncWorkBranch, withTurn } from '@/lib/github';
import { IMAGE_TYPES, saveImage } from '@/lib/images';
import { isSitePath, replaceImage } from '@/lib/inline-edit';

export const maxDuration = 120;

/**
 * Replace a picture the editor pointed at in the preview with one they picked.
 * `src` is the path the page shows the old picture at. The new picture is
 * always saved; `status` tells whether it was also put in place, or whether
 * the AI has to do that (`ref` is where the new picture is).
 */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { siteId } = await params;
  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const src = String(form?.get('src') ?? '');
  if (!(file instanceof File)) return Response.json({ error: 'No file' }, { status: 400 });
  if (!IMAGE_TYPES.includes(file.type)) return Response.json({ error: 'unsupported' }, { status: 415 });

  // Every edit must start from the latest version of the site, never an older one.
  await syncWorkBranch(site);

  // The new picture and its placing are one change to the editor: shown as
  // one line before Udgiv, and taken out together.
  const turn = { id: crypto.randomUUID() };
  const ref = await saveImage(site, file, slug => withTurn(`sigtil: Tilføjede billedet ${slug}`, turn));
  if (!isSitePath(src)) return Response.json({ status: 'unclear', ref });

  const result = await replaceImage(site, src, ref, withTurn('sigtil: Skiftede et billede på siden', turn));
  return Response.json({ status: result.status, ref });
}
