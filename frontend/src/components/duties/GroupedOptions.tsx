import type { PickerGroup } from '../../lib/duties';

/** Render picker groups as <optgroup>s (a group with no label renders flat). */
export function GroupedOptions({ groups }: { groups: PickerGroup[] }) {
  return (
    <>
      {groups.map((g, i) =>
        g.label ? (
          <optgroup key={`${g.label}-${i}`} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        ),
      )}
    </>
  );
}
