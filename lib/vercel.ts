import type { Site } from './db';

const API = 'https://api.vercel.com';

export type DeploymentInfo = {
  id: string | null;
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

/**
 * Latest deployment for a git branch of the site's project, plus `readyUrl`:
 * the newest one that finished building from a commit `accept` allows. While a
 * build is queued or running its own URL serves a Vercel system page that
 * refuses to be framed, so the preview has to keep pointing at the last good
 * build until the new one lands. `accept` keeps that fallback from reaching
 * back to a build older than the live site.
 */
export async function latestDeploymentForBranch(
  site: Site,
  branch: string,
  accept: (commitSha: string | null) => boolean = () => true,
): Promise<DeploymentInfo & { readyUrl: string | null }> {
  const body = await vercel(
    `/v6/deployments?projectId=${site.vercelProjectId}&limit=10&meta-githubCommitRef=${encodeURIComponent(branch)}`,
    site.vercelTeamId,
  );
  const deployments: any[] = body.deployments ?? [];
  const d = deployments[0];
  if (!d) return { id: null, state: 'NONE', url: null, readyUrl: null, commitSha: null, createdAt: null };
  const ready = deployments.find(
    x => (x.readyState ?? x.state) === 'READY' && accept(x.meta?.githubCommitSha ?? null),
  );
  return {
    id: d.uid ?? null,
    state: d.readyState ?? d.state ?? 'NONE',
    url: d.url ? `https://${d.url}` : null,
    readyUrl: ready?.url ? `https://${ready.url}` : null,
    commitSha: d.meta?.githubCommitSha ?? null,
    createdAt: d.createdAt ?? null,
  };
}

const LOG_LINES = 120;
const LOG_CHARS = 12_000;

/**
 * The end of a failed build's output, where the error is. Only for a
 * deployment of the site's own project, since it ends up in front of the AI.
 */
export async function buildLog(site: Site, deploymentId: string): Promise<string> {
  const id = encodeURIComponent(deploymentId);
  const deployment = await vercel(`/v13/deployments/${id}`, site.vercelTeamId);
  if (deployment.projectId !== site.vercelProjectId) throw new Error('Deployment belongs to another project');
  const events: any[] = await vercel(`/v3/deployments/${id}/events?builds=1&limit=-1`, site.vercelTeamId);
  const lines = (Array.isArray(events) ? events : [])
    .filter(e => e.type === 'stdout' || e.type === 'stderr' || e.type === 'command')
    .flatMap(e => String(e.payload?.text ?? e.text ?? '').split('\n'))
    .map(l => l.trimEnd())
    .filter(Boolean);
  const tail = lines.slice(-LOG_LINES).join('\n');
  return tail.length > LOG_CHARS ? tail.slice(-LOG_CHARS) : tail;
}

/** Latest production deployment of the site's project. */
export async function latestProductionDeployment(site: Site): Promise<DeploymentInfo> {
  const body = await vercel(
    `/v6/deployments?projectId=${site.vercelProjectId}&limit=1&target=production`,
    site.vercelTeamId,
  );
  const d = body.deployments?.[0];
  if (!d) return { id: null, state: 'NONE', url: null, commitSha: null, createdAt: null };
  return {
    id: d.uid ?? null,
    state: d.readyState ?? d.state ?? 'NONE',
    url: d.url ? `https://${d.url}` : null,
    commitSha: d.meta?.githubCommitSha ?? null,
    createdAt: d.createdAt ?? null,
  };
}

/**
 * Wait until a production deployment for the given commit sha is READY, or a
 * later one that `includes` it. Resolves true when live, false on timeout or
 * build error.
 */
export async function waitForProduction(
  site: Site,
  commitSha: string,
  {
    timeoutMs = 240_000,
    intervalMs = 5_000,
    includes = async (_sha: string) => false,
  }: { timeoutMs?: number; intervalMs?: number; includes?: (sha: string) => Promise<boolean> } = {},
): Promise<{ live: boolean; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const prod = await latestProductionDeployment(site);
    if (prod.commitSha === commitSha) {
      if (prod.state === 'READY') return { live: true };
      if (prod.state === 'ERROR' || prod.state === 'CANCELED') {
        return { live: false, error: 'The update could not be built. Nothing was broken. The previous version is still live.' };
      }
    } else if (prod.state === 'READY' && prod.commitSha && (await includes(prod.commitSha))) {
      return { live: true };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { live: false, error: 'Timed out waiting for the update to go live.' };
}
