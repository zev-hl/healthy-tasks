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

  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
      // Let the browser SPA read the rolling-session token off the response.
      exposedHeaders: ['X-Refreshed-Token'],
    }),
  );
  // Raised from the 100kb default to comfortably fit rich-text descriptions and
  // comments. File bytes never come through here — they go straight to storage
  // via pre-signed URLs.
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

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
