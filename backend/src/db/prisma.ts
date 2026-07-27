import { PrismaClient } from '@prisma/client';

// A single PrismaClient instance is shared across the app. During dev with
// hot-reload (tsx watch) we cache it on globalThis to avoid exhausting the
// connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
