import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount anything a test rendered, so a provider's timers and event listeners
// do not leak into the next test.
afterEach(() => {
  cleanup();
});

// A data router builds a `Request` with an AbortSignal on every navigation.
// Under jsdom that signal is jsdom's, and newer Node's built-in Request
// (undici) rejects any AbortSignal but its own — so every test that navigates
// on a data router crashed with "Expected signal to be an instance of
// AbortSignal". The signal only cancels route loaders, which these tests don't
// have, so the test Request simply drops it.
class TestRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {};
    super(input, rest);
  }
}
globalThis.Request = TestRequest as typeof Request;
