/* eslint-disable no-console */
import express from 'express';
import { createQueueBoard } from './queue/dashboard-board.js';

// The local queue dashboard, as a container of its own at
// http://localhost:3005/bullmq (the board itself: queue/dashboard-board.ts).
// It has no sign-in, so the compose file publishes it to this computer alone;
// on Render the API serves the same board behind a password instead
// (QUEUE_DASHBOARD_USER / QUEUE_DASHBOARD_PASSWORD).

const PORT = Number(process.env.QUEUE_DASHBOARD_PORT ?? 3005);
const BASE_PATH = '/bullmq';

const board = createQueueBoard(BASE_PATH);

const app = express();
// The website's button posts here, as it does to the API's dashboard; with no
// sign-in here, it just opens the board.
app.post(`${BASE_PATH}/enter`, (_req, res) => res.redirect(303, BASE_PATH));
app.use(BASE_PATH, board.router);
app.get('/', (_req, res) => res.redirect(BASE_PATH));

const server = app.listen(PORT, () => {
  console.log(`📊 Queue dashboard on http://localhost:${PORT}${BASE_PATH}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await board.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
