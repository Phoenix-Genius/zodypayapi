// Usage: npm run seed:admin -w apps/api -- admin@example.com 'a-long-password'
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDb, runMigrations } from '../db/index.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error('Usage: create-admin <email> <password (min 10 chars)>');
  process.exit(1);
}
const { db, close } = await createDb(loadConfig().DATABASE_URL);
await runMigrations(db);
const normalized = email.toLowerCase();
const [existing] = await db.select().from(users).where(eq(users.email, normalized));
if (existing) {
  await db.update(users).set({ role: 'ADMIN', passwordHash: await hashPassword(password) }).where(eq(users.id, existing.id));
  console.log(`Promoted ${normalized} to admin and reset password`);
} else {
  await db.insert(users).values({ id: newId('usr', 20), email: normalized, passwordHash: await hashPassword(password), role: 'ADMIN' });
  console.log(`Created admin ${normalized}`);
}
close();
