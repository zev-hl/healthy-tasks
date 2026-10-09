import dotenv from 'dotenv';

// Load .env from the repo root (docker-compose also injects these directly).
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** A whole number of minutes within [min, max]; a typo fails loudly at boot. */
function minutes(name: string, fallback: number, min: number, max: number): number {
  const value = Number(optional(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number of minutes from ${min} to ${max}`);
  }
  return value;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  port: Number(optional('PORT', '4000')),

  databaseUrl: required('DATABASE_URL'),

  // The zone to assume when the server must turn a bare calendar date into a
  // real instant and NO user's browser is available to ask. Today that means
  // expanding a template's relative day offsets; later it will also mean
  // formatting dates inside server-rendered email.
  //
  // NOT "the app's timezone". Staff are spread across several countries, and
  // dates a user types into a task form are already converted in that user's own
  // zone, which is correct for an absolute deadline. Do not apply this to them.
  businessTimeZone: optional('BUSINESS_TIMEZONE', 'America/New_York'),

  // Whether this process runs the recurrence scheduler (Phase 14 / S3). Default
  // on; set false on staging, where an always-ticking timer keeps the Neon
  // compute awake 24/7 for no benefit. NOTE: with the scheduler off, recurring
  // occurrences are not materialized and reminder emails are not dispatched.
  schedulerEnabled: optional('SCHEDULER_ENABLED', 'true') !== 'false',

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '15m'),
  passwordResetExpiresIn: optional('PASSWORD_RESET_EXPIRES_IN', '60m'),

  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),

  email: {
    provider: optional('EMAIL_PROVIDER', 'console'),
    from: optional('EMAIL_FROM', 'HL Central <no-reply@healthy-tasks.local>'),
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
  },

  seed: {
    // Must satisfy GOOGLE_ALLOWED_DOMAIN, or a fresh environment seeds an
    // admin who cannot sign in through either door.
    adminEmail: optional('SEED_ADMIN_EMAIL', 'admin-local@healthlifeny.com'),
    adminPassword: optional('SEED_ADMIN_PASSWORD', 'ChangeMe123!'),
  },

  // Object storage for attachments (Phase 4). `driver: memory` swaps in an
  // in-memory fake (used by tests) so no MinIO/S3 is required. For the S3
  // driver, `endpoint` is used for server-side ops (delete/head) while
  // `publicEndpoint` is used to SIGN upload/download URLs — the signed host must
  // be the one the browser can actually reach (localhost, not the compose DNS).
  storage: {
    driver: optional('STORAGE_DRIVER', 's3'), // 's3' | 'memory'
    bucket: optional('S3_BUCKET', 'healthy-tasks'),
    region: optional('S3_REGION', 'us-east-1'),
    endpoint: optional('S3_ENDPOINT', 'http://minio:9000'),
    publicEndpoint: optional('S3_PUBLIC_ENDPOINT', 'http://localhost:9000'),
    accessKey: optional('S3_ACCESS_KEY', 'minioadmin'),
    secretKey: optional('S3_SECRET_KEY', 'minioadmin'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
  },

  // Google sign-in. Left optional rather than required() so the app still boots
  // where it is not wired up yet — the same treatment as the SP-API block
  // below. The Google endpoint refuses clearly when clientId is blank, and
  // startup-checks warns about it in production.
  google: {
    // Identifies THIS app to Google. Public by design: it ends up in the page
    // source. The backend checks every incoming token was issued for it.
    clientId: optional('GOOGLE_CLIENT_ID', ''),
    // Only addresses in this domain may sign in. Checked by us regardless of
    // how the Google consent screen is configured; blank disables the check.
    // Used from Chunk 3 onward.
    allowedDomain: optional('GOOGLE_ALLOWED_DOMAIN', '').trim().toLowerCase(),
  },

  // Amazon SP-API (Exclusives). Undefined until Amazon is wired up so the app
  // still boots; merchantToken is the own-seller id used for Buy Box detection.
  amazon: {
    clientId: process.env.SP_API_CLIENT_ID,
    clientSecret: process.env.SP_API_CLIENT_SECRET,
    refreshToken: process.env.SP_API_REFRESH_TOKEN,
    merchantToken: process.env.SP_API_MERCHANT_TOKEN,
    storeName: optional('SELLER_STORE_NAME', 'HL Central'),
    // Whether THIS process polls Amazon on a timer (needs SCHEDULER_ENABLED
    // too). Off unless set to "true", so staging and dev machines never sweep
    // the seller's account — and share its rate limit — by accident.
    sweepEnabled: optional('EXCLUSIVES_SWEEP_ENABLED', 'false') === 'true',
    // A sweep takes ~1 min; one a day is the slowest that still makes sense.
    sweepMinutes: minutes('EXCLUSIVES_SWEEP_MINUTES', 30, 5, 24 * 60),
  },
} as const;
