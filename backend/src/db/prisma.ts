import { Prisma, PrismaClient } from '@prisma/client';

// A single PrismaClient instance is shared across the app. During dev with
// hot-reload (tsx watch) we cache it on globalThis to avoid exhausting the
// connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prismaBase?: PrismaClient };

/**
 * The plain client, which still sees soft-deleted tasks. Use it ONLY where a
 * deleted task must be reachable: deleting, the Admin's deleted-tasks list and
 * restoring. Everything else uses `prisma` below.
 */
export const prismaWithDeleted =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaBase = prismaWithDeleted;
}

/** Task read operations that take a `where` the soft-delete filter can join. */
const TASK_FILTERED_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
]);

/**
 * The app's client. A soft-deleted task (Task.deletedAt set) is invisible to
 * every task read here, as if it no longer existed: the filter is added to the
 * top-level `where` of each Task query. Nested relation reads (e.g. a comment's
 * task) are not filtered; the code paths that reach a task that way already
 * check access through a filtered query first. Raw SQL that reads "Task" must
 * add `"deletedAt" IS NULL` itself.
 */
function withSoftDelete(base: PrismaClient) {
  return base.$extends({
    name: 'taskSoftDelete',
    query: {
      task: {
        async $allOperations({ operation, args, query }) {
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            // findUnique needs its unique field at the top level, so the filter
            // goes beside it rather than around it.
            const a = args as { where: Prisma.TaskWhereUniqueInput };
            a.where = { ...a.where, deletedAt: null };
          } else if (TASK_FILTERED_OPS.has(operation)) {
            const a = args as { where?: Prisma.TaskWhereInput };
            a.where = a.where ? { AND: [a.where, { deletedAt: null }] } : { deletedAt: null };
          }
          return query(args);
        },
      },
    },
  });
}

export const prisma = withSoftDelete(prismaWithDeleted) as unknown as PrismaClient;
