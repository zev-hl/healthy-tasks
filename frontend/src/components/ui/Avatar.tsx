/**
 * Avatar + UserChip — Phase 9 visual design.
 *
 * A user is shown as a small colored circle with initials wherever they appear
 * (assignee, creator, comment author, history actor, uploader, notification
 * sender, self in the header, etc.).
 *
 * Constraint: most in-app user references use `TaskUserRef` which carries only
 * `id, email, title` — no name fields. So initials fall back gracefully:
 * real 2-letter initials when firstName/lastName are known (Users, Profile,
 * self), otherwise derived from the email local-part. The background color is a
 * deterministic hash of a stable key (id → email → label) so the same person is
 * always the same color.
 */

export interface UserLike {
  id?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  title?: string | null;
}

// Curated palette: saturated-but-not-neon, all legible with white text.
const AVATAR_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#ef4444', // red
  '#f97316', // orange
  '#d97706', // amber
  '#ca8a04', // yellow-dark
  '#16a34a', // green
  '#059669', // emerald
  '#0d9488', // teal
  '#0891b2', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#64748b', // slate
];

export function avatarColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#64748b';
}

export function userInitials(u: UserLike): string {
  const fn = u.firstName?.trim();
  const ln = u.lastName?.trim();
  if (fn || ln) {
    return ((fn?.[0] ?? '') + (ln?.[0] ?? '')).toUpperCase() || '?';
  }
  const name = u.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
  }
  const email = u.email?.trim();
  if (email) {
    const local = email.split('@')[0] ?? email;
    const segs = local.split(/[.\-_+]/).filter(Boolean);
    if (segs.length >= 2) {
      return ((segs[0]?.[0] ?? '') + (segs[1]?.[0] ?? '')).toUpperCase() || '?';
    }
    return local.slice(0, 2).toUpperCase() || '?';
  }
  return '?';
}

export function userLabel(u: UserLike): string {
  const fn = u.firstName?.trim();
  const ln = u.lastName?.trim();
  if (fn || ln) return [fn, ln].filter(Boolean).join(' ');
  if (u.name?.trim()) return u.name.trim();
  return u.email ?? 'Unknown user';
}

type Size = 'xs' | 'md' | 'lg';

function sizeClass(size: Size): string {
  if (size === 'xs') return 'avatar avatar-xs';
  if (size === 'lg') return 'avatar avatar-lg';
  return 'avatar';
}

export function Avatar({
  user,
  size = 'md',
  decorative = false,
}: {
  user: UserLike;
  size?: Size;
  /** True when a visible name sits beside it (avatar becomes aria-hidden). */
  decorative?: boolean;
}) {
  const key = user.id || user.email || userLabel(user);
  const label = userLabel(user);
  return (
    <span
      className={sizeClass(size)}
      style={{ background: avatarColor(key) }}
      title={decorative ? undefined : label}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    >
      {userInitials(user)}
    </span>
  );
}

/**
 * Avatar + name, inline. Use `label` to override the displayed text (e.g. show
 * the raw email even when a title exists), and `title` to append the job title.
 */
export function UserChip({
  user,
  size = 'xs',
  label,
  muted = false,
  showTitle = false,
}: {
  user: UserLike;
  size?: Size;
  label?: string;
  muted?: boolean;
  showTitle?: boolean;
}) {
  const text = label ?? userLabel(user);
  return (
    <span className={`user-chip${muted ? ' muted' : ''}`}>
      <Avatar user={user} size={size} decorative />
      <span className="user-name">
        {text}
        {showTitle && user.title ? <span className="muted"> · {user.title}</span> : null}
      </span>
    </span>
  );
}
