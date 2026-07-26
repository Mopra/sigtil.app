import { redirect } from 'next/navigation';
import { getUser, sitesForUser } from '@/lib/auth';
import Editor from '@/components/Editor';

export default async function EditPage({ params }: { params: Promise<{ siteId: string }> }) {
  const user = await getUser();
  if (!user) redirect('/sites');
  const { siteId } = await params;
  const sites = await sitesForUser(user);
  const site = sites.find(s => s.id === siteId);
  if (!site) redirect('/sites');

  return (
    <Editor
      siteId={site.id}
      siteName={site.name}
      productionUrl={site.productionUrl}
      // Nothing to go back to when the user only has this one site.
      showSitesLink={sites.length > 1 || user.role === 'admin'}
    />
  );
}
