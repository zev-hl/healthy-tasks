import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
      // Let the browser SPA read the rolling-session token off the response.
      exposedHeaders: ['X-Refreshed-Token'],
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Health check — used by docker-compose and load balancers.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'healthy-tasks-api' });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/tasks', tasksRouter);

  // Fallbacks
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
