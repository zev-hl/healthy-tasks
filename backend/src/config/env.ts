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

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  port: Number(optional('PORT', '4000')),

  databaseUrl: required('DATABASE_URL'),

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
    adminEmail: optional('SEED_ADMIN_EMAIL', 'admin@healthy-tasks.local'),
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
} as const;
