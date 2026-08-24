'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRecorder } = require('../src/engine/recorder.js');
const { start: startSession } = require('../src/engine/session.js');
const { startFixtureServer } = require('./fixtures/serve.js');

test('createRecorder: captures goto/fill/click steps while driving the page programmatically', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const recorder = createRecorder();
  await recorder.start({ url: fixture.url });
  t.after(async () => {
    if (recorder.isRunning()) await recorder.stop();
  });

  const page = recorder._page;
  assert.ok(page, 'recorder exposes _page for tests');

  await page.click('#email');
  await page.fill('#email', 'a@b.c');
  await page.click('#signin');

  // Give the blur/debounce handling in the injected recorder a moment to flush.
  await page.waitForTimeout(300);

  const steps = await recorder.stop();

  assert.equal(steps[0].type, 'goto');
  assert.equal(steps[0].value, fixture.url);
  assert.equal(steps[0].name, `Navigate to ${fixture.url}`);

  const fillStep = steps.find((s) => s.type === 'fill' && s.selector === '#email');
  assert.ok(fillStep, 'expected a fill step for #email');
  assert.equal(fillStep.value, 'a@b.c');

  const clickStep = steps.find((s) => s.type === 'click' && s.selector === '#signin');
  assert.ok(clickStep, 'expected a click step for #signin');

  assert.equal(recorder.isRunning(), false);
});

test('createRecorder: password fields record "********" literally, never the real value', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const recorder = createRecorder();
  await recorder.start({ url: fixture.url });
  t.after(async () => {
    if (recorder.isRunning()) await recorder.stop();
  });

  const page = recorder._page;
  await page.click('#password');
  await page.fill('#password', 'super-secret');
  await page.click('#signin');
  await page.waitForTimeout(300);

  const steps = await recorder.stop();

  const passwordStep = steps.find((s) => s.type === 'fill' && s.selector === '#password');
  assert.ok(passwordStep, 'expected a fill step for #password');
  assert.equal(passwordStep.value, '********');
  assert.equal(passwordStep.name, 'Input password');
});

test('createRecorder: a mid-typing pause > 500ms does not emit a partial fill (flush only on blur/Enter)', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const recorder = createRecorder();
  await recorder.start({ url: fixture.url });
  t.after(async () => {
    if (recorder.isRunning()) await recorder.stop();
  });

  const page = recorder._page;
  const email = page.locator('#email');
  await email.click();
  await email.type('ab');

  // Pause well past the old 500ms debounce window before continuing to
  // type. A timer-based flush would have fired here and recorded a
  // premature `fill` with the partial value "ab".
  await page.waitForTimeout(700);

  await email.type('c@d.e');
  await page.click('#signin');
  await page.waitForTimeout(300);

  const steps = await recorder.stop();
  const fillSteps = steps.filter((s) => s.type === 'fill' && s.selector === '#email');

  assert.equal(fillSteps.length, 1, 'expected exactly one fill step for #email despite the mid-typing pause');
  assert.equal(fillSteps[0].value, 'abc@d.e');
});

test('session.start: capturing a login session resolves storageState JSON on finish()', async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());

  const session = startSession({ loginUrl: fixture.url });
  await session.finish();

  const storageStateJson = await session.finished;
  const parsed = JSON.parse(storageStateJson);
  assert.ok(Array.isArray(parsed.cookies));
  assert.ok(Array.isArray(parsed.origins));
});
