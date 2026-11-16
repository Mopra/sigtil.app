import { put } from '@vercel/blob';
import { getUser, workspaceForUser } from '@/lib/auth';
import { writeFile } from '@/lib/github';
import { IMAGE_TYPES, saveImage, slugify } from '@/lib/images';

export const maxDuration = 120;

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const DOC_TYPES = ['application/pdf'];

// PDFs are committed into the repo as-is, so every upload lives in the git
// history forever. Cap them well below GitHub's Contents API ceiling: a menu
// card or price list is comfortably under this, a scanned brochure is not.
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const siteId = String(form.get('siteId') ?? '');
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No file' }, { status: 400 });

  const site = await workspaceForUser(user, siteId);
  if (!site) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const stamp = Date.now().toString(36);
  const slug = slugify(file.name);

  if (IMAGE_TYPES.includes(file.type)) {
    // Images: optimized and committed into the repo so they deploy with the site.
    const ref = await saveImage(site, file, slug => `sigtil: Tilføjede billedet ${slug}`);
    return Response.json({ kind: 'image', ref });
  }

  if (DOC_TYPES.includes(file.type)) {
    // PDFs: commit into the repo so they deploy with the site and survive
    // independently of Blob. Nothing to optimize — store the bytes as-is.
    if (file.size > MAX_DOC_BYTES) {
      return Response.json({ error: 'too-large', limitMb: MAX_DOC_BYTES / 1024 / 1024 }, { status: 413 });
    }
    const path = `public/uploads/${stamp}-${slug}.pdf`;
    await writeFile(site, path, Buffer.from(await file.arrayBuffer()), `sigtil: Tilføjede PDF'en ${slug}`);
    return Response.json({ kind: 'pdf', ref: `/uploads/${stamp}-${slug}.pdf` });
  }

  if (VIDEO_TYPES.includes(file.type)) {
    // Videos: too heavy for git — store in Blob and reference by URL.
    const blob = await put(`sigtil/${site.id}/${stamp}-${slug}`, file, {
      access: 'public',
      contentType: file.type,
    });
    return Response.json({ kind: 'video', ref: blob.url });
  }

  return Response.json({ error: 'unsupported' }, { status: 415 });
}
