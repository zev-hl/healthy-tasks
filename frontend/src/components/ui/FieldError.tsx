/**
 * Inline form errors in the app's own look, in place of the browser's
 * validation bubbles (forms that use these set `noValidate`). A form checks its
 * fields when it is sent, shows each problem under its field, and the message
 * goes as soon as the field is fixed.
 */

/** The message under a field; its `id` is the field's `aria-describedby`. */
export function FieldError({ id, children }: { id: string; children?: string | null }) {
  if (!children) return null;
  return (
    <span className="hb-field-error" id={id}>
      {children}
    </span>
  );
}

/** Props that tie a field to its message (and mark it red) while it has one. */
export function invalidProps(id: string, problem: string | null | undefined) {
  return problem ? { 'aria-invalid': true as const, 'aria-describedby': id } : {};
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with a typed email address, if anything. */
export function emailProblem(value: string, empty = 'Enter your email'): string | null {
  const v = value.trim();
  if (!v) return empty;
  if (!EMAIL.test(v)) return 'That doesn’t look like an email address';
  return null;
}

/**
 * Focus the first field with a problem; `problems` maps each field's element
 * id to its message (in the form's order). Says whether there was one.
 */
export function focusFirstProblem(problems: Record<string, string | null>): boolean {
  const first = Object.keys(problems).find((id) => problems[id]);
  if (first) document.getElementById(first)?.focus();
  return !!first;
}
