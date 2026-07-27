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

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '15m'),
  passwordResetExpiresIn: optional('PASSWORD_RESET_EXPIRES_IN', '60m'),

  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),

  email: {
    provider: optional('EMAIL_PROVIDER', 'console'),
    from: optional('EMAIL_FROM', 'Healthy Tasks <no-reply@healthy-tasks.local>'),
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
  },

  seed: {
    adminEmail: optional('SEED_ADMIN_EMAIL', 'admin@healthy-tasks.local'),
    adminPassword: optional('SEED_ADMIN_PASSWORD', 'ChangeMe123!'),
  },
} as const;
