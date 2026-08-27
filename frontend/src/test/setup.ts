import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount anything a test rendered, so a provider's timers and event listeners
// do not leak into the next test.
afterEach(() => {
  cleanup();
});
