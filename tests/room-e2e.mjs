import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.env.CHAT_URL || 'https://arsam92.github.io/chat/';
const timeout = Number(process.env.ROOM_TEST_TIMEOUT_MS || 30000);
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const diagnostics = [];
const pages = [];

function attachDiagnostics(page, label) {
  page.on('pageerror', error => diagnostics.push(`[${label}] pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.push(`[${label}] console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    const url = request.url();
    if (/peerjs|unpkg|github\.io/i.test(url)) {
      diagnostics.push(`[${label}] requestfailed: ${url} :: ${request.failure()?.errorText || 'unknown'}`);
    }
  });
  page.on('websocket', socket => {
    const record = { label, url: socket.url(), closed: false };
    diagnostics.push(`[${label}] websocket opened: ${record.url}`);
    socket.on('close', () => {
      record.closed = true;
      diagnostics.push(`[${label}] websocket closed: ${record.url}`);
    });
    socket.on('socketerror', error => diagnostics.push(`[${label}] websocket error: ${record.url} :: ${error}`));
  });
}

async function enterRoom(context, label) {
  const page = await context.newPage();
  pages.push(page);
  attachDiagnostics(page, label);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#nameInput').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#nameInput').fill(label);
  await page.locator('#loginBtn').click();
  await page.waitForFunction(
    expected => document.querySelector('#meName')?.textContent?.trim() === expected
      && document.querySelector('#chatScreen')?.classList.contains('on'),
    label,
    { timeout }
  );
  return page;
}

try {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await enterRoom(contextA, 'ROOM-TEST-A');
  const b = await enterRoom(contextB, 'ROOM-TEST-B');

  const rosterHas = (page, name) => page.waitForFunction(
    expected => [...document.querySelectorAll('#userList .u-name')]
      .some(el => el.textContent?.includes(expected)),
    name,
    { timeout }
  );

  await Promise.all([
    rosterHas(a, 'ROOM-TEST-B'),
    rosterHas(b, 'ROOM-TEST-A')
  ]);

  // Exercise the actual poll UI and ensure the poll reaches the other browser.
  await a.locator('#pollBtn').click();
  await a.locator('#pollModal.on').waitFor({ state: 'visible', timeout: 5000 });
  await a.locator('#pollQuestion').fill('ROOM TEST: کدام گزینه؟');
  await a.locator('#pollOptionsList input').nth(0).fill('گزینهٔ الف');
  await a.locator('#pollOptionsList input').nth(1).fill('گزینهٔ ب');
  await a.locator('#pollCreate').click();
  await a.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' }).waitFor({ state: 'visible', timeout: 5000 });
  await b.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' }).waitFor({ state: 'visible', timeout });

  // Vote from B, then verify the origin receives the vote count update.
  const remotePoll = b.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' });
  await remotePoll.locator('.poll-option').nth(0).click();
  await a.waitForFunction(() => {
    const card = [...document.querySelectorAll('.poll-card')]
      .find(el => el.textContent?.includes('ROOM TEST: کدام گزینه؟'));
    const info = card?.querySelector('.poll-info')?.textContent || '';
    return /[1-9۱-۹]/u.test(info);
  }, null, { timeout: 10000 });

  console.log('PASS: two independent browsers joined, created a poll, and exchanged a vote.');
  console.log('A roster:', JSON.stringify(await a.locator('#userList .u-name').allTextContents()));
  console.log('B roster:', JSON.stringify(await b.locator('#userList .u-name').allTextContents()));
  console.log('A poll status:', await a.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' }).locator('.poll-info').innerText());
} catch (error) {
  console.error('FAIL: two independent browser contexts did not discover each other.');
  console.error(error?.stack || error);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    try {
      console.error(`PAGE-${i + 1} URL:`, page.url());
      console.error(`PAGE-${i + 1} status:`, await page.locator('#statusText').textContent().catch(() => 'unavailable'));
      console.error(`PAGE-${i + 1} roster:`, JSON.stringify(await page.locator('#userList .u-name').allTextContents().catch(() => [])));
      console.error(`PAGE-${i + 1} toasts:`, JSON.stringify(await page.locator('#toasts').innerText().catch(() => 'unavailable')));
      await page.screenshot({ path: `room-test-page-${i + 1}.png`, fullPage: true }).catch(() => {});
    } catch {}
  }
  console.error('Browser diagnostics:\n' + diagnostics.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
