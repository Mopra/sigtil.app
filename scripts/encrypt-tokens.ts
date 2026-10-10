// One-off: encrypt every plaintext sites.github_token in place. Safe to re-run.
// node --env-file=.env.local --experimental-strip-types scripts/encrypt-tokens.ts
import postgres from 'postgres';
import { encryptSecret, isEncrypted } from '../lib/db/crypto.ts';

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const rows = await client<{ id: string; github_token: string }[]>`select id, github_token from sites`;
let done = 0;
for (const row of rows) {
  if (isEncrypted(row.github_token)) continue;
  await client`update sites set github_token = ${encryptSecret(row.github_token)} where id = ${row.id}`;
  done++;
}
console.log(`Encrypted ${done} of ${rows.length} tokens.`);
await client.end();
