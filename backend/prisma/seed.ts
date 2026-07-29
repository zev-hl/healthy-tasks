/**
 * Seed script — creates the first Admin user so you can log in and manage
 * everyone else through the UI (there is no self-registration).
 *
 * Run with:  npm run db:seed   (from the repo root or the backend workspace)
 *
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env.
 * Re-running is safe: it updates the existing admin's password rather than
 * creating a duplicate.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@healthy-tasks.local').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    // Re-seeding resets the admin to a known state — including a canonical
    // name, so the account is never left without the now-required First/Last.
    update: {
      passwordHash,
      role: 'Admin',
      isActive: true,
      firstName: 'System',
      lastName: 'Administrator',
    },
    create: {
      email,
      passwordHash,
      role: 'Admin',
      firstName: 'System',
      lastName: 'Administrator',
      title: 'Administrator',
      isActive: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Seeded admin user: ${admin.email}`);
  // eslint-disable-next-line no-console
  console.log(`   Password: ${password}  (change this after first login)`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
