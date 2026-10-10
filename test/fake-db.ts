/**
 * Stands in for lib/db in tests. Only what lib/github.ts uses: transactions
 * holding Postgres advisory locks, kept here as one in-process mutex per key.
 */
const held = new Map<string, Promise<void>>();

/** Forget locks left held by a test that failed half way. */
export function resetLocks() {
  held.clear();
}

function lockKey(query: any): string {
  const key = (query?.queryChunks ?? []).find((c: unknown) => typeof c === 'string');
  if (!key) throw new Error('fake db: no lock key in query');
  return key;
}

export const db = {
  async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const mine: Array<() => void> = [];
    const tx = {
      async execute(query: any) {
        const text = (query?.queryChunks ?? []).map((c: any) => c?.value?.join?.('') ?? '').join('');
        if (text.includes('lock_timeout')) return [];
        const key = lockKey(query);
        if (text.includes('pg_try_advisory_xact_lock')) {
          if (held.has(key)) return [{ ok: false }];
        } else {
          while (held.has(key)) await held.get(key);
        }
        let release!: () => void;
        held.set(key, new Promise<void>(r => (release = r)));
        mine.push(() => {
          held.delete(key);
          release();
        });
        return [{ ok: true }];
      },
    };
    try {
      return await fn(tx);
    } finally {
      for (const release of mine) release();
    }
  },
};
