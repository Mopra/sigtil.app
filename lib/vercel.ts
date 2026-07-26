import type { Site } from './db';

const API = 'https://api.vercel.com';

export type DeploymentInfo = {
  state: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'NONE';
  url: string | null;
  commitSha: string | null;
  createdAt: number | null;
};

async function vercel(path: string, teamId?: string | null): Promise<any> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is not set');
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API}${path}${teamId ? `${sep}teamId=${teamId}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Vercel API ${res.status}`);
  return body;
}

/** Latest deployment for a git branch of the site's project. */
export async function latestDeploymentForBranch(site: Site, branch: string): Promise<DeploymentInfo> {
  const body = await vercel(
    `/v6/deployments?projectId=${site.vercelProjectId}&limit=1&meta-githubCommitRef=${encodeURIComponent(branch)}`,
    site.vercelTeamId,
  );
  const d = body.deployments?.[0];
  if (!d) return { state: 'NONE', url: null, commitSha: null, createdAt: null };
  return {
    state: d.readyState ?? d.state ?? 'NONE',
    url: d.url ? `https://${d.url}` : null,
    commitSha: d.meta?.githubCommitSha ?? null,
    createdAt: d.createdAt ?? null,
  };
}

/** Latest production deployment of the site's project. */
export async function latestProductionDeployment(site: Site): Promise<DeploymentInfo> {
  const body = await vercel(
    `/v6/deployments?projectId=${site.vercelProjectId}&limit=1&target=production`,
    site.vercelTeamId,
  );
  const d = body.deployments?.[0];
  if (!d) return { state: 'NONE', url: null, commitSha: null, createdAt: null };
  return {
    state: d.readyState ?? d.state ?? 'NONE',
    url: d.url ? `https://${d.url}` : null,
    commitSha: d.meta?.githubCommitSha ?? null,
    createdAt: d.createdAt ?? null,
  };
}

/**
 * Wait until a production deployment for the given commit sha is READY.
 * Resolves true when live, false on timeout or build error.
 */
export async function waitForProduction(
  site: Site,
  commitSha: string,
  { timeoutMs = 240_000, intervalMs = 5_000 } = {},
): Promise<{ live: boolean; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const prod = await latestProductionDeployment(site);
    if (prod.commitSha === commitSha) {
      if (prod.state === 'READY') return { live: true };
      if (prod.state === 'ERROR' || prod.state === 'CANCELED') {
        return { live: false, error: 'The update could not be built. Nothing was broken — the previous version is still live.' };
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { live: false, error: 'Timed out waiting for the update to go live.' };
}
