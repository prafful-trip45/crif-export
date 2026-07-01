/**
 * Seed / provision a user. Computes the PBKDF2 hash locally (WebCrypto, available in
 * Node 18+) and prints an INSERT you can run against D1 — no network needed.
 *
 *   npx tsx packages/auth-worker/src/seed.ts <username> <password> <companyId>
 *
 * Then apply it, e.g.:
 *   npx wrangler d1 execute crif-auth --local  --command "<printed SQL>"
 *   npx wrangler d1 execute crif-auth          --command "<printed SQL>"   # remote
 */
import { hashPassword } from './crypto.js';

const sqlQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const [username, password, companyId] = process.argv.slice(2);
  if (!username || !password || !companyId) {
    console.error('usage: tsx seed.ts <username> <password> <companyId>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('error: password must be at least 8 characters');
    process.exit(1);
  }
  const userId = `usr-${crypto.randomUUID()}`;
  const hash = await hashPassword(password);
  const createdAt = Math.floor(Date.now() / 1000);
  const sql =
    `INSERT INTO users (user_id, username, company_id, password_hash, status, created_at) VALUES (` +
    `${sqlQuote(userId)}, ${sqlQuote(username)}, ${sqlQuote(companyId)}, ${sqlQuote(hash)}, 'active', ${createdAt});`;

  console.log('\n-- user_id: ' + userId);
  console.log(sql);
  console.log('\n# apply locally:');
  console.log(`npx wrangler d1 execute crif-auth --local --command ${JSON.stringify(sql)}`);
  console.log('# apply remote:');
  console.log(`npx wrangler d1 execute crif-auth --command ${JSON.stringify(sql)}\n`);
}

void main();
