import sharp from 'sharp';
import type { Site } from './db';
import { writeFile } from './github';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

/** A file name as a short, plain part of a path. */
export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'fil'
  );
}

/**
 * Optimize an uploaded picture and save it into the site, so it deploys with
 * it. `message` gets the picture's short name. Returns the path the site
 * shows it at.
 */
export async function saveImage(site: Site, file: File, message: (slug: string) => string): Promise<string> {
  const slug = slugify(file.name);
  const name = `${Date.now().toString(36)}-${slug}.webp`;
  const optimized = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate() // respect EXIF orientation
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(site, `public/uploads/${name}`, optimized, message(slug));
  return `/uploads/${name}`;
}
