import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Frontend test harness (Phase 14 / PR 2). The repo had no frontend tests at all
 * before this - flagged in docs/architecture-audit.md - and the polling changes
 * (visibility gating, idle backoff, cross-tab leader election) are exactly the
 * kind of thing that must not ship unverified.
 *
 * Kept as a separate file rather than a `test` block inside vite.config.ts so the
 * production build config stays free of test concerns.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // The app's CSS is not under test and parsing it slows every run.
      css: false,
      restoreMocks: true,
    },
  }),
);
