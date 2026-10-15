import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerInApi } from '../../src/config/email-config.js';
import { deliverySummary, runsEmailWorker } from '../../src/config/startup-checks.js';

describe('EMAIL_WORKER_IN_API', () => {
  it('is on unless set to "false"', () => {
    assert.equal(parseWorkerInApi(undefined), true);
    assert.equal(parseWorkerInApi(''), true);
    assert.equal(parseWorkerInApi('true'), true);
    assert.equal(parseWorkerInApi('false'), false);
  });

  it('refuses anything else, so a typo fails at boot', () => {
    assert.throws(() => parseWorkerInApi('yes'), /must be "true" or "false"/);
    assert.throws(() => parseWorkerInApi('False'), /must be "true" or "false"/);
  });
});

describe('who sends the API’s emails', () => {
  it('runs the email worker in the API only when queueing with the switch on', () => {
    assert.equal(runsEmailWorker('queue', true), true);
    assert.equal(runsEmailWorker('queue', false), false);
    assert.equal(runsEmailWorker('direct', true), false);
    assert.equal(runsEmailWorker('direct', false), false);
  });

  it('says so on every boot', () => {
    assert.match(deliverySummary('queue', true), /inside this API/);
    assert.match(deliverySummary('queue', false), /separate email worker/);
    assert.equal(deliverySummary('direct', true), 'email delivery: direct');
  });
});
