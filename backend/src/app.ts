import { connectInboundRouter } from './routes/connect-inbound.routes.js';
import { connectRouter } from './routes/connect.routes.js';
import { googleCalendarRouter } from './routes/google-calendar.routes.js';
import { calendarRouter, eventsRouter } from './routes/calendar.routes.js';
import { timerRouter } from './routes/timer.routes.js';
import { connectAuthRouter } from './routes/connect-auth.routes.js';
import { filesRouter } from './routes/files.routes.js';
import { draftsRouter } from './routes/drafts.routes.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { commentsRouter } from './routes/comments.routes.js';
import { attachmentsRouter } from './routes/attachments.routes.js';
import { preferencesRouter } from './routes/preferences.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { remindersRouter } from './routes/reminders.routes.js';
import { templatesRouter } from './routes/templates.routes.js';
import { goalsRouter } from './routes/goals.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { settingsRouter } from './routes/app-settings.routes.js';
import { exclusivesRouter } from './routes/exclusives.routes.js';
import { departmentsRouter } from './routes/departments.routes.js';
import { orgRouter } from './routes/org.routes.js';
import { timeRouter } from './routes/time.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { enterQueueDashboard, queueDashboardGate } from './middleware/queue-dashboard-access.js';
import { corsOriginOption } from './utils/cors-origins.js';

export interface AppOptions {
  /**
   * The queue dashboard, served behind its own user name and password, or a
   * pass from the website's button for Admins (middleware/queue-dashboard-access.ts).
   * Passed only by server.ts when QUEUE_DASHBOARD_* allow it; the tests never
   * pass it, so they open no Redis connection.
   */
  queueDashboard?: { path: string; router: express.Router; user: string; password: string };
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  // Before the app's own CORS and JSON: Connect's page and server call these
  // (Stage 5, HL Central as Connect's sign-in service).
  app.use(cookieParser());
  app.use('/api/connect-auth', connectAuthRouter);

  app.use(
    cors({
      origin: corsOriginOption(env.corsOrigins),
      credentials: true,
      // Let the browser SPA read the rolling-session token off the response.
      exposedHeaders: ['X-Refreshed-Token'],
    }),
  );
  // Raised from the 100kb default to comfortably fit rich-text descriptions and
  // comments. File bytes never come through here — they go straight to storage
  // via pre-signed URLs.
  app.use(express.json({ limit: '2mb' }));

  // Health check — used by docker-compose and load balancers.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'hlcentral-api' });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/attachments', attachmentsRouter);
  app.use('/api/preferences', preferencesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reminders', remindersRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/goals', goalsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/exclusives', exclusivesRouter);
  // Department Duties.
  app.use('/api/departments', departmentsRouter);
  app.use('/api/org', orgRouter);
  app.use('/api/time', timeRouter);
  app.use('/api/drafts', draftsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/timer', timerRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/google-calendar', googleCalendarRouter);
  app.use('/api/connect', connectRouter);
  // What our Connect calls on HL Central (K6, K7), with its own key.
  app.use('/api/integrations/connect', connectInboundRouter);

  const dashboard = options.queueDashboard;
  if (dashboard) {
    // The website's button: the form it sends, read here only.
    app.post(
      `${dashboard.path}/enter`,
      express.urlencoded({ extended: false, limit: '16kb' }),
      enterQueueDashboard(dashboard.path),
    );
    app.use(
      dashboard.path,
      queueDashboardGate(dashboard.path, dashboard.user, dashboard.password, 'HL Central queues'),
      dashboard.router,
    );
  }

  // Fallbacks
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
