import dotenv from 'dotenv';

// BUSINESS_TIMEZONE, kept apart from env.ts for the same reason as
// email-config.ts: the email worker reads it (to time the weekly cleanup of
// failed emails) without the API's required settings. env.ts re-exports it as
// `env.businessTimeZone`; see the notes there on what it is and is not for.
dotenv.config();

export const businessTimeZone = process.env.BUSINESS_TIMEZONE || 'America/New_York';
