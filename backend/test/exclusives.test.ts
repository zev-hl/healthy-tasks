import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { EXCLUSIVES_ALERT_TYPES } from '@healthy-tasks/shared';
import type { ListingItem } from '../src/services/exclusives/sp-api/listings.js';
import { __resetHttpHooks } from '../src/services/exclusives/sp-api/http.js';
import { __resetSharedPacers } from '../src/services/exclusives/sp-api/shared-pacer.js';
import { __resetLookupCache } from '../src/services/exclusives/lookup-cache.js';
import { fakeAmazon } from './fixtures/fake-amazon.js';
import { startTestDb, type TestDb } from './db.js';

// The Exclusives API lives in its own file: integration.test.ts is already
// ~6,000 lines, and these tests never touch tasks, goals or templates.

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'AdminPass123!';
const HOUR_MS = 60 * 60 * 1000;

before(async () => {
  db = await startTestDb();

  // Configure env BEFORE importing modules that read it at load time.
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'exclusives-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DRIVER = 'memory';
  // Fake SP-API credentials, so real ones in the environment can never reach a
  // test. Nothing here calls Amazon: 7a is database-only.
  process.env.SP_API_CLIENT_ID = 'test-client';
  process.env.SP_API_CLIENT_SECRET = 'test-secret';
  process.env.SP_API_REFRESH_TOKEN = 'test-refresh';
  process.env.SP_API_MERCHANT_TOKEN = 'A1UWLDVGZSXGKG';
  // On, so the summary's "next sweep" is exercised. No timer starts under
  // tests — that only happens from server.ts.
  process.env.EXCLUSIVES_SWEEP_ENABLED = 'true';
  process.env.EXCLUSIVES_SWEEP_MINUTES = '30';

  const [appMod, prismaMod, pwMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
  ]);
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  hashPassword = pwMod.hashPassword;
});

after(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  // CASCADE from User clears AlertGroup and everything below it.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'Admin',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      isActive: true,
    },
  });
});

// --- helpers ---------------------------------------------------------------

async function token(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface SeedAsin {
  asin: string;
  marketplace?: string;
  sku?: string;
  title?: string | null;
  capturedAt?: Date;
}

/** A group with its listings, snapshots, settings and alert history. */
async function seedGroup(opts: {
  name: string;
  groupType?: 'GROUP' | 'INDIVIDUAL';
  asins?: SeedAsin[];
  /** How many of the 12 alert types are switched on (the rest are written 'off'). */
  settingsOn?: number;
  /** One alert per entry, at the given age in hours. */
  alertsAgedHours?: number[];
  updatedAt?: Date;
}): Promise<number> {
  const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
  const group = await prisma.alertGroup.create({
    data: {
      name: opts.name,
      groupType: opts.groupType ?? 'GROUP',
      createdById: admin.id,
      ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
      settings: {
        create: EXCLUSIVES_ALERT_TYPES.map((alertType, i) => ({
          alertType,
          mode: i < (opts.settingsOn ?? 0) ? 'immediate' : 'off',
        })),
      },
    },
  });

  for (const a of opts.asins ?? []) {
    const listing = await prisma.listing.create({
      data: {
        groupId: group.id,
        marketplace: a.marketplace ?? 'USA',
        asin: a.asin,
        sku: a.sku ?? `SKU-${a.asin}`,
        createdById: admin.id,
      },
    });
    if (a.title !== undefined || a.capturedAt) {
      await prisma.listingSnapshot.create({
        data: {
          listingId: listing.id,
          title: a.title ?? null,
          bulletPoints: [],
          capturedAt: a.capturedAt ?? new Date(),
        },
      });
    }
  }

  for (const hours of opts.alertsAgedHours ?? []) {
    await prisma.alertLog.create({
      data: {
        groupId: group.id,
        alertType: 'PriceChanged',
        message: 'List price changed from $10.00 to $9.00 (-10.0%).',
        asin: opts.asins?.[0]?.asin ?? 'B000000000',
        marketplace: 'USA',
        title: 'A product',
        groupName: opts.name,
        createdAt: new Date(Date.now() - hours * HOUR_MS),
      },
    });
  }

  return group.id;
}

const queryGroups = async (body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/exclusives/groups/query')
    .set(auth(await token()))
    .send(body);

const names = (rows: { name: string }[]): string[] => rows.map((r) => r.name);

const hoursAgo = (n: number): Date => new Date(Date.now() - n * HOUR_MS);

// --- tests -----------------------------------------------------------------

describe('exclusives: group read (HLAI-71 7a)', () => {
  it('needs a signed-in user', async () => {
    const res = await request(app).post('/api/exclusives/groups/query').send({});
    assert.equal(res.status, 401);
  });

  it('returns each row with the numbers the screen shows', async () => {
    await seedGroup({
      name: 'Versure Exclusives',
      asins: [
        { asin: 'B00000001', title: 'First' },
        { asin: 'B00000002', title: 'Second' },
      ],
      settingsOn: 5,
      alertsAgedHours: [1, 2],
    });

    const res = await queryGroups();
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    const row = res.body.rows[0];
    assert.equal(row.name, 'Versure Exclusives');
    assert.equal(row.groupType, 'GROUP');
    assert.equal(row.listingCount, 2);
    assert.deepEqual(row.asinPreview, ['B00000001', 'B00000002']);
    assert.equal(row.alerts24h, 2);
    assert.equal(row.alertTypesOn, 5);
    assert.ok(row.latestAlertAt, 'latest alert reported');
  });

  it('previews at most three ASINs however many the group holds', async () => {
    await seedGroup({
      name: 'Big',
      asins: ['B1', 'B2', 'B3', 'B4', 'B5'].map((asin) => ({ asin, title: asin })),
    });
    const res = await queryGroups();
    assert.equal(res.body.rows[0].listingCount, 5);
    assert.deepEqual(res.body.rows[0].asinPreview, ['B1', 'B2', 'B3']);
  });

  it('shows a product sold in both marketplaces once in the preview', async () => {
    await seedGroup({
      name: 'Both countries',
      asins: [
        { asin: 'B0SAME', marketplace: 'USA', sku: 'U-1', title: 'Same product' },
        { asin: 'B0SAME', marketplace: 'Canada', sku: 'C-1', title: 'Same product' },
        { asin: 'B0OTHER', marketplace: 'USA', sku: 'U-2', title: 'Other' },
      ],
    });
    const row = (await queryGroups()).body.rows[0];
    assert.equal(row.listingCount, 3, 'still three listings');
    assert.deepEqual(row.asinPreview, ['B0OTHER', 'B0SAME'], 'but two distinct ASINs');
  });

  it('counts only alerts from the last 24 hours', async () => {
    await seedGroup({
      name: 'Aged',
      asins: [{ asin: 'B1', title: 'One' }],
      alertsAgedHours: [1, 23.5, 24.5, 100],
    });
    const res = await queryGroups();
    assert.equal(res.body.rows[0].alerts24h, 2);
    // The latest-alert column looks at all of them, not just the window.
    assert.ok(res.body.rows[0].latestAlertAt);
  });

  it('reports zeros for an empty group rather than leaving fields out', async () => {
    await seedGroup({ name: 'Empty' });
    const row = (await queryGroups()).body.rows[0];
    assert.equal(row.listingCount, 0);
    assert.deepEqual(row.asinPreview, []);
    assert.equal(row.alerts24h, 0);
    assert.equal(row.alertTypesOn, 0);
    assert.equal(row.latestAlertAt, null);
  });

  it('searches by group name, ASIN and last-seen title', async () => {
    await seedGroup({ name: 'Fragrances', asins: [{ asin: 'B0RASASI01', title: 'Rasasi Blue' }] });
    await seedGroup({ name: 'Vitamins', asins: [{ asin: 'B0VITAMIN1', title: 'Vitamin C' }] });

    assert.deepEqual(names((await queryGroups({ text: 'fragr' })).body.rows), ['Fragrances']);
    assert.deepEqual(names((await queryGroups({ text: 'B0VITAMIN1' })).body.rows), ['Vitamins']);
    assert.deepEqual(names((await queryGroups({ text: 'rasasi' })).body.rows), ['Fragrances']);
    assert.equal((await queryGroups({ text: 'no-such-thing' })).body.total, 0);
  });

  it('filters by group type', async () => {
    await seedGroup({ name: 'A group', groupType: 'GROUP' });
    await seedGroup({ name: 'One product', groupType: 'INDIVIDUAL' });

    const res = await queryGroups({ groupTypes: ['INDIVIDUAL'] });
    assert.equal(res.body.total, 1);
    assert.equal(res.body.rows[0].name, 'One product');
  });

  it('sorts by name, by listing count, and newest-updated by default', async () => {
    await seedGroup({
      name: 'Bravo',
      asins: [
        { asin: 'B1', title: 'x' },
        { asin: 'B2', title: 'y' },
      ],
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await seedGroup({
      name: 'Alpha',
      asins: [{ asin: 'B3', title: 'z' }],
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    const byName = await queryGroups({ sort: [{ field: 'name', dir: 'asc' }] });
    assert.deepEqual(names(byName.body.rows), ['Alpha', 'Bravo']);

    const byCount = await queryGroups({ sort: [{ field: 'listingCount', dir: 'desc' }] });
    assert.deepEqual(names(byCount.body.rows), ['Bravo', 'Alpha']);

    assert.deepEqual(names((await queryGroups()).body.rows), ['Alpha', 'Bravo']);
  });

  it('pages without repeating or skipping a row', async () => {
    for (const name of ['G1', 'G2', 'G3', 'G4', 'G5']) await seedGroup({ name });

    const first = await queryGroups({
      page: 1,
      pageSize: 2,
      sort: [{ field: 'name', dir: 'asc' }],
    });
    assert.equal(first.body.total, 5);
    assert.equal(first.body.page, 1);
    assert.equal(first.body.pageSize, 2);
    assert.deepEqual(names(first.body.rows), ['G1', 'G2']);

    const third = await queryGroups({
      page: 3,
      pageSize: 2,
      sort: [{ field: 'name', dir: 'asc' }],
    });
    assert.deepEqual(names(third.body.rows), ['G5']);
  });

  it('rejects a malformed query body', async () => {
    const res = await request(app)
      .post('/api/exclusives/groups/query')
      .set(auth(await token()))
      .send({ pageSize: 0, sort: [{ field: 'nonsense', dir: 'asc' }] });
    assert.equal(res.status, 400);
    assert.ok(res.body.details, 'field errors returned');
  });
});

describe('exclusives: one group (HLAI-71 7a)', () => {
  it('returns its listings and all twelve settings', async () => {
    const capturedAt = new Date('2026-09-20T10:00:00.000Z');
    const id = await seedGroup({
      name: 'Editor group',
      asins: [
        { asin: 'B0000CA01', marketplace: 'Canada', sku: 'C-1', title: 'Canadian', capturedAt },
        { asin: 'B0000US01', marketplace: 'USA', sku: 'U-1', title: 'American', capturedAt },
      ],
      settingsOn: 3,
    });

    const res = await request(app)
      .get(`/api/exclusives/groups/${id}`)
      .set(auth(await token()));
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Editor group');
    assert.equal(Object.keys(res.body.settings).length, EXCLUSIVES_ALERT_TYPES.length);
    const on = Object.values(res.body.settings).filter((m) => m !== 'off');
    assert.equal(on.length, 3);

    assert.equal(res.body.listings.length, 2);
    const canadian = res.body.listings.find((l: { asin: string }) => l.asin === 'B0000CA01');
    assert.equal(canadian.marketplace, 'Canada');
    assert.equal(canadian.sku, 'C-1');
    assert.equal(canadian.title, 'Canadian');
    assert.equal(canadian.lastCheckedAt, capturedAt.toISOString());
  });

  it('reports a listing never checked yet as having no title', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const id = await seedGroup({ name: 'Fresh' });
    await prisma.listing.create({
      data: { groupId: id, marketplace: 'USA', asin: 'B0NEW', sku: 'NEW-1', createdById: admin.id },
    });

    const res = await request(app)
      .get(`/api/exclusives/groups/${id}`)
      .set(auth(await token()));
    assert.equal(res.body.listings[0].title, null);
    assert.equal(res.body.listings[0].lastCheckedAt, null);
  });

  it('fills in every alert type even when the group has no setting rows', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const group = await prisma.alertGroup.create({
      data: { name: 'No settings', groupType: 'GROUP', createdById: admin.id },
    });

    const res = await request(app)
      .get(`/api/exclusives/groups/${group.id}`)
      .set(auth(await token()));
    assert.equal(res.status, 200);
    assert.equal(Object.keys(res.body.settings).length, EXCLUSIVES_ALERT_TYPES.length);
    assert.ok(Object.values(res.body.settings).every((m) => m === 'off'));
  });

  it('404s for a group that is not there, 400 for a nonsense id', async () => {
    const t = await token();
    assert.equal((await request(app).get('/api/exclusives/groups/9999').set(auth(t))).status, 404);
    assert.equal((await request(app).get('/api/exclusives/groups/abc').set(auth(t))).status, 400);
  });
});

describe('exclusives: summary (HLAI-71 7a)', () => {
  it('adds up the header numbers across every group', async () => {
    await seedGroup({
      name: 'Group one',
      asins: [
        { asin: 'B1', title: 'a' },
        { asin: 'B2', marketplace: 'Canada', title: 'b' },
      ],
      alertsAgedHours: [1, 30],
    });
    await seedGroup({
      name: 'Single',
      groupType: 'INDIVIDUAL',
      asins: [{ asin: 'B3', title: 'c' }],
      alertsAgedHours: [2],
    });

    const res = await request(app)
      .get('/api/exclusives/summary')
      .set(auth(await token()));
    assert.equal(res.status, 200);
    assert.equal(res.body.asinsMonitored, 3, 'US and Canada counted separately');
    assert.equal(res.body.groupCount, 1);
    assert.equal(res.body.individualCount, 1);
    assert.equal(res.body.alerts24h, 2, 'the 30-hour-old alert is outside the window');
    assert.equal(res.body.sweepEnabled, true);
    assert.equal(res.body.sweepMinutes, 30);
    assert.ok(res.body.lastSweepAt, 'the newest snapshot is the last check');
    assert.ok(res.body.nextSweepAt, 'a next run is due while sweeping is on');
  });

  it('reports nothing checked yet on an empty database', async () => {
    const res = await request(app)
      .get('/api/exclusives/summary')
      .set(auth(await token()));
    assert.equal(res.body.asinsMonitored, 0);
    assert.equal(res.body.groupCount, 0);
    assert.equal(res.body.individualCount, 0);
    assert.equal(res.body.alerts24h, 0);
    assert.equal(res.body.lastSweepAt, null);
  });

  it('needs a signed-in user', async () => {
    assert.equal((await request(app).get('/api/exclusives/summary')).status, 401);
  });
});

// --- 7b: the alert log ------------------------------------------------------

interface SeedAlert {
  asin?: string;
  title?: string;
  marketplace?: string;
  alertType?: string;
  groupId?: number | null;
  groupName?: string;
  createdAt?: Date;
}

async function seedAlert(a: SeedAlert = {}) {
  return prisma.alertLog.create({
    data: {
      groupId: a.groupId ?? null,
      alertType: a.alertType ?? 'PriceChanged',
      message: 'Something changed.',
      asin: a.asin ?? 'B0DEFAULT',
      marketplace: a.marketplace ?? 'USA',
      title: a.title ?? 'A product',
      groupName: a.groupName ?? 'Some group',
      createdAt: a.createdAt ?? new Date(),
    },
  });
}

const queryAlerts = async (body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/exclusives/alerts/query')
    .set(auth(await token()))
    .send(body);

const asins = (rows: { asin: string }[]): string[] => rows.map((r) => r.asin);

describe('exclusives: alert log (HLAI-71 7b)', () => {
  it('needs a signed-in user', async () => {
    assert.equal((await request(app).post('/api/exclusives/alerts/query').send({})).status, 401);
  });

  it('returns the whole row, newest first', async () => {
    const id = await seedGroup({ name: 'Fragrances', asins: [{ asin: 'B0OLD', title: 'Old' }] });
    await seedAlert({ asin: 'B0OLD', groupId: id, createdAt: hoursAgo(5) });
    await seedAlert({ asin: 'B0NEW', groupId: id, createdAt: hoursAgo(1) });

    const res = await queryAlerts();
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.deepEqual(asins(res.body.rows), ['B0NEW', 'B0OLD']);

    const row = res.body.rows[0];
    assert.equal(row.groupId, id);
    assert.equal(row.marketplace, 'USA');
    assert.equal(row.alertType, 'PriceChanged');
    assert.equal(row.message, 'Something changed.');
    assert.ok(row.createdAt);
  });

  it('keeps a stable order when two alerts share a timestamp', async () => {
    const at = hoursAgo(1);
    await seedAlert({ asin: 'B0FIRST', createdAt: at });
    await seedAlert({ asin: 'B0SECOND', createdAt: at });

    const first = await queryAlerts({ page: 1, pageSize: 1 });
    const second = await queryAlerts({ page: 2, pageSize: 1 });
    assert.deepEqual(asins(first.body.rows), ['B0SECOND'], 'newest id first');
    assert.deepEqual(asins(second.body.rows), ['B0FIRST'], 'and never repeated');
  });

  it('filters by alert type', async () => {
    await seedAlert({ asin: 'B0PRICE', alertType: 'PriceChanged' });
    await seedAlert({ asin: 'B0BUYBOX', alertType: 'BuyBoxLost' });
    await seedAlert({ asin: 'B0TITLE', alertType: 'TitleChanged' });

    const res = await queryAlerts({ alertTypes: ['BuyBoxLost', 'TitleChanged'] });
    assert.equal(res.body.total, 2);
    assert.deepEqual(asins(res.body.rows).sort(), ['B0BUYBOX', 'B0TITLE']);
  });

  it('filters by group - the Groups screen link', async () => {
    const mine = await seedGroup({ name: 'Mine' });
    const other = await seedGroup({ name: 'Other' });
    await seedAlert({ asin: 'B0MINE', groupId: mine });
    await seedAlert({ asin: 'B0OTHER', groupId: other });

    const res = await queryAlerts({ groupIds: [mine] });
    assert.deepEqual(asins(res.body.rows), ['B0MINE']);
  });

  it('filters by marketplace', async () => {
    await seedAlert({ asin: 'B0US', marketplace: 'USA' });
    await seedAlert({ asin: 'B0CA', marketplace: 'Canada' });

    const res = await queryAlerts({ marketplaces: ['Canada'] });
    assert.deepEqual(asins(res.body.rows), ['B0CA']);
  });

  it('treats both date bounds as inclusive', async () => {
    const from = new Date('2026-09-10T00:00:00.000Z');
    const to = new Date('2026-09-12T00:00:00.000Z');
    await seedAlert({ asin: 'B0BEFORE', createdAt: new Date('2026-09-09T23:59:59.000Z') });
    await seedAlert({ asin: 'B0ONFROM', createdAt: from });
    await seedAlert({ asin: 'B0MIDDLE', createdAt: new Date('2026-09-11T12:00:00.000Z') });
    await seedAlert({ asin: 'B0ONTO', createdAt: to });
    await seedAlert({ asin: 'B0AFTER', createdAt: new Date('2026-09-12T00:00:01.000Z') });

    const res = await queryAlerts({ from: from.toISOString(), to: to.toISOString() });
    assert.deepEqual(asins(res.body.rows).sort(), ['B0MIDDLE', 'B0ONFROM', 'B0ONTO']);

    const onlyFrom = await queryAlerts({ from: to.toISOString() });
    assert.deepEqual(asins(onlyFrom.body.rows).sort(), ['B0AFTER', 'B0ONTO']);
  });

  it('searches ASIN, product title and group name', async () => {
    await seedAlert({ asin: 'B0RASASI', title: 'Rasasi Blue', groupName: 'Fragrances' });
    await seedAlert({ asin: 'B0VITAMIN', title: 'Vitamin C', groupName: 'Supplements' });

    assert.deepEqual(asins((await queryAlerts({ text: 'B0RASASI' })).body.rows), ['B0RASASI']);
    assert.deepEqual(asins((await queryAlerts({ text: 'vitamin c' })).body.rows), ['B0VITAMIN']);
    assert.deepEqual(asins((await queryAlerts({ text: 'fragr' })).body.rows), ['B0RASASI']);
    assert.equal((await queryAlerts({ text: 'nothing here' })).body.total, 0);
  });

  it('combines filters rather than widening the result', async () => {
    const id = await seedGroup({ name: 'Mixed' });
    await seedAlert({ asin: 'B0KEEP', groupId: id, alertType: 'BuyBoxLost', marketplace: 'USA' });
    await seedAlert({ asin: 'B0TYPE', groupId: id, alertType: 'PriceChanged', marketplace: 'USA' });
    await seedAlert({ asin: 'B0MKT', groupId: id, alertType: 'BuyBoxLost', marketplace: 'Canada' });
    await seedAlert({ asin: 'B0GROUP', alertType: 'BuyBoxLost', marketplace: 'USA' });

    const res = await queryAlerts({
      groupIds: [id],
      alertTypes: ['BuyBoxLost'],
      marketplaces: ['USA'],
    });
    assert.deepEqual(asins(res.body.rows), ['B0KEEP']);
  });

  it('pages through the log', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedAlert({ asin: `B0${i}`, createdAt: hoursAgo(i) });
    }
    const first = await queryAlerts({ page: 1, pageSize: 2 });
    assert.equal(first.body.total, 5);
    assert.deepEqual(asins(first.body.rows), ['B00', 'B01']);

    const last = await queryAlerts({ page: 3, pageSize: 2 });
    assert.deepEqual(asins(last.body.rows), ['B04']);
  });

  it('keeps a deleted group\u2019s alerts, with the name it had', async () => {
    const id = await seedGroup({ name: 'Doomed', asins: [{ asin: 'B0GONE', title: 'Gone' }] });
    await seedAlert({ asin: 'B0GONE', groupId: id, groupName: 'Doomed' });

    await prisma.alertGroup.delete({ where: { id } });

    const res = await queryAlerts();
    assert.equal(res.body.total, 1, 'the alert survives its group');
    const row = res.body.rows[0];
    assert.equal(row.groupId, null, 'no longer linked');
    assert.equal(row.groupName, 'Doomed', 'but still readable');
    assert.equal(row.asin, 'B0GONE');
    assert.equal(row.listingId, null, 'its listing went with the group');
  });

  it('rejects a malformed query body', async () => {
    const res = await request(app)
      .post('/api/exclusives/alerts/query')
      .set(auth(await token()))
      .send({ alertTypes: ['NotAnAlertType'] });
    assert.equal(res.status, 400);
    assert.ok(res.body.details, 'field errors returned');
  });
});

// --- 7c: resolving ASINs against the seller account -------------------------

/** A listing Amazon would return for this ASIN. */
const amazonListing = (asin: string, sku: string, title = `Item ${asin}`): ListingItem => ({
  sku,
  summaries: [{ asin, itemName: title, status: ['BUYABLE'] }],
});

const lookup = async (body: Record<string, unknown>) =>
  request(app)
    .post('/api/exclusives/listings/lookup')
    .set(auth(await token()))
    .send(body);

const listingRequests = (requests: string[]): number =>
  requests.filter((path) => path.startsWith('/listings/')).length;

describe('exclusives: ASIN lookup (HLAI-71 7c)', () => {
  beforeEach(() => {
    // Both outlive the database reset, so a stale entry would leak between tests.
    __resetLookupCache();
    // Real pacing is 5 listings calls a second; tests do not need to wait.
    __resetSharedPacers({ listings: 1000, pricing: 1000, catalog: 1000 });
  });

  afterEach(() => __resetHttpHooks());

  it('needs a signed-in user', async () => {
    const res = await request(app)
      .post('/api/exclusives/listings/lookup')
      .send({ asins: ['B000000001'] });
    assert.equal(res.status, 401);
  });

  it('finds an ASIN on the seller account, with its code and title', async () => {
    fakeAmazon({ items: [amazonListing('B000000001', 'SOM-4004', 'A real product')] });

    const res = await lookup({ asins: ['b000000001'], marketplaces: ['USA'] });
    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 1);

    const result = res.body.results[0];
    assert.equal(result.asin, 'B000000001', 'upper-cased');
    assert.equal(result.status, 'found');
    assert.equal(result.listings.length, 1);
    assert.equal(result.listings[0].marketplace, 'USA');
    assert.equal(result.listings[0].sku, 'SOM-4004');
    assert.equal(result.listings[0].title, 'A real product');
    assert.equal(result.listings[0].groupId, null);
  });

  it('reports an ASIN the account does not list', async () => {
    fakeAmazon({ items: [] });
    const res = await lookup({ asins: ['B000000002'], marketplaces: ['USA'] });
    assert.equal(res.body.results[0].status, 'not-listed');
    assert.deepEqual(res.body.results[0].listings, []);
  });

  it('answers an already-monitored ASIN from our own data, with no Amazon call', async () => {
    await seedGroup({
      name: 'Existing group',
      asins: [{ asin: 'B000000003', sku: 'OLD-1', title: 'Already watched' }],
    });
    const { requests } = fakeAmazon({ items: [amazonListing('B000000003', 'OLD-1')] });

    const res = await lookup({ asins: ['B000000003'], marketplaces: ['USA'] });
    const result = res.body.results[0];
    assert.equal(result.status, 'already-monitored');
    assert.equal(result.listings[0].groupName, 'Existing group');
    assert.equal(result.listings[0].sku, 'OLD-1');
    assert.equal(result.listings[0].title, 'Already watched');
    assert.equal(listingRequests(requests), 0, 'Amazon was never asked');
    assert.equal(res.body.amazonCalls, 0);
  });

  it('prefers the seller\u2019s real code over a fulfilment leftover', async () => {
    fakeAmazon({
      items: [
        amazonListing('B000000004', 'FBA1963N2SPT.missing1'),
        amazonListing('B000000004', 'SOM-4004'),
      ],
    });
    const res = await lookup({ asins: ['B000000004'], marketplaces: ['USA'] });
    assert.equal(res.body.results[0].listings[0].sku, 'SOM-4004');
  });

  it('checks both marketplaces when none is named', async () => {
    fakeAmazon({ items: [amazonListing('B000000005', 'C-1')] });
    const res = await lookup({ asins: ['B000000005'] });
    const result = res.body.results[0];
    assert.equal(result.status, 'found');
    assert.deepEqual(
      result.listings.map((l: { marketplace: string }) => l.marketplace).sort(),
      ['Canada', 'USA'],
      'the fake lists it in both',
    );
  });

  it('asks Amazon in batches of twenty', async () => {
    const asins = Array.from({ length: 25 }, (_, i) => `B${String(i).padStart(9, '0')}`);
    const { requests } = fakeAmazon({ items: asins.map((a) => amazonListing(a, `SKU-${a}`)) });

    const res = await lookup({ asins, marketplaces: ['USA'] });
    assert.equal(res.body.results.length, 25);
    assert.equal(listingRequests(requests), 2, '20 then 5');
  });

  it('remembers recent answers, so a repeat costs nothing', async () => {
    const { requests } = fakeAmazon({ items: [amazonListing('B000000006', 'SKU-6')] });

    const first = await lookup({ asins: ['B000000006'], marketplaces: ['USA'] });
    assert.equal(first.body.amazonCalls, 1);
    const after = listingRequests(requests);

    const second = await lookup({ asins: ['B000000006'], marketplaces: ['USA'] });
    assert.equal(second.body.results[0].status, 'found');
    assert.equal(second.body.amazonCalls, 0);
    assert.equal(listingRequests(requests), after, 'no further request');
  });

  it('remembers a not-listed answer too, so a typo is not asked twice', async () => {
    const { requests } = fakeAmazon({ items: [] });
    await lookup({ asins: ['B0TYPO0000'], marketplaces: ['USA'] });
    const after = listingRequests(requests);

    const second = await lookup({ asins: ['B0TYPO0000'], marketplaces: ['USA'] });
    assert.equal(second.body.results[0].status, 'not-listed');
    assert.equal(listingRequests(requests), after);
  });

  it('marks a marketplace Amazon could not answer as unavailable, never as not-listed', async () => {
    fakeAmazon({
      items: [amazonListing('B000000007', 'C-7')],
      failListings: (marketplaceId) => marketplaceId === 'ATVPDKIKX0DER',
    });

    const res = await lookup({ asins: ['B000000007', 'B000000008'] });
    const listed = res.body.results.find((r: { asin: string }) => r.asin === 'B000000007');
    const missing = res.body.results.find((r: { asin: string }) => r.asin === 'B000000008');

    // Canada still answered, so this one is usable.
    assert.equal(listed.status, 'found');
    assert.deepEqual(
      listed.listings.map((l: { marketplace: string }) => l.marketplace),
      ['Canada'],
    );
    // Nothing found anywhere AND one marketplace failed: temporary, not final.
    assert.equal(missing.status, 'unavailable');
  });

  it('does not remember an unavailable answer', async () => {
    fakeAmazon({ items: [], failListings: () => true });
    const first = await lookup({ asins: ['B000000009'], marketplaces: ['USA'] });
    assert.equal(first.body.results[0].status, 'unavailable');

    // Amazon recovers: the next lookup must ask again rather than repeat itself.
    const { requests } = fakeAmazon({ items: [amazonListing('B000000009', 'SKU-9')] });
    const second = await lookup({ asins: ['B000000009'], marketplaces: ['USA'] });
    assert.equal(second.body.results[0].status, 'found');
    assert.ok(listingRequests(requests) > 0, 'it asked again');
  });

  it('reports malformed entries separately and still resolves the rest', async () => {
    fakeAmazon({ items: [amazonListing('B000000010', 'SKU-10')] });
    const res = await lookup({
      asins: ['B000000010', 'not-an-asin', 'B000000010', '  '],
      marketplaces: ['USA'],
    });
    assert.equal(res.body.results.length, 1, 'de-duplicated, blanks dropped');
    assert.deepEqual(res.body.invalid, ['NOT-AN-ASIN']);
  });

  it('refuses more ASINs than one request may carry', async () => {
    const asins = Array.from({ length: 501 }, (_, i) => `B${String(i).padStart(9, '0')}`);
    const res = await lookup({ asins, marketplaces: ['USA'] });
    assert.equal(res.status, 400);
  });
});

// --- 7d: creating, editing and deleting groups; the two downloads ------------

const api = async () => auth(await token());

const createGroup = async (body: Record<string, unknown>) =>
  request(app)
    .post('/api/exclusives/groups')
    .set(await api())
    .send(body);

const patchGroup = async (id: number, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/exclusives/groups/${id}`)
    .set(await api())
    .send(body);

const us = (asin: string) => ({ asin, marketplace: 'USA' });

describe('exclusives: group writes (HLAI-71 7d)', () => {
  beforeEach(() => {
    __resetLookupCache();
    __resetSharedPacers({ listings: 1000, pricing: 1000, catalog: 1000 });
  });

  afterEach(() => __resetHttpHooks());

  it('creates a group with every alert type off by default', async () => {
    fakeAmazon({ items: [amazonListing('B000000101', 'SKU-101', 'A product')] });

    const res = await createGroup({
      name: 'New group',
      groupType: 'GROUP',
      listings: [us('B000000101')],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'New group');
    assert.equal(res.body.listings.length, 1);
    assert.equal(res.body.listings[0].sku, 'SKU-101');
    assert.equal(Object.keys(res.body.settings).length, EXCLUSIVES_ALERT_TYPES.length);
    assert.ok(
      Object.values(res.body.settings).every((m) => m === 'off'),
      'nothing is switched on until someone asks for it',
    );
  });

  it('creates a group with chosen alert types on', async () => {
    fakeAmazon({ items: [amazonListing('B000000102', 'SKU-102')] });
    const res = await createGroup({
      name: 'Watching prices',
      groupType: 'GROUP',
      listings: [us('B000000102')],
      settings: { PriceChanged: 'immediate', BuyBoxLost: 'daily' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.settings.PriceChanged, 'immediate');
    assert.equal(res.body.settings.BuyBoxLost, 'daily');
    assert.equal(res.body.settings.TitleChanged, 'off');
  });

  it('names an individual after the Amazon title', async () => {
    fakeAmazon({ items: [amazonListing('B000000103', 'SKU-103', 'Rasasi Blue 75ml')] });
    const res = await createGroup({
      groupType: 'INDIVIDUAL',
      listings: [us('B000000103')],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Rasasi Blue 75ml');
  });

  it('refuses an individual with two ASINs, and a group with no name', async () => {
    fakeAmazon({
      items: [amazonListing('B000000104', 'SKU-104'), amazonListing('B000000105', 'SKU-105')],
    });

    const twoAsins = await createGroup({
      groupType: 'INDIVIDUAL',
      listings: [us('B000000104'), us('B000000105')],
    });
    assert.equal(twoAsins.status, 400);

    const noName = await createGroup({ groupType: 'GROUP', listings: [us('B000000104')] });
    assert.equal(noName.status, 400);
    assert.ok(noName.body.details.name, 'the name box is flagged');
  });

  it('refuses a duplicate name with a field error, not a bare conflict', async () => {
    await seedGroup({ name: 'Taken' });
    fakeAmazon({ items: [] });

    const res = await createGroup({ name: 'Taken', groupType: 'GROUP', listings: [] });
    assert.equal(res.status, 409);
    assert.equal(res.body.details.code, 'DUPLICATE_NAME');
    assert.ok(res.body.details.name, 'the name box is flagged');
  });

  it('refuses an ASIN that is not on the seller account, naming the row', async () => {
    fakeAmazon({ items: [] });
    const res = await createGroup({
      name: 'Bad import',
      groupType: 'GROUP',
      listings: [us('B000000106')],
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.details.listings, [
      { asin: 'B000000106', marketplace: 'USA', reason: 'not-listed' },
    ]);
    assert.equal(await prisma.alertGroup.count(), 0, 'nothing was created');
  });

  it('refuses the whole save when Amazon did not answer, and says it is temporary', async () => {
    fakeAmazon({ items: [], failListings: () => true });
    const res = await createGroup({
      name: 'Amazon down',
      groupType: 'GROUP',
      listings: [us('B000000107')],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.details.code, 'AMAZON_UNAVAILABLE');
    assert.equal(res.body.details.listings[0].reason, 'unavailable');
    assert.equal(await prisma.alertGroup.count(), 0, 'nothing was created');
  });

  it('refuses an ASIN another group holds, then moves it when asked', async () => {
    const oldGroup = await seedGroup({
      name: 'Old home',
      asins: [{ asin: 'B000000108', sku: 'SKU-108', title: 'Moving product' }],
    });
    const listingBefore = await prisma.listing.findFirstOrThrow({ where: { asin: 'B000000108' } });
    await prisma.alertLog.create({
      data: {
        groupId: oldGroup,
        listingId: listingBefore.id,
        alertType: 'PriceChanged',
        message: 'Changed.',
        asin: 'B000000108',
        marketplace: 'USA',
        title: 'Moving product',
        groupName: 'Old home',
      },
    });
    fakeAmazon({ items: [amazonListing('B000000108', 'SKU-108')] });

    const refused = await createGroup({
      name: 'New home',
      groupType: 'GROUP',
      listings: [us('B000000108')],
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.details.code, 'LISTING_IN_ANOTHER_GROUP');
    assert.equal(refused.body.details.clashes[0].groupName, 'Old home');

    const moved = await createGroup({
      name: 'New home',
      groupType: 'GROUP',
      listings: [us('B000000108')],
      moveExisting: true,
    });
    assert.equal(moved.status, 201);

    const listingAfter = await prisma.listing.findFirstOrThrow({ where: { asin: 'B000000108' } });
    assert.equal(listingAfter.id, listingBefore.id, 'the same row moved, not a new one');
    assert.equal(listingAfter.groupId, moved.body.id);
    const alert = await prisma.alertLog.findFirstOrThrow({ where: { asin: 'B000000108' } });
    assert.equal(alert.listingId, listingBefore.id, 'its history came with it');
  });

  it('adds an ASIN without touching the rest (merge)', async () => {
    const id = await seedGroup({
      name: 'Growing',
      asins: [{ asin: 'B000000109', sku: 'SKU-109', title: 'First' }],
    });
    fakeAmazon({
      items: [amazonListing('B000000109', 'SKU-109'), amazonListing('B000000110', 'SKU-110')],
    });

    const res = await patchGroup(id, {
      name: 'Growing',
      groupType: 'GROUP',
      listings: [us('B000000109'), us('B000000110')],
      listingsMode: 'merge',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.listings.length, 2);
  });

  it('replace drops what is missing and keeps the survivors\u2019 saved data', async () => {
    const id = await seedGroup({
      name: 'Replacing',
      asins: [
        { asin: 'B000000111', sku: 'SKU-111', title: 'Kept' },
        { asin: 'B000000112', sku: 'SKU-112', title: 'Dropped' },
      ],
    });
    const kept = await prisma.listing.findFirstOrThrow({ where: { asin: 'B000000111' } });
    fakeAmazon({ items: [amazonListing('B000000111', 'SKU-111')] });

    const res = await patchGroup(id, {
      name: 'Replacing',
      groupType: 'GROUP',
      listings: [us('B000000111')],
      listingsMode: 'replace',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.listings.length, 1);
    assert.equal(res.body.listings[0].asin, 'B000000111');

    const survivor = await prisma.listing.findFirstOrThrow({ where: { asin: 'B000000111' } });
    assert.equal(survivor.id, kept.id, 'not deleted and recreated');
    const snapshots = await prisma.listingSnapshot.count({ where: { listingId: kept.id } });
    assert.equal(snapshots, 1, 'its saved data is intact');
    assert.equal(await prisma.listing.count({ where: { asin: 'B000000112' } }), 0);
  });

  it('never replaces while Amazon is failing, so nothing is lost', async () => {
    const id = await seedGroup({
      name: 'At risk',
      asins: [
        { asin: 'B000000113', sku: 'SKU-113', title: 'One' },
        { asin: 'B000000114', sku: 'SKU-114', title: 'Two' },
      ],
    });
    fakeAmazon({ items: [], failListings: () => true });

    const res = await patchGroup(id, {
      name: 'At risk',
      groupType: 'GROUP',
      listings: [us('B000000115')],
      listingsMode: 'replace',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.details.code, 'AMAZON_UNAVAILABLE');
    assert.equal(
      await prisma.listing.count({ where: { groupId: id } }),
      2,
      'both products still monitored',
    );
  });

  it('refuses a stale edit', async () => {
    const id = await seedGroup({ name: 'Concurrent' });
    fakeAmazon({ items: [] });

    const res = await patchGroup(id, {
      name: 'Concurrent renamed',
      groupType: 'GROUP',
      listings: [],
      expectedUpdatedAt: new Date('2020-01-01T00:00:00.000Z').toISOString(),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.details.code, 'STALE_WRITE');
  });

  it('moves the Updated column even when only the ASINs changed', async () => {
    const id = await seedGroup({
      name: 'Timestamped',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    fakeAmazon({ items: [amazonListing('B000000116', 'SKU-116')] });

    const res = await patchGroup(id, {
      name: 'Timestamped',
      groupType: 'GROUP',
      listings: [us('B000000116')],
      listingsMode: 'replace',
    });
    assert.equal(res.status, 200);
    assert.ok(
      new Date(res.body.updatedAt).getTime() > new Date('2026-01-01T00:00:00.000Z').getTime(),
      'the concurrency token moved',
    );
  });

  it('deletes a group but keeps its alerts readable', async () => {
    const id = await seedGroup({
      name: 'Doomed group',
      asins: [{ asin: 'B000000117', sku: 'SKU-117', title: 'Gone soon' }],
    });
    await seedAlert({ asin: 'B000000117', groupId: id, groupName: 'Doomed group' });

    const res = await request(app)
      .delete(`/api/exclusives/groups/${id}`)
      .set(await api());
    assert.equal(res.status, 204);

    assert.equal(await prisma.alertGroup.count({ where: { id } }), 0);
    assert.equal(await prisma.listing.count({ where: { asin: 'B000000117' } }), 0);
    const alert = await prisma.alertLog.findFirstOrThrow({ where: { asin: 'B000000117' } });
    assert.equal(alert.groupId, null);
    assert.equal(alert.groupName, 'Doomed group');
  });

  it('404s when editing or deleting a group that is not there', async () => {
    fakeAmazon({ items: [] });
    const patched = await patchGroup(9999, { name: 'Nope', groupType: 'GROUP', listings: [] });
    assert.equal(patched.status, 404);
    const deleted = await request(app)
      .delete('/api/exclusives/groups/9999')
      .set(await api());
    assert.equal(deleted.status, 404);
  });

  it('needs a signed-in user', async () => {
    const res = await request(app)
      .post('/api/exclusives/groups')
      .send({ name: 'x', groupType: 'GROUP', listings: [] });
    assert.equal(res.status, 401);
  });
});

describe('exclusives: downloads (HLAI-71 7d)', () => {
  it('downloads the alert log as CSV, with the screen\u2019s filters applied', async () => {
    const id = await seedGroup({ name: 'Exported' });
    await seedAlert({
      asin: 'B000000118',
      title: 'A "quoted", comma-laden name',
      groupId: id,
      groupName: 'Exported',
      alertType: 'BuyBoxLost',
      createdAt: new Date('2026-09-20T15:30:00.000Z'),
    });
    await seedAlert({ asin: 'B000000119', alertType: 'PriceChanged' });

    const res = await request(app)
      .post('/api/exclusives/alerts/export')
      .set(await api())
      .send({ alertTypes: ['BuyBoxLost'], timeZone: 'UTC' });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="exclusives-alerts-/);

    const body = res.text;
    assert.ok(body.startsWith('\uFEFF'), 'a byte-order mark, so Excel reads it correctly');
    const lines = body.replace('\uFEFF', '').trim().split('\r\n');
    assert.equal(lines.length, 2, 'a header and the one matching alert');
    assert.match(lines[0] as string, /^Date,ASIN,Marketplace,Product,Group,Alert type/);
    assert.match(lines[1] as string, /^2026-09-20 15:30,B000000118,United States,/);
    assert.match(lines[1] as string, /"A ""quoted"", comma-laden name"/, 'quotes are escaped');
  });

  it('formats download dates in the viewer\u2019s time zone', async () => {
    await seedAlert({ asin: 'B000000120', createdAt: new Date('2026-09-20T23:30:00.000Z') });

    const res = await request(app)
      .post('/api/exclusives/alerts/export')
      .set(await api())
      .send({ timeZone: 'Asia/Karachi' });
    assert.match(res.text, /2026-09-21 04:30/, 'UTC+5');
  });

  it('writes midnight as 00:00, not 24:00', async () => {
    await seedAlert({ asin: 'B000000122', createdAt: new Date('2026-09-20T19:05:00.000Z') });

    const res = await request(app)
      .post('/api/exclusives/alerts/export')
      .set(await api())
      .send({ timeZone: 'Asia/Karachi' });
    assert.match(res.text, /2026-09-21 00:05/, 'UTC+5 puts it just past midnight');
  });

  it('downloads a group\u2019s ASIN list', async () => {
    const id = await seedGroup({
      name: 'Listed',
      asins: [
        {
          asin: 'B000000121',
          marketplace: 'USA',
          sku: 'SKU-121',
          title: 'A product',
          capturedAt: new Date('2026-09-21T10:00:00.000Z'),
        },
      ],
    });

    const res = await request(app)
      .post(`/api/exclusives/groups/${id}/export`)
      .set(await api())
      .send({ timeZone: 'UTC' });

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    const lines = res.text.replace('\uFEFF', '').trim().split('\r\n');
    assert.equal(lines[0], 'ASIN,Marketplace,Seller SKU,Product,Last checked');
    assert.equal(lines[1], 'B000000121,United States,SKU-121,A product,2026-09-21 10:00');
  });

  it('404s downloading a group that is not there', async () => {
    const res = await request(app)
      .post('/api/exclusives/groups/9999/export')
      .set(await api())
      .send({});
    assert.equal(res.status, 404);
  });
});
