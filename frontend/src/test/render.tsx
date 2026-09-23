import { render, type RenderResult } from '@testing-library/react';
import {
  MemoryRouter,
  RouterProvider,
  createMemoryRouter,
  type RouteObject,
} from 'react-router-dom';
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

/**
 * The same, but on a data router. Anything using `useBlocker` — the
 * unsaved-changes guard, so the group editor — throws without one, because
 * the app itself runs on `createBrowserRouter`.
 */
export function renderWithDataRouter(
  ui: ReactElement,
  {
    path = '/',
    initialEntries = ['/'],
    extraRoutes = [],
  }: {
    path?: string | string[];
    initialEntries?: string[];
    /** Somewhere for the screen to navigate to, so a redirect is assertable. */
    extraRoutes?: RouteObject[];
  } = {},
): RenderResult {
  // Several paths may share one screen — the editor is both /new and /:id/edit
  // — and a screen that navigates between them needs both registered.
  const paths = Array.isArray(path) ? path : [path];
  const router = createMemoryRouter(
    [...paths.map((p) => ({ path: p, element: ui })), ...extraRoutes],
    { initialEntries },
  );
  return render(<RouterProvider router={router} />);
}
