import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const repo = '/home/henry/patternlike-app-source-map';
const directory = '/tmp/patternlike-reader-journey-qa';
const read = async path => JSON.parse(await readFile(`${repo}/${path}`, 'utf8'));
const reading = await read('contracts/m5/fixtures/valid/daily-reading.published.json');
reading.local_date = '2026-09-09';
reading.reading_id = 'rd_qa_today';
reading.paragraphs = reading.paragraphs.slice(0, 2);
const today = { schema_version: '0.5.0', reading, evidence_url: `/v1/readings/${reading.reading_id}/evidence` };
const chart = await read('contracts/m0/fixtures/valid/chart-snapshot.exact.json');
chart.birth = { accuracy: 'exact', utc_instant: null, timezone: null, place_label: null, latitude: null, longitude: null };
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], warnings = [], requests = [], unknown = [];
    let feedback = null, categorical = null;
    const target = { reading_id: reading.reading_id, revision: reading.revision, content_hash: 'sha256:' + 'a'.repeat(64), paragraph_id: null };
    const categoryOptions = () => ({ schema_version: 'reading-feedback-options/v1', target, feedback_use_policy_version: 'categorized-feedback-use/v1', expected_grant_state: 'grant-qa', grant_action: viewport.width === 390 ? 'renew' : 'create', categories: ['repetitive', 'not_relevant_today', 'unclear'], effect_window_days: 7, retention_months: 24, generation_effects_active: viewport.width === 390, latest_event: categorical });
    page.on('pageerror', error => errors.push(error.stack));
    page.on('console', message => {
      if (message.type() === 'warning') warnings.push(message.text());
      if (message.type() === 'error' && !/status of 404/.test(message.text())) errors.push(message.text());
    });
    await page.route('**/v1/**', async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      requests.push({ path, method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null });
      const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/v1/chart') return send(chart);
      if (path.startsWith('/v1/preferences/')) return send({});
      if (path === '/v1/readings/today' || path === `/v1/readings/${reading.reading_id}`) return send(today);
      if (path === '/v1/readings') return send({ schema_version: '0.8.0', view: 'history', next_cursor: null, items: [{ reading_id: reading.reading_id, local_date: reading.local_date, revision: reading.revision, revision_reason: 'initial', status: 'published', assembly_mode: 'deterministic', headline: null, saved: false, saved_at: null, evidence_url: today.evidence_url }] });
      if (path.endsWith('/save')) return send({ schema_version: '0.8.0', reading_id: reading.reading_id, saved: false, saved_at: null });
      if (path.endsWith('/feedback-options')) return send(categoryOptions());
      if (path.endsWith('/feedback-events')) {
        const body = JSON.parse(req.postData());
        categorical = { schema_version: 'reading-feedback-event-receipt/v1', id: 'event_qa', target, category: body.category, created_at: '2026-09-09T12:00:00Z', retention_expires_at: '2028-09-09T12:00:00Z', effect_expires_at: body.category === 'unclear' ? null : '2026-09-16T12:00:00Z', feedback_use_policy_version: 'categorized-feedback-use/v1' };
        return send(categorical, 201);
      }
      if (path === '/v1/consents/account-processing') return send({});
      if (path.endsWith('/feedback')) {
        if (req.method() === 'GET') return send(feedback ?? { error: { code: 'feedback_not_found', message: 'No previous response' } }, feedback ? 200 : 404);
        feedback = { id: 'feedback_qa', reading_id: reading.reading_id, resonance: JSON.parse(req.postData()).resonance, relevance_labels: [], created_at: '2026-09-09T12:00:00Z' };
        return send(feedback, 201);
      }
      if (path === '/v1/consents/ai-synthesis') return send({ kind: 'ai_synthesis', status: 'granted', enabled_categories: ['enabled_personal_context'], granted_at: '2026-09-09T11:00:00Z' });
      if (path === '/v1/context-sources') return send({ schema_version: '0.2.0', sources: [{ source_id: 'USR-06', enabled: true, permission_state: 'active' }] });
      if (path === '/v1/check-ins') return send({ freshness: { expires_at: '2026-09-10T12:00:00Z' } }, 201);
      unknown.push({ path, method: req.method() });
      return send({ error: { code: 'fixture_missing', message: path } }, 404);
    });
    const overflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto('http://127.0.0.1:5173/#today');
    await page.getByText(reading.paragraphs[0].text, { exact: true }).waitFor();
    assert.match(await page.title(), /Pattern/i);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    await overflow();
    await page.screenshot({ path: `${directory}/categories-${viewport.width}-first.png` });
    const feedbackRegion = page.getByRole('region', { name: 'Respond to this chapter', exact: true });
    const checkIn = page.getByRole('region', { name: 'How are you arriving?', exact: true });
    await feedbackRegion.scrollIntoViewIfNeeded();
    await checkIn.getByRole('radio', { name: /Steady/ }).waitFor();
    await page.screenshot({ path: `${directory}/categories-${viewport.width}-forms.png` });
    await feedbackRegion.getByRole('radio', { name: 'Repetitive', exact: true }).focus();
    await page.keyboard.press('Space');
    await feedbackRegion.getByRole('button', { name: 'Add a note', exact: true }).click();
    await feedbackRegion.getByRole('textbox', { name: 'Optional note', exact: true }).fill('A fictional QA note.');
    await checkIn.getByRole('radio', { name: /Steady/ }).check();
    await feedbackRegion.getByRole('button', { name: 'Send response' }).click();
    await feedbackRegion.getByRole('status', { name: 'Categorical feedback receipt' }).waitFor();
    assert.match(await feedbackRegion.innerText(), /Recorded for this chapter/);
    assert.match(await feedbackRegion.innerText(), viewport.width === 390 ? /Eligibility does not establish/ : /Generation use is currently off/);
    assert.equal(requests.filter(request => request.path === '/v1/check-ins').length, 0);
    assert.equal(await checkIn.getByRole('radio', { name: /Steady/ }).isChecked(), true);
    await checkIn.getByRole('button', { name: 'Keep this', exact: true }).click();
    await checkIn.getByRole('button', { name: 'Edit', exact: true }).waitFor();
    assert.deepEqual(requests.find(request => request.path === '/v1/check-ins').body, { energy: 'medium', expires_in_seconds: 86400 });
    const writes = requests.filter(request => request.path.endsWith('/feedback-events') && request.method === 'POST');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `/v1/readings/${reading.reading_id}/feedback-events`);
    assert.equal(writes[0].body.category, 'repetitive');
    assert.equal(writes[0].body.note, 'A fictional QA note.');
    assert.equal(writes[0].body.content_hash, target.content_hash);
    assert.equal(writes[0].body.confirm_feedback_use, true);
    assert.equal(Object.hasOwn(writes[0].body, 'resonance'), false);
    for (const paragraph of reading.paragraphs) assert.equal(await page.getByText(paragraph.text, { exact: true }).count(), 1);
    await overflow();
    await feedbackRegion.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/categories-${viewport.width}-receipts.png` });
    await page.getByRole('link', { name: 'Past chapters', exact: true }).click();
    await page.getByRole('button', { name: /Open Daily chapter from/ }).click();
    await page.getByRole('status', { name: 'Categorical feedback receipt' }).waitFor();
    assert.match(await page.getByRole('region', { name: 'Respond to this chapter' }).innerText(), /Recorded for this chapter: Repetitive/);
    assert.equal(await page.getByRole('button', { name: 'Send response' }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'How are you arriving?' }).count(), 0);
    await overflow();
    await page.getByRole('region', { name: 'Respond to this chapter' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/categories-${viewport.width}-history.png` });
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
    await page.addScriptTag({ path: `${repo}/node_modules/axe-core/axe.min.js` });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
    assert.deepEqual(violations, []);
    const previousWrites = requests.filter(request => request.method !== 'GET').length;
    await page.getByRole('link', { name: 'My birth details are wrong', exact: true }).click();
    await page.getByRole('heading', { name: 'Replace what the chart is built from.', exact: true }).waitFor();
    assert.equal(requests.filter(request => request.method !== 'GET').length, previousWrites);
    await page.screenshot({ path: `${directory}/categories-${viewport.width}-correction.png` });
    await page.goBack();
    await page.getByRole('button', { name: /Open Daily chapter from/ }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.deepEqual(unknown, []);
    reports.push({ viewport, errors, warnings, unknown, violations, requests, checks: ['Today categorical feedback and independent check-in', 'keyboard selection and optional note', 'correct reading ID feedback receipt', 'separate check-in request', 'unchanged reading', 'same edition receipt in actual History route', 'no overflow', 'History Axe A/AA', 'direct existing birth correction and browser Back without mutation'], url: page.url() });
    await context.close();
  }
  await writeFile(`${directory}/categories-report.json`, JSON.stringify({ scope: 'Actual application components, fictional contract-shaped browser API responses; no live account, provider or storage operation.', browser: 'Browser plugin not available; existing temporary Playwright/Chromium reused.', reports }, null, 2));
  console.log(JSON.stringify(reports.map(({ requests, ...report }) => ({ ...report, requestCount: requests.length }))));
} finally {
  await browser.close();
}
