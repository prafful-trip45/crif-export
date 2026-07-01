/**
 * User store (D1). Accounts are provisioned (seeded or via the admin endpoint);
 * there is no self-signup. Passwords are stored as PBKDF2 hashes (see crypto.ts).
 */
import type { D1Database } from './env.js';
import { hashPassword } from './crypto.js';

export interface UserRow {
  user_id: string;
  username: string;
  company_id: string;
  password_hash: string;
  status: string; // 'active' | 'suspended'
  created_at: number;
}

export async function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT user_id, username, company_id, password_hash, status, created_at FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow>();
}

export async function findUserById(db: D1Database, userId: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT user_id, username, company_id, password_hash, status, created_at FROM users WHERE user_id = ?')
    .bind(userId)
    .first<UserRow>();
}

/** Insert a provisioned user (admin / seed path). Returns the generated user_id. */
export async function createUser(
  db: D1Database,
  input: { username: string; password: string; companyId: string; userId?: string },
): Promise<string> {
  const userId = input.userId ?? `usr-${crypto.randomUUID()}`;
  const hash = await hashPassword(input.password);
  await db
    .prepare(
      'INSERT INTO users (user_id, username, company_id, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(userId, input.username, input.companyId, hash, 'active', Math.floor(Date.now() / 1000))
    .run();
  return userId;
}
