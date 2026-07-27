import type { Role } from '@healthy-tasks/shared';

/**
 * The authenticated principal attached to a request by `requireAuth`.
 * Only the fields the app needs downstream — never the password hash.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
