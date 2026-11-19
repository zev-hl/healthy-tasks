/** A person's name for messages: first and last name, else their email. */
export function userDisplayName(u: {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}): string {
  const name = [u.firstName, u.lastName]
    .filter((x) => x && x.trim())
    .join(' ')
    .trim();
  return name || u.email;
}
