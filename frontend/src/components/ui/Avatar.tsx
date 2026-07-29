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

// Soft fill + deep text pairs, assigned deterministically per user id.
const AVATAR_PAIRS: Array<{ bg: string; fg: string }> = [
  { bg: 'var(--accent-soft)', fg: 'var(--accent-deep)' },
  { bg: 'var(--canvas-deep)', fg: 'var(--ink-3)' },
  { bg: 'var(--review-soft)', fg: 'var(--review-deep)' },
];

function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarPair(key: string): { bg: string; fg: string } {
  return AVATAR_PAIRS[hash(key) % AVATAR_PAIRS.length] ?? AVATAR_PAIRS[0]!;
}

/** Back-compat: returns just the fill color of the deterministic pair. */
export function avatarColor(key: string): string {
  return avatarPair(key).bg;
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
  px,
  decorative = false,
}: {
  user: UserLike;
  size?: Size;
  /** Explicit diameter in px (overrides `size`); font is ~36% of it. */
  px?: number;
  /** True when a visible name sits beside it (avatar becomes aria-hidden). */
  decorative?: boolean;
}) {
  const key = user.id || user.email || userLabel(user);
  const label = userLabel(user);
  const { bg, fg } = avatarPair(key);
  const style = px
    ? { background: bg, color: fg, width: px, height: px, fontSize: Math.round(px * 0.36) }
    : { background: bg, color: fg };
  return (
    <span
      className={px ? 'avatar' : sizeClass(size)}
      style={style}
      title={decorative ? undefined : label}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    >
      {userInitials(user)}
    </span>
  );
}

/** Placeholder avatar for an unassigned slot: neutral circle with "?". */
export function UnassignedAvatar({ size = 'md', px }: { size?: Size; px?: number }) {
  const style = px
    ? { background: 'var(--canvas-deep)', color: 'var(--faint)', width: px, height: px, fontSize: Math.round(px * 0.4) }
    : { background: 'var(--canvas-deep)', color: 'var(--faint)' };
  return (
    <span className={px ? 'avatar' : sizeClass(size)} style={style} aria-hidden="true">
      ?
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
