import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

/**
 * Render a screen with the providers it needs. Today that is only the router —
 * screens read `useNavigate` / `useLocation` and would throw without one — but
 * this is the single place to add more as they appear.
 *
 * `initialEntries` carries router state, which is how the Groups screen hands
 * a group id to the Alert Log.
 */
export function renderWithRouter(
  ui: ReactElement,
  initialEntries: (string | { pathname: string; state?: unknown })[] = ['/'],
): RenderResult {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}
