import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';

/**
 * Nov 2026 plan, Stage 2 (workflows): snooze, reminders,
 * request update, notification settings and the rest of Stage 2.
 *
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let prismaWithDeleted: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;

const PW = 'Stage2Pass123!';
const ADMIN = 'admin@test.local';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'stage2-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.GOOGLE_ALLOWED_DOMAIN = '';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.EXCLUSIVES_SWEEP_ENABLED = 'false';
  const [appMod, prismaMod, pwMod, cacheMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
    import('../src/services/unread-cache.js'),
  ]);
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  prismaWithDeleted = prismaMod.prismaWithDeleted;
  hashPassword = pwMod.hashPassword;
  resetUnreadCache = cacheMod.__resetUnreadCache;
});

after(async () => {
  await prisma?.$disconnect();
  await prismaWithDeleted?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User", "SchedulerState", "AppSetting", "Department" RESTART IDENTITY CASCADE',
  );
  memoryStorage.__reset();
  resetUnreadCache();
  await seedUser(ADMIN, 'Admin');
});

async function seedUser(email: string, role: Role, supervisorId: string | null = null) {
  return prisma.user.create({
    data: { email, role, passwordHash: await hashPassword(PW), supervisorId },
  });
}

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PW });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function makeTask(token: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/tasks')
    .set(auth(token))
    .send({ name, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: number; updatedAt: string };
}

const getTask = (token: string, id: number) =>
  request(app).get(`/api/tasks/${id}`).set(auth(token));
const setParent = (token: string, id: number, parentId: number) =>
  request(app).put(`/api/tasks/${id}/parent`).set(auth(token)).send({ parentId });
const patch = (token: string, id: number, body: Record<string, unknown>) =>
  request(app).patch(`/api/tasks/${id}`).set(auth(token)).send(body);

const query = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/tasks/query').set(auth(token)).send(body);
const notifs = async (token: string) =>
  (await request(app).get('/api/notifications').set(auth(token))).body as {
    reminders: { id: string; taskId: number; source: string; note: string | null }[];
  };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('Stage 2: snooze (E1, E2)', () => {
  it('the assignee, the creator or someone above them may snooze, up to 30 days', async () => {
    const admin = await login(ADMIN);
    const boss = await seedUser('boss@test.local', 'Manager');
    const worker = await seedUser('worker@test.local', 'Member', boss.id);
    await seedUser('other@test.local', 'Member');
    const t = await makeTask(admin, 'Park me', { assigneeId: worker.id });
    const workerTok = await login('worker@test.local');
    const otherTok = await login('other@test.local');
    const bossTok = await login('boss@test.local');
    const snooze = (tok: string, until: string) =>
      request(app).post(`/api/tasks/${t.id}/snooze`).set(auth(tok)).send({ until });

    assert.equal((await snooze(otherTok, inDays(2))).status, 403);
    assert.equal((await snooze(workerTok, inDays(31))).status, 400);
    assert.equal((await snooze(workerTok, inDays(-1))).status, 400);
    const ok = await snooze(bossTok, inDays(3));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.snoozedUntil);
    assert.equal(ok.body.snoozedBy.email, 'boss@test.local');
    // Others see "snoozed until" on the task; the due date is untouched.
    const seen = await getTask(otherTok, t.id);
    assert.ok(seen.body.snoozedUntil);
    assert.equal(seen.body.canSnooze, false);
  });

  it('leaves the active lists until its time; the Snoozed view lists it', async () => {
    const admin = await login(ADMIN);
    const parked = await makeTask(admin, 'Parked one');
    const active = await makeTask(admin, 'Active one');
    await request(app)
      .post(`/api/tasks/${parked.id}/snooze`)
      .set(auth(admin))
      .send({ until: inDays(1) });
    const ids = async (filters: Record<string, unknown>) =>
      ((await query(admin, { filters })).body.rows as { id: number }[]).map((r) => r.id).sort();
    assert.deepEqual(await ids({}), [active.id]);
    assert.deepEqual(await ids({ snoozed: 'only' }), [parked.id]);
    assert.deepEqual(await ids({ snoozed: 'include' }), [parked.id, active.id].sort());
    const row = (await query(admin, { filters: { snoozed: 'only' } })).body.rows[0];
    assert.ok(row.snoozedUntil);
  });

  it('comes back by itself as a reminder for whoever snoozed it and the assignee', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('w2@test.local', 'Member');
    const t = await makeTask(admin, 'Wake me', { assigneeId: worker.id });
    await request(app)
      .post(`/api/tasks/${t.id}/snooze`)
      .set(auth(admin))
      .send({ until: inDays(1) });
    const wakes = await prisma.reminder.findMany({ where: { taskId: t.id, kind: 'snooze' } });
    assert.equal(wakes.length, 2);
    assert.equal((await notifs(admin)).reminders.length, 0, 'not yet');

    // Its time comes.
    const past = new Date(Date.now() - 60_000);
    await prisma.task.update({ where: { id: t.id }, data: { snoozedUntil: past } });
    await prisma.reminder.updateMany({ where: { taskId: t.id }, data: { remindAt: past } });
    resetUnreadCache();
    const back = (await notifs(admin)).reminders;
    assert.equal(back.length, 1);
    assert.equal(back[0]!.source, 'snooze');
    const workerFeed = await notifs(await login('w2@test.local'));
    assert.equal(workerFeed.reminders[0]?.source, 'snooze');
    const listed = ((await query(admin, {})).body.rows as { id: number }[]).map((r) => r.id);
    assert.ok(listed.includes(t.id), 'back in the active lists');
    assert.equal((await getTask(admin, t.id)).body.snoozedUntil, null);
  });

  it('bringing it back early (or snoozing again) drops the wake-up still to come', async () => {
    const admin = await login(ADMIN);
    const t = await makeTask(admin, 'Change of plan');
    const snooze = (until: string) =>
      request(app).post(`/api/tasks/${t.id}/snooze`).set(auth(admin)).send({ until });
    await snooze(inDays(2));
    await snooze(inDays(5));
    const wakes = await prisma.reminder.findMany({ where: { taskId: t.id, kind: 'snooze' } });
    assert.equal(wakes.length, 1, 'the second snooze replaced the first');
    const res = await request(app).delete(`/api/tasks/${t.id}/snooze`).set(auth(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.snoozedUntil, null);
    assert.equal(await prisma.reminder.count({ where: { taskId: t.id, kind: 'snooze' } }), 0);
    const history = await prisma.taskHistory.findMany({
      where: { taskId: t.id, field: 'snooze' },
      orderBy: { changedAt: 'asc' },
    });
    assert.deepEqual(
      history.map((h) => h.changeType),
      ['added', 'added', 'removed'],
    );
  });
});

const activity = async (token: string) =>
  (await request(app).get('/api/notifications').set(auth(token))).body.activity as {
    type: string;
    taskId: number;
    note: string | null;
    detail: string | null;
    actor: { email: string } | null;
  }[];
const prefs = (token: string, body: Record<string, unknown>) =>
  request(app).put('/api/notifications/preferences').set(auth(token)).send(body);

describe('Stage 2: request update (E3)', () => {
  it('asks the assignee with a note, logs it, and waits 5 minutes before the next', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('upd@test.local', 'Member');
    const workerTok = await login('upd@test.local');
    const t = await makeTask(admin, 'How is it going', { assigneeId: worker.id });
    const ask = (tok: string, note?: string) =>
      request(app).post(`/api/tasks/${t.id}/request-update`).set(auth(tok)).send({ note });

    const first = await ask(admin, 'Need it for the 3pm call');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const feed = await activity(workerTok);
    assert.equal(feed.length, 1);
    assert.equal(feed[0]!.type, 'updateRequested');
    assert.equal(feed[0]!.note, 'Need it for the 3pm call');
    assert.equal(feed[0]!.actor?.email, ADMIN);
    const logged = await prisma.taskHistory.findFirst({
      where: { taskId: t.id, field: 'updateRequested' },
    });
    assert.equal(logged?.detail, 'Need it for the 3pm call');

    const again = await ask(admin);
    assert.equal(again.status, 429);
    assert.match(again.body.error, /minute/);
    assert.equal((await ask(workerTok)).status, 400, 'not of yourself');
    // An assignee-less task has no one to ask.
    const none = await makeTask(admin, 'Nobody on it');
    const r = await request(app)
      .post(`/api/tasks/${none.id}/request-update`)
      .set(auth(admin))
      .send({});
    assert.equal(r.status, 400);
  });
});

describe('Stage 2: notification settings per event and channel (E7)', () => {
  it('reads and saves the table; the first three events keep their old columns', async () => {
    const admin = await login(ADMIN);
    const got = await request(app).get('/api/notifications/preferences').set(auth(admin));
    assert.deepEqual(got.body.matrix.updateRequested, { inApp: true, email: true, connect: false });
    assert.equal(got.body.soundOn, false);
    const saved = await prefs(admin, {
      matrix: { mention: { email: true, connect: true }, status: { inApp: false } },
      soundOn: true,
      sound: 'ping',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.mentionedEmail, true);
    assert.deepEqual(saved.body.matrix.mention, { inApp: true, email: true, connect: true });
    assert.equal(saved.body.matrix.status.inApp, false);
    assert.equal(saved.body.sound, 'ping');
    assert.equal((await prefs(admin, { sound: 'trumpet' })).status, 400);
  });

  it('status changes and comments reach the creator and the assignee, not the one who did it', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('ev@test.local', 'Member');
    const workerTok = await login('ev@test.local');
    const t = await makeTask(admin, 'Eventful', { assigneeId: worker.id });
    assert.equal((await patch(workerTok, t.id, { status: 'InProgress' })).status, 200);
    const mine = await activity(admin);
    assert.equal(mine[0]?.type, 'statusChanged');
    assert.equal(mine[0]?.detail, 'In Progress');
    assert.equal((await activity(workerTok)).length, 0, 'not to the one who changed it');

    await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(admin))
      .send({ body: '<p>Looks <b>good</b> so far</p>' });
    const theirs = await activity(workerTok);
    assert.equal(theirs[0]?.type, 'commented');
    assert.equal(theirs[0]?.note, 'Looks good so far');

    // Switched off in the app: nothing written.
    await prefs(admin, { matrix: { status: { inApp: false } } });
    await patch(workerTok, t.id, { status: 'OnHold' });
    assert.equal((await activity(admin)).filter((a) => a.type === 'statusChanged').length, 1);
  });

  it('due soon goes once a day before, overdue once when it passes', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('due@test.local', 'Member');
    const workerTok = await login('due@test.local');
    const soon = await makeTask(admin, 'Due soon', {
      assigneeId: worker.id,
      dueAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    });
    const late = await makeTask(admin, 'Just late', { assigneeId: worker.id });
    await prisma.task.update({
      where: { id: late.id },
      data: { dueAt: new Date(Date.now() - 3_600_000) },
    });
    const { dispatchDueNotices } = await import('../src/services/task-events.service.js');
    await dispatchDueNotices(new Date());
    await dispatchDueNotices(new Date());
    const feed = await activity(workerTok);
    assert.deepEqual(
      feed.map((a) => [a.type, a.taskId]).sort(),
      [
        ['dueSoon', soon.id],
        ['overdue', late.id],
      ].sort(),
    );
    // The creator hears of overdue too.
    assert.ok((await activity(admin)).some((a) => a.type === 'overdue' && a.taskId === late.id));
  });

  it('sends a browser push to people who switched it on', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('push@test.local', 'Member');
    const workerTok = await login('push@test.local');
    await prefs(workerTok, { pushOn: true });
    const t = await makeTask(admin, 'Push it', { assigneeId: worker.id });
    const { sentPushes } = await import('../src/services/push.service.js');
    sentPushes.length = 0;
    await request(app).post(`/api/tasks/${t.id}/request-update`).set(auth(admin)).send({});
    assert.equal(sentPushes.length, 1);
    assert.equal(sentPushes[0]!.userId, worker.id);
    assert.match(sentPushes[0]!.body, /asked you for an update/);
    const cfg = await request(app).get('/api/notifications/push-config').set(auth(workerTok));
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.publicKey, null, 'no keys on this server');
  });
});

describe('Stage 2: voice notes and screen recordings (D4)', () => {
  async function staged(token: string, taskId: number, filename: string, contentType: string) {
    const meta = { filename, contentType, size: 4096 };
    const res = await request(app)
      .post(`/api/tasks/${taskId}/comments/attachments/presign`)
      .set(auth(token))
      .send(meta);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    memoryStorage.__put(res.body.storageKey, { size: meta.size, contentType });
    return { ...meta, storageKey: res.body.storageKey as string };
  }

  it('keeps a voice note with its length and transcript; a screen recording takes no transcript', async () => {
    const admin = await login(ADMIN);
    const t = await makeTask(admin, 'Recorded');
    const voice = await staged(admin, t.id, 'Voice note.webm', 'audio/webm');
    const screen = await staged(admin, t.id, 'Screen recording.webm', 'video/webm');
    const res = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(admin))
      .send({
        attachments: [
          { ...voice, recording: 'voice', durationMs: 42_000, transcript: ' Ship it today ' },
          { ...screen, recording: 'screen', durationMs: 90_000, transcript: 'ignored' },
        ],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const files = res.body.comments[0].attachments as {
      recording: string;
      durationMs: number;
      transcript: string | null;
    }[];
    const byKind = new Map(files.map((f) => [f.recording, f]));
    assert.deepEqual(byKind.get('voice'), {
      ...byKind.get('voice')!,
      durationMs: 42_000,
      transcript: 'Ship it today',
    });
    assert.equal(byKind.get('screen')!.transcript, null);
    assert.equal(byKind.get('screen')!.durationMs, 90_000);
  });
});

describe('Stage 2: the Dashboard numbers (H1)', () => {
  const attention = async (tok: string) =>
    (await request(app).get('/api/tasks/attention').set(auth(tok))).body as {
      unread: { count: number; rows: { id: number }[] };
      stale: { count: number; rows: { id: number }[] };
      mentionsAwaiting: { count: number; rows: { id: number }[] };
    };

  it('Unread: my task with something new since I last opened it', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('unread@test.local', 'Member');
    const tok = await login('unread@test.local');
    const t = await makeTask(admin, 'For you', { assigneeId: worker.id });
    assert.deepEqual(
      (await attention(tok)).unread.rows.map((r) => r.id),
      [t.id],
      'never opened',
    );
    await getTask(tok, t.id);
    assert.equal((await attention(tok)).unread.count, 0, 'opened');
    await new Promise((r) => setTimeout(r, 20));
    await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(admin))
      .send({ body: '<p>One more thing</p>' });
    assert.equal((await attention(tok)).unread.count, 1, 'new comment since');
  });

  it('Stale: my open task quiet for 2+ business days', async () => {
    const admin = await login(ADMIN);
    const quiet = await makeTask(admin, 'Quiet one', {
      assigneeId: (await prisma.user.findFirstOrThrow({ where: { email: ADMIN } })).id,
    });
    await makeTask(admin, 'Fresh one');
    await prisma.task.update({
      where: { id: quiet.id },
      data: { lastActivityAt: new Date(Date.now() - 6 * 86_400_000) },
    });
    const a = await attention(admin);
    assert.deepEqual(
      a.stale.rows.map((r) => r.id),
      [quiet.id],
    );
  });

  it('Mentions awaiting reply: mentioned and not commented since', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('ment@test.local', 'Member');
    const tok = await login('ment@test.local');
    const t = await makeTask(admin, 'Your view?');
    await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(admin))
      .send({
        body: `<p>What do you think <span data-type="mention" data-id="${worker.id}" data-label="w">@w</span>?</p>`,
      });
    assert.deepEqual(
      (await attention(tok)).mentionsAwaiting.rows.map((r) => r.id),
      [t.id],
    );
    await new Promise((r) => setTimeout(r, 20));
    await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(tok))
      .send({ body: '<p>Yes</p>' });
    assert.equal((await attention(tok)).mentionsAwaiting.count, 0);
  });
});

describe('Stage 2: drafts (I1)', () => {
  it('only the owner sees a draft; Make task moves its files onto the task and the draft goes', async () => {
    const admin = await login(ADMIN);
    await seedUser('peek@test.local', 'Member');
    const other = await login('peek@test.local');
    const made = await request(app)
      .post('/api/drafts')
      .set(auth(admin))
      .send({ title: 'New supplier idea', notes: '<p>Ask <b>Acme</b><script>x</script></p>' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id as string;
    assert.ok(!made.body.notes.includes('script'));
    assert.equal((await request(app).get('/api/drafts').set(auth(other))).body.length, 0);
    assert.equal(
      (await request(app).patch(`/api/drafts/${id}`).set(auth(other)).send({ title: 'x' })).status,
      404,
    );

    const pre = await request(app)
      .post(`/api/drafts/${id}/files/presign`)
      .set(auth(admin))
      .send({ filename: 'quote.pdf', contentType: 'application/pdf', size: 1000 });
    assert.equal(pre.status, 201);
    memoryStorage.__put(pre.body.storageKey, { size: 1000, contentType: 'application/pdf' });
    const withFile = await request(app).post(`/api/drafts/${id}/files`).set(auth(admin)).send({
      filename: 'quote.pdf',
      contentType: 'application/pdf',
      size: 1000,
      storageKey: pre.body.storageKey,
    });
    assert.equal(withFile.body.files.length, 1);

    const t = await makeTask(admin, 'New supplier idea');
    const fin = await request(app)
      .post(`/api/drafts/${id}/finish`)
      .set(auth(admin))
      .send({ taskId: t.id });
    assert.equal(fin.status, 204, JSON.stringify(fin.body));
    const task = await getTask(admin, t.id);
    assert.deepEqual(
      (task.body.attachments as { filename: string }[]).map((a) => a.filename),
      ['quote.pdf'],
    );
    assert.equal((await request(app).get('/api/drafts').set(auth(admin))).body.length, 0);
    assert.equal(await prisma.draftFile.count(), 0);
  });
});

describe('Stage 2: a duty video as a file (I4)', () => {
  it('an Admin uploads it and everyone may watch', async () => {
    const admin = await login(ADMIN);
    await seedUser('watch@test.local', 'Member');
    const member = await login('watch@test.local');
    const dep = await prisma.department.create({
      data: { name: 'Ops', nameKey: 'ops', color: '#3366cc' },
    });
    const duty = await prisma.duty.create({
      data: { departmentId: dep.id, name: 'Receiving', nameKey: 'receiving' },
    });
    const meta = { filename: 'howto.mp4', contentType: 'video/mp4', size: 5000 };
    assert.equal(
      (
        await request(app)
          .post(`/api/departments/duties/${duty.id}/video/presign`)
          .set(auth(member))
          .send(meta)
      ).status,
      403,
    );
    const pre = await request(app)
      .post(`/api/departments/duties/${duty.id}/video/presign`)
      .set(auth(admin))
      .send(meta);
    assert.equal(pre.status, 201, JSON.stringify(pre.body));
    memoryStorage.__put(pre.body.storageKey, { size: 5000, contentType: 'video/mp4' });
    assert.equal(
      (
        await request(app)
          .put(`/api/departments/duties/${duty.id}/video`)
          .set(auth(admin))
          .send({ ...meta, storageKey: pre.body.storageKey })
      ).status,
      204,
    );
    const deps = (await request(app).get('/api/departments').set(auth(member))).body;
    assert.equal(deps[0].duties[0].videoFile, 'howto.mp4');
    const watch = await request(app)
      .get(`/api/departments/duties/${duty.id}/video`)
      .set(auth(member));
    assert.equal(watch.status, 200);
    assert.ok(watch.body.url);
  });
});

describe('Stage 2: the timer on the server, saved with the task (L2)', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const start = (token: string, taskId: number, replacing: number | null) =>
    request(app)
      .post('/api/timer/start')
      .set(auth(token))
      .send({ taskId, replacing, date: today() });
  const stop = (token: string, taskId: number) =>
    request(app).post('/api/timer/stop').set(auth(token)).send({ taskId, date: today() });
  /** Pretend the running timer started `min` minutes ago. */
  const backdate = (email: string, min: number) =>
    prisma.runningTimer.updateMany({
      where: { user: { email } },
      data: { startedAt: new Date(Date.now() - min * 60_000) },
    });

  it('one timer per person, the same in every browser; a stale start or stop is refused', async () => {
    const admin = await login(ADMIN);
    const a = await makeTask(admin, 'Count the pallets');
    const b = await makeTask(admin, 'Label the shelves');

    const started = await start(admin, a.id, null);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.timer.taskId, a.id);
    // "Another browser" sees it.
    const seen = (await request(app).get('/api/timer').set(auth(admin))).body;
    assert.equal(seen.timer.taskId, a.id);
    assert.equal(seen.timer.taskName, 'Count the pallets');

    // A browser that thinks nothing is running can't start over it.
    const stale = await start(admin, b.id, null);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.details.code, 'TIMER_CHANGED');
    assert.equal(stale.body.details.timer.taskId, a.id);
    // Nor stop a timer that isn't the one running.
    assert.equal((await stop(admin, b.id)).status, 409);

    // Switching names the one it replaces: that one is saved first.
    await backdate(ADMIN, 30);
    const sw = await start(admin, b.id, a.id);
    assert.equal(sw.status, 200, JSON.stringify(sw.body));
    assert.equal(sw.body.timer.taskId, b.id);
    assert.equal(sw.body.saved.taskId, a.id);
    assert.equal(sw.body.saved.minutes, 30);

    await backdate(ADMIN, 10);
    const stopped = await stop(admin, b.id);
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.timer, null);
    assert.equal(stopped.body.saved.minutes, 10);
    // Stopping again (the other browser) is refused, and nothing is saved twice.
    const again = await stop(admin, b.id);
    assert.equal(again.status, 409);
    assert.equal(again.body.details.timer, null);
    assert.equal(await prisma.timedStretch.count(), 2);
  });

  it('saves each stretch with the duty the task had then, and adds it up on the task and My Time', async () => {
    const admin = await login(ADMIN);
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).id;
    const member2 = await seedUser('timer2@test.local', 'Member');
    const member = await login('timer2@test.local');
    const dep = await prisma.department.create({
      data: { name: 'Ops', nameKey: 'ops', color: '#3366cc' },
    });
    const recv = await prisma.duty.create({
      data: { departmentId: dep.id, name: 'Receiving', nameKey: 'receiving' },
    });
    const pack = await prisma.duty.create({
      data: { departmentId: dep.id, name: 'Packing', nameKey: 'packing' },
    });
    const t = await makeTask(admin, 'Count the pallets');
    await prisma.task.update({ where: { id: t.id }, data: { dutyId: recv.id } });
    const timeOn = async (token: string, email: string, min: number) => {
      assert.equal((await start(token, t.id, null)).status, 200);
      await backdate(email, min);
      return (await stop(token, t.id)).body.saved;
    };

    const first = await timeOn(admin, ADMIN, 30);
    assert.equal(first.minutes, 30);
    assert.equal(first.duty.id, recv.id);
    // The duty changes; past hours stay where they were.
    await prisma.task.update({ where: { id: t.id }, data: { dutyId: pack.id } });
    assert.equal((await timeOn(admin, ADMIN, 10)).duty.id, pack.id);
    await prisma.task.update({ where: { id: t.id }, data: { dutyId: null } });
    const third = await timeOn(member, 'timer2@test.local', 5);
    assert.equal(third.duty, null);

    const time = (await request(app).get(`/api/tasks/${t.id}/time`).set(auth(member))).body;
    assert.equal(time.totalMinutes, 45);
    assert.deepEqual(
      time.people.map((p: { user: { id: string }; minutes: number }) => [p.user.id, p.minutes]),
      [
        [adminId, 40],
        [member2.id, 5],
      ],
    );

    // Admin's My Time: timed by duty, beside (not inside) the hand-typed rows.
    const d = today();
    const [day] = (await request(app).get(`/api/time/days?from=${d}&to=${d}`).set(auth(admin)))
      .body;
    const timed = Object.fromEntries(
      day.timed.map((x: { dutyId: string | null; minutes: number }) => [
        x.dutyId ?? 'none',
        x.minutes,
      ]),
    );
    assert.deepEqual(timed, { [recv.id]: 30, [pack.id]: 10 });
    assert.deepEqual(day.entries, []);
    const [mine] = (await request(app).get(`/api/time/days?from=${d}&to=${d}`).set(auth(member)))
      .body;
    assert.deepEqual(mine.timed, [{ dutyId: null, minutes: 5 }]);

    // A duty with timed hours counts as used.
    assert.equal(
      (await request(app).delete(`/api/departments/duties/${recv.id}`).set(auth(admin))).status,
      409,
    );
  });

  it('won’t time a task you cannot read', async () => {
    const admin = await login(ADMIN);
    await seedUser('timer3@test.local', 'Member');
    const member = await login('timer3@test.local');
    const t = await makeTask(admin, 'Secret thing');
    await prisma.task.update({ where: { id: t.id }, data: { isPrivate: true } });
    assert.equal((await start(member, t.id, null)).status, 404);
    assert.equal((await request(app).get(`/api/tasks/${t.id}/time`).set(auth(member))).status, 404);
  });
});

describe('Stage 2: the timer asks "Still working?" and stops when nobody answers (L2)', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  it('asks after the Admin’s hours, Keep going asks again later, no answer stops it at the question', async () => {
    const admin = await login(ADMIN);
    const { dispatchTimerCheckIns } = await import('../src/services/task-time.service.js');
    // 1 hour, 5 minutes to answer.
    const set = await request(app)
      .put('/api/settings')
      .set(auth(admin))
      .send({ timerCheckInHours: 1, timerCheckInGraceMinutes: 5 });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.timerCheckInHours, 1);
    assert.equal(set.body.materializeLeadDays, 14);
    assert.equal(
      (await request(app).put('/api/settings').set(auth(admin)).send({ timerCheckInHours: 13 }))
        .status,
      400,
    );

    const t = await makeTask(admin, 'Count the pallets');
    await request(app)
      .post('/api/timer/start')
      .set(auth(admin))
      .send({ taskId: t.id, replacing: null, date: today() });
    const mine = (await request(app).get('/api/timer').set(auth(admin))).body.timer;
    assert.equal(Date.parse(mine.checkInAt) - Date.parse(mine.startedAt), 3_600_000);
    assert.equal(Date.parse(mine.stopsAt) - Date.parse(mine.checkInAt), 300_000);

    // 61 minutes in: the question goes out, once.
    await prisma.runningTimer.updateMany({ data: { startedAt: ago(61), confirmedAt: ago(61) } });
    await dispatchTimerCheckIns(new Date());
    await dispatchTimerCheckIns(new Date());
    assert.equal(await prisma.notification.count({ where: { type: 'timerCheckIn' } }), 1);

    // Keep going: it asks again an hour from now.
    const kept = await request(app).post('/api/timer/keep').set(auth(admin)).send({ taskId: t.id });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.ok(Date.parse(kept.body.timer.checkInAt) > Date.now() + 59 * 60_000);
    assert.equal((await prisma.runningTimer.findFirstOrThrow()).checkInSentAt, null);

    // Nobody answers this time: 70 minutes after Keep going it has stopped
    // itself, the time saved up to the question (60 minutes after Keep going).
    await prisma.runningTimer.updateMany({ data: { startedAt: ago(130), confirmedAt: ago(70) } });
    const after = (await request(app).get('/api/timer').set(auth(admin))).body;
    assert.equal(after.timer, null);
    const stretch = await prisma.timedStretch.findFirstOrThrow();
    assert.equal(stretch.minutes, 120);
    assert.equal(await prisma.notification.count({ where: { type: 'timerStopped' } }), 1);
    // A browser still showing it can't stop or keep it.
    assert.equal(
      (await request(app).post('/api/timer/keep').set(auth(admin)).send({ taskId: t.id })).status,
      409,
    );
  });

  it('the scheduler stops an unanswered timer too', async () => {
    const admin = await login(ADMIN);
    const { dispatchTimerCheckIns, nextTimerCheckInAt } =
      await import('../src/services/task-time.service.js');
    const t = await makeTask(admin, 'Label the shelves');
    await request(app)
      .post('/api/timer/start')
      .set(auth(admin))
      .send({ taskId: t.id, replacing: null, date: today() });
    // Default 4 hours + 15 minutes.
    const next = await nextTimerCheckInAt(new Date());
    assert.ok(next && Math.abs(next.getTime() - (Date.now() + 4 * 3_600_000)) < 5_000);
    await prisma.runningTimer.updateMany({ data: { startedAt: ago(300), confirmedAt: ago(300) } });
    await dispatchTimerCheckIns(new Date());
    assert.equal(await prisma.runningTimer.count(), 0);
    assert.equal((await prisma.timedStretch.findFirstOrThrow()).minutes, 240);
  });
});
