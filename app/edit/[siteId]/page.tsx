import { redirect } from 'next/navigation';
import { getUser, siteForUser } from '@/lib/auth';
import Editor from '@/components/Editor';

export default async function EditPage({ params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) redirect('/sites');
  const { siteId } = await params;
  const site = await siteForUser(user, siteId);
  if (!site) redirect('/sites');

  return <Editor siteId={site.id} siteName={site.name} productionUrl={site.productionUrl} />;
}
