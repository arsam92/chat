import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseTarget = process.env.CHAT_URL || 'https://arsam92.github.io/chat/';
const targetUrl = new URL(baseTarget);
const uniqueTestRoom = 'ci-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
targetUrl.searchParams.set('testRoom', uniqueTestRoom);
const target = targetUrl.toString();
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

async function enterRoom(context, label, pageTarget = target) {
  const page = await context.newPage();
  pages.push(page);
  attachDiagnostics(page, label);
  await page.goto(pageTarget, { waitUntil: 'domcontentloaded', timeout: 45000 });
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

  // Regression: bridge a client in the previous URL-scoped room into the
  // canonical room, even though A and B already have a working connection.
  const legacyRoomName = uniqueTestRoom + '-legacy';
  const legacyUrl = new URL(targetUrl);
  legacyUrl.searchParams.set('testRoom', legacyRoomName);
  const contextC = await browser.newContext();
  const c = await enterRoom(contextC, 'ROOM-TEST-C-LEGACY', legacyUrl.toString());
  await a.evaluate(slug => {
    state.roomSlugs = [...new Set([...(state.roomSlugs || []), slug])];
    return discover(state.roomSlugs);
  }, legacyRoomName);

  const connectedToName = (page, name) => page.waitForFunction(
    expected => [...state.peers.values()].some(entry =>
      entry.name === expected && entry.conn && entry.conn.open),
    name,
    { timeout }
  );
  await Promise.all([
    rosterHas(a, 'ROOM-TEST-C-LEGACY'),
    rosterHas(b, 'ROOM-TEST-C-LEGACY'),
    rosterHas(c, 'ROOM-TEST-A'),
    rosterHas(c, 'ROOM-TEST-B'),
    connectedToName(a, 'ROOM-TEST-C-LEGACY'),
    connectedToName(b, 'ROOM-TEST-C-LEGACY'),
    connectedToName(c, 'ROOM-TEST-A'),
    connectedToName(c, 'ROOM-TEST-B')
  ]);
  await c.evaluate(() => sendText('ROOM TEST LEGACY BRIDGE'));
  await b.locator('.msg').filter({ hasText: 'ROOM TEST LEGACY BRIDGE' }).waitFor({ state: 'visible', timeout });

  // Exercise the actual poll UI and ensure the poll reaches the other browser.
  await a.locator('#pollBtn').click();
  await a.locator('#pollModal.on').waitFor({ state: 'visible', timeout: 5000 });
  await a.locator('#pollQuestion').fill('ROOM TEST: کدام گزینه؟');
  // Invalid polls should explain what is missing instead of appearing to do nothing.
  await a.locator('#pollCreate').click();
  await a.locator('#pollError:not([hidden])').waitFor({ state: 'visible', timeout: 3000 });
  assert.match(await a.locator('#pollError').innerText(), /حداقل دو گزینه/u);
  assert.equal(await a.locator('#pollModal').evaluate(el => el.classList.contains('on')), true, 'invalid poll form must remain open');
  await a.locator('#pollOptionsList input').nth(0).fill('گزینهٔ الف');
  await a.locator('#pollOptionsList input').nth(1).fill('گزینهٔ ب');
  await a.locator('#pollAddOpt').click();
  assert.equal(await a.locator('#pollOptionsList input').nth(0).inputValue(), 'گزینهٔ الف', 'adding an option must preserve the first draft');
  assert.equal(await a.locator('#pollOptionsList input').nth(1).inputValue(), 'گزینهٔ ب', 'adding an option must preserve the second draft');
  await a.locator('#pollOptionsList input').nth(2).fill('گزینهٔ ج');
  await a.locator('#pollCreate').click();
  const ownPoll = a.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' });
  await ownPoll.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await ownPoll.locator('.poll-option').count(), 3, 'created poll should contain all three options');
  const receivedPoll = b.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' });
  await receivedPoll.waitFor({ state: 'visible', timeout });
  assert.equal(await receivedPoll.locator('.poll-option').count(), 3, 'remote poll should contain all three options');

  // Vote from B, then verify the origin receives the vote count update.
  const remotePoll = b.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' });
  await remotePoll.locator('.poll-option').nth(0).click();
  await a.waitForFunction(() => {
    const card = [...document.querySelectorAll('.poll-card')]
      .find(el => el.textContent?.includes('ROOM TEST: کدام گزینه؟'));
    const info = card?.querySelector('.poll-info')?.textContent || '';
    return /[1-9۱-۹]/u.test(info);
  }, null, { timeout: 10000 });

  // Exercise the redesigned, synchronized rock-paper-scissors reveal.
  const peerIdFor = async (page, name) => page.locator('#userList .user-item').evaluateAll((rows, expected) => {
    const row = rows.find(el => el.querySelector('.u-name')?.textContent?.includes(expected));
    return row?.dataset.userId || null;
  }, name);
  const bPeerId = await peerIdFor(a, 'ROOM-TEST-B');
  const aPeerId = await peerIdFor(b, 'ROOM-TEST-A');
  assert.ok(bPeerId && aPeerId, 'each player should have a discoverable peer ID');

  await a.evaluate(peerId => window.inviteToGame(peerId), bPeerId);
  await b.locator('.game-invite-toast .gi-accept').click();
  await Promise.all([
    a.locator('#gameModal.on').waitFor({ state: 'visible', timeout }),
    b.locator('#gameModal.on').waitFor({ state: 'visible', timeout })
  ]);
  assert.ok(parseFloat(await a.locator('#gameModal .rps-player').first().evaluate(el => getComputedStyle(el).borderRadius)) >= 16, 'RPS players should render as rounded arcade panels');
  assert.equal(await a.locator('#gameMeMove').innerText(), '?', 'my move should stay hidden until both players lock their choices');
  await a.locator('#gameModal button[data-move="rock"]').click();
  assert.equal(await a.locator('#gameMeMove').innerText(), '?', 'the first locked move remains hidden during suspense');
  await b.locator('#gameModal button[data-move="scissors"]').click();
  await Promise.all([
    a.locator('#gameMeMove.rps-revealing').waitFor({ state: 'visible', timeout }),
    b.locator('#gameMeMove.rps-revealing').waitFor({ state: 'visible', timeout })
  ]);
  assert.equal(await a.locator('#gameMeMove').innerText(), '✊', 'player A should reveal rock after both moves are locked');
  assert.equal(await a.locator('#gameOpMove').innerText(), '✌️', 'player A should receive player B scissors');
  assert.equal(await b.locator('#gameMeMove').innerText(), '✌️', 'player B should reveal scissors after both moves are locked');
  assert.equal(await b.locator('#gameOpMove').innerText(), '✊', 'player B should receive player A rock');
  await Promise.all([
    a.waitForFunction(() => document.querySelector('#gameMeScore')?.textContent?.trim() === '۱', null, { timeout }),
    b.waitForFunction(() => document.querySelector('#gameOpScore')?.textContent?.trim() === '۱', null, { timeout })
  ]);

  // Play a second round to verify score progression and match-end cleanup.
  await a.locator('#gameModal button[data-move="paper"]:not(:disabled)').waitFor({ state: 'visible', timeout });
  await a.locator('#gameModal button[data-move="paper"]').click();
  await b.locator('#gameModal button[data-move="rock"]:not(:disabled)').waitFor({ state: 'visible', timeout });
  await b.locator('#gameModal button[data-move="rock"]').click();
  await Promise.all([
    a.waitForFunction(() => document.querySelector('#gameMeScore')?.textContent?.trim() === '۲', null, { timeout }),
    b.waitForFunction(() => document.querySelector('#gameOpScore')?.textContent?.trim() === '۲', null, { timeout })
  ]);
  await Promise.all([
    a.locator('#gameModal').waitFor({ state: 'hidden', timeout: 9000 }),
    b.locator('#gameModal').waitFor({ state: 'hidden', timeout: 9000 })
  ]);

  // Test that private chat is usable, message delivery marks as read/received,
  // the remote typing indicator is live, and closing it uses the new motion state.
  await Promise.all([
    a.evaluate(peerId => window.openPM(peerId), bPeerId),
    b.evaluate(peerId => window.openPM(peerId), aPeerId)
  ]);
  await Promise.all([
    a.locator('#pmWindow.on').waitFor({ state: 'visible', timeout: 5000 }),
    b.locator('#pmWindow.on').waitFor({ state: 'visible', timeout: 5000 })
  ]);
  await a.locator('#pmInput').fill('دارم تایپ می‌کنم');
  await b.locator('#pmTyping:not([hidden])').waitFor({ state: 'visible', timeout: 5000 });
  await a.locator('#pmInput').fill('Private chat test works');
  await a.locator('#pmSendBtn').click();
  await b.locator('#pmMessages .msg').filter({ hasText: 'Private chat test works' }).waitFor({ state: 'visible', timeout });
  await a.locator('#pmMessages .msg.mine .ticks.delivered').waitFor({ state: 'visible', timeout });

  // The diagnostic report is strictly opt-in: opening/cancelling the consent
  // dialog must not contact the IP provider. Only explicit confirmation may
  // query a mock IP response and send the report to this PM recipient.
  let ipLookupCalls = 0;
  await a.route('**api64.ipify.org**', async route => {
    ipLookupCalls++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ip: '203.0.113.9' })
    });
  });
  await a.locator('#pmDeviceInfoBtn').click();
  await a.locator('#deviceReportOverlay.on').waitFor({ state: 'visible', timeout: 3000 });
  assert.match(await a.locator('#deviceReportDisclosure').innerText(), /IP عمومی/u, 'consent dialog must disclose public-IP sharing');
  assert.match(await a.locator('#deviceReportDisclosure').innerText(), /ROOM-TEST-B/u, 'consent dialog must name the exact private recipient');
  await a.locator('#deviceReportCancel').click();
  await a.locator('#deviceReportOverlay.on').waitFor({ state: 'hidden', timeout: 3000 });
  assert.equal(ipLookupCalls, 0, 'cancelling the consent dialog must not fetch the public IP');
  await a.locator('#pmDeviceInfoBtn').click();
  await a.locator('#deviceReportConfirm').click();
  const sharedDeviceReport = b.locator('#pmMessages .msg.theirs').filter({ hasText: '203.0.113.9' });
  await sharedDeviceReport.waitFor({ state: 'visible', timeout });
  assert.equal(ipLookupCalls, 1, 'public IP lookup should occur only after explicit confirmation');
  assert.match(await sharedDeviceReport.innerText(), /گزارش اتصال داوطلبانه/u);
  assert.match(await sharedDeviceReport.innerText(), /سیستم‌عامل/u);
  assert.equal(await a.locator('#messages .msg').filter({ hasText: '203.0.113.9' }).count(), 0, 'diagnostic report must not be broadcast to the public room');
  assert.equal(await b.locator('#messages .msg').filter({ hasText: '203.0.113.9' }).count(), 0, 'diagnostic report must remain in the selected private chat');

  // Private replies must identify the target sender and point back to the exact
  // message ID, not merely show a generic "replying" label.
  const originalPrivateMessageId = await b.locator('#pmMessages .msg.theirs')
    .filter({ hasText: 'Private chat test works' }).getAttribute('data-msgid');
  assert.ok(originalPrivateMessageId, 'original PM should have a stable message ID');
  await b.locator('#pmMessages .msg.theirs').filter({ hasText: 'Private chat test works' }).locator('.reply-btn').click();
  await b.locator('#pmReplyPreview:not([hidden])').waitFor({ state: 'visible', timeout: 3000 });
  assert.match(await b.locator('#pmRpName').innerText(), /ROOM-TEST-A/u, 'reply preview must name the original sender');
  assert.match(await b.locator('#pmRpText').innerText(), /Private chat test works/u, 'reply preview must quote the original text');
  await b.locator('#pmInput').fill('PM reply correctly linked');
  await b.locator('#pmSendBtn').click();
  const receivedReply = a.locator('#pmMessages .msg.theirs').filter({ hasText: 'PM reply correctly linked' });
  await receivedReply.waitFor({ state: 'visible', timeout });
  assert.equal(await receivedReply.getAttribute('data-reply-to'), originalPrivateMessageId, 'PM reply must point to the precise original message');
  assert.match(await receivedReply.locator('.reply-quote .rq-name').innerText(), /ROOM-TEST-A/u, 'reply quote must show who is being replied to');
  await Promise.all([a.locator('#pmClose').click(), b.locator('#pmClose').click()]);
  await Promise.all([
    a.locator('#pmWindow.on').waitFor({ state: 'hidden', timeout: 5000 }),
    b.locator('#pmWindow.on').waitFor({ state: 'hidden', timeout: 5000 })
  ]);

  // Settings must open, apply a real font-size choice, persist it, and close via Escape.
  await a.locator('#settingsBtn').click();
  await a.locator('#settingsModal.on').waitFor({ state: 'visible', timeout: 5000 });
  await a.locator('#fontOptions [data-size="large"]').click();
  assert.equal(await a.locator('html').getAttribute('data-font'), 'large', 'font size selection should apply to the UI');
  assert.ok(await a.evaluate(() => JSON.parse(localStorage.getItem('chatSettings') || '{}').font === 'large'), 'font setting should persist');
  await a.keyboard.press('Escape');
  await a.locator('#settingsModal.on').waitFor({ state: 'hidden', timeout: 5000 });

  // Verify a full UNO invite/start, all seven hand cards rendered as card faces,
  // the opponent's real card backs, and a proper discard-card face.
  await a.evaluate(peerId => window.inviteToUNO(peerId), bPeerId);
  await b.locator('.game-invite-toast').filter({ hasText: 'UNO' }).locator('.gi-accept').click();
  await Promise.all([
    a.locator('#unoModal.on').waitFor({ state: 'visible', timeout }),
    b.locator('#unoModal.on').waitFor({ state: 'visible', timeout })
  ]);
  await Promise.all([
    a.locator('#unoMyHand .uno-card-center').first().waitFor({ state: 'attached', timeout: 5000 }),
    b.locator('#unoMyHand .uno-card-center').first().waitFor({ state: 'attached', timeout: 5000 })
  ]);
  assert.equal(await a.locator('#unoMyHand .uno-card').count(), 7, 'host should have seven cards');
  assert.equal(await b.locator('#unoMyHand .uno-card').count(), 7, 'guest should have seven cards');
  assert.equal(await a.locator('#unoOpHand .uno-card.opponent.uno-back .uno-back-oval').count(), 7, 'host should see seven stylized backs');
  assert.equal(await b.locator('#unoOpHand .uno-card.opponent.uno-back .uno-back-oval').count(), 7, 'guest should see seven stylized backs');
  assert.equal(await a.locator('#unoCurrent > .uno-card.current-card .uno-card-ellipse').count(), 1, 'discard pile should display a layered card face');
  assert.ok(await a.locator('#unoMyHand .uno-card-corner').count() >= 14, 'hand cards should have duplicated corner labels');

  // Regression test: when the guest plays +2, the host draws from the hidden
  // deck but the drawn cards must be delivered to the guest (not kept by host).
  await Promise.all([
    a.evaluate(() => {
      const u = state.uno;
      const guestHand = [
        { color: 'red', value: 'draw2', type: 'special' },
        { color: 'yellow', value: '0', type: 'number' },
        { color: 'blue', value: '1', type: 'number' },
        { color: 'green', value: '3', type: 'number' },
        { color: 'yellow', value: '4', type: 'number' },
        { color: 'blue', value: '6', type: 'number' },
        { color: 'red', value: '8', type: 'number' }
      ];
      u.current = { color: 'red', value: '4', type: 'number' };
      u.deck = [
        { color: 'blue', value: '2', type: 'number' },
        { color: 'green', value: '5', type: 'number' }
      ];
      u.opHand = guestHand.map(card => ({ ...card }));
      u.turnSeq = 0; u.myTurn = false;
      renderUNO();
    }),
    b.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [
        { color: 'red', value: 'draw2', type: 'special' },
        { color: 'yellow', value: '0', type: 'number' },
        { color: 'blue', value: '1', type: 'number' },
        { color: 'green', value: '3', type: 'number' },
        { color: 'yellow', value: '4', type: 'number' },
        { color: 'blue', value: '6', type: 'number' },
        { color: 'red', value: '8', type: 'number' }
      ];
      u.turnSeq = 0; u.myTurn = true;
      renderUNO();
    })
  ]);
  await b.evaluate(() => window.applyUNOPlay(0));
  await Promise.all([
    a.waitForFunction(() => state.uno?.turnSeq === 1 && state.uno.opHand.length === 8 && state.uno.myHand.length === 7 && state.uno.deck.length === 0, null, { timeout: 5000 }),
    b.waitForFunction(() => state.uno?.turnSeq === 1 && state.uno.myHand.length === 8 && state.uno.myTurn, null, { timeout: 5000 })
  ]);
  assert.deepEqual(await b.evaluate(() => state.uno.myHand.filter(card => card.value === '2' || card.value === '5').map(card => card.color).sort()), ['blue', 'green'], 'guest should receive both cards drawn as the +2 penalty');
  assert.equal(await a.evaluate(() => state.uno.myHand.length), 7, 'host must not accidentally keep guest penalty cards');
  assert.equal(await b.locator('#unoMyHand .uno-card').count(), 8, 'guest UI should render both penalty cards');

  // Exercise both official Wild Draw Four challenge outcomes over real peer messages:
  // a legal +4 challenged by the opponent costs the challenger six cards.
  await Promise.all([
    a.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [{ color: 'wild', value: 'wild4', type: 'wild' }, { color: 'blue', value: '5', type: 'number' }];
      u.opHand = [{ color: 'red', value: '5', type: 'number' }, { color: 'green', value: '3', type: 'number' }];
      u.deck = [
        { color: 'red', value: '1', type: 'number' }, { color: 'blue', value: '2', type: 'number' },
        { color: 'green', value: '3', type: 'number' }, { color: 'yellow', value: '4', type: 'number' },
        { color: 'red', value: '6', type: 'number' }, { color: 'blue', value: '7', type: 'number' }
      ];
      u.discardPile = []; u.turnSeq = 1; u.myTurn = true; u.pendingChallenge = null;
      u.drawnCardOnly = false; u.opponentDrawnCardOnly = false; renderUNO();
    }),
    b.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [{ color: 'red', value: '5', type: 'number' }, { color: 'green', value: '3', type: 'number' }];
      u.opHand = new Array(2).fill(null); u.turnSeq = 1; u.myTurn = false; u.pendingChallenge = null;
      u.drawnCardOnly = false; u.opponentDrawnCardOnly = false; renderUNO();
    })
  ]);
  await a.evaluate(() => window.applyUNOPlay(0, 'blue'));
  await b.locator('#unoChallengeActions').waitFor({ state: 'visible', timeout });
  await b.locator('#unoChallengeActions button').nth(1).click();
  await Promise.all([
    a.waitForFunction(() => state.uno && !state.uno.pendingChallenge && state.uno.myTurn && state.uno.myHand.length === 1 && state.uno.opHand.length === 8, null, { timeout }),
    b.waitForFunction(() => state.uno && !state.uno.pendingChallenge && !state.uno.myTurn && state.uno.myHand.length === 8, null, { timeout })
  ]);

  // If the +4 player held the active color, a successful challenge gives that
  // player four cards and lets the challenger take the turn.
  await Promise.all([
    a.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [{ color: 'wild', value: 'wild4', type: 'wild' }, { color: 'red', value: '3', type: 'number' }];
      u.opHand = [
        { color: 'red', value: '5', type: 'number' }, { color: 'green', value: '3', type: 'number' },
        { color: 'blue', value: '2', type: 'number' }, { color: 'yellow', value: '1', type: 'number' },
        { color: 'blue', value: '6', type: 'number' }, { color: 'green', value: '7', type: 'number' },
        { color: 'red', value: '8', type: 'number' }, { color: 'yellow', value: '9', type: 'number' }
      ];
      u.deck = [
        { color: 'blue', value: '0', type: 'number' }, { color: 'yellow', value: '2', type: 'number' },
        { color: 'green', value: '4', type: 'number' }, { color: 'red', value: '6', type: 'number' }
      ];
      u.discardPile = []; u.turnSeq = 2; u.myTurn = true; u.pendingChallenge = null;
      u.drawnCardOnly = false; u.opponentDrawnCardOnly = false; renderUNO();
    }),
    b.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [
        { color: 'red', value: '5', type: 'number' }, { color: 'green', value: '3', type: 'number' },
        { color: 'blue', value: '2', type: 'number' }, { color: 'yellow', value: '1', type: 'number' },
        { color: 'blue', value: '6', type: 'number' }, { color: 'green', value: '7', type: 'number' },
        { color: 'red', value: '8', type: 'number' }, { color: 'yellow', value: '9', type: 'number' }
      ];
      u.opHand = new Array(2).fill(null); u.turnSeq = 2; u.myTurn = false; u.pendingChallenge = null;
      u.drawnCardOnly = false; u.opponentDrawnCardOnly = false; renderUNO();
    })
  ]);
  await a.evaluate(() => window.applyUNOPlay(0, 'green'));
  await b.locator('#unoChallengeActions').waitFor({ state: 'visible', timeout });
  await b.locator('#unoChallengeActions button').nth(1).click();
  await Promise.all([
    a.waitForFunction(() => state.uno && !state.uno.pendingChallenge && !state.uno.myTurn && state.uno.myHand.length === 5 && state.uno.opHand.length === 8, null, { timeout }),
    b.waitForFunction(() => state.uno && !state.uno.pendingChallenge && state.uno.myTurn && state.uno.myHand.length === 8, null, { timeout })
  ]);

  // Also cover the reverse direction: when the guest plays an illegal +4,
  // the host (deck owner) challenges locally and the guest draws four.
  await Promise.all([
    a.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [{ color: 'blue', value: '5', type: 'number' }];
      u.opHand = [{ color: 'wild', value: 'wild4', type: 'wild' }, { color: 'red', value: '3', type: 'number' }];
      u.deck = [
        { color: 'blue', value: '0', type: 'number' }, { color: 'yellow', value: '2', type: 'number' },
        { color: 'green', value: '4', type: 'number' }, { color: 'red', value: '6', type: 'number' }
      ];
      u.discardPile = []; u.turnSeq = 3; u.myTurn = false; u.pendingChallenge = null;
      u.drawnCardOnly = false; u.opponentDrawnCardOnly = false; renderUNO();
    }),
    b.evaluate(() => {
      const u = state.uno;
      u.current = { color: 'red', value: '4', type: 'number' };
      u.myHand = [{ color: 'wild', value: 'wild4', type: 'wild' }, { color: 'red', value: '3', type: 'number' }];
      u.opHand = new Array(1).fill(null); u.turnSeq = 3; u.myTurn = true; u.pendingChallenge = null;
      u.drawnCardOnly = false; u.opponentDrawnCardOnly = false; renderUNO();
    })
  ]);
  await b.evaluate(() => window.applyUNOPlay(0, 'green'));
  await a.locator('#unoChallengeActions').waitFor({ state: 'visible', timeout });
  await a.locator('#unoChallengeActions button').nth(1).click();
  await Promise.all([
    a.waitForFunction(() => state.uno && !state.uno.pendingChallenge && state.uno.myTurn && state.uno.myHand.length === 1 && state.uno.opHand.length === 5, null, { timeout }),
    b.waitForFunction(() => state.uno && !state.uno.pendingChallenge && !state.uno.myTurn && state.uno.myHand.length === 5, null, { timeout })
  ]);

  // Mild teasing is allowed; severe profanity is blocked before a message
  // reaches chat, and the offender is banned on peers that receive the report.
  await a.evaluate(() => sendText('اسکول پلشت دلقک'));
  await b.locator('#messages .msg').filter({ hasText: 'اسکول پلشت دلقک' }).waitFor({ state: 'visible', timeout });
  assert.equal(await a.evaluate(() => state.localBanUntil), 0, 'mild teasing words must not trigger a ban');
  await a.evaluate(() => sendText('کیر مادر'));
  await a.waitForFunction(() => state.localBanUntil > Date.now(), null, { timeout: 3000 });
  assert.equal(await a.locator('#messages .msg').filter({ hasText: 'کیر مادر' }).count(), 0, 'offensive message should be blocked, not displayed');
  await b.waitForFunction(peerId => !state.peers.has(peerId), aPeerId, { timeout: 5000 });

  console.log('PASS: room discovery, poll create/vote, two-round RPS, PM typing/delivery/replies, settings, UNO +2 routing, mild-language exemptions, and severe-profanity ban.');
  console.log('A roster:', JSON.stringify(await a.locator('#userList .u-name').allTextContents()));
  console.log('B roster:', JSON.stringify(await b.locator('#userList .u-name').allTextContents()));
  console.log('A poll status:', await a.locator('.poll-card').filter({ hasText: 'ROOM TEST: کدام گزینه؟' }).locator('.poll-info').innerText());
  console.log('UNO host hand / guest hand:', await a.locator('#unoMyHand .uno-card').count(), await b.locator('#unoMyHand .uno-card').count());
} catch (error) {
  console.error('FAIL: room, poll, RPS, private chat, settings, or UNO interaction failed.');
  console.error(error?.stack || error);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    try {
      console.error(`PAGE-${i + 1} URL:`, page.url());
      console.error(`PAGE-${i + 1} status:`, await page.locator('#statusText').textContent().catch(() => 'unavailable'));
      console.error(`PAGE-${i + 1} roster:`, JSON.stringify(await page.locator('#userList .u-name').allTextContents().catch(() => [])));
      console.error(`PAGE-${i + 1} toasts:`, JSON.stringify(await page.locator('#toasts').innerText().catch(() => 'unavailable')));
      console.error(`PAGE-${i + 1} RPS snapshot:`, JSON.stringify(await page.evaluate(() => ({
        status: document.querySelector('#gameStatus')?.textContent,
        round: document.querySelector('#gameRound')?.textContent,
        clash: document.querySelector('#rpsClash')?.className,
        myMoveText: document.querySelector('#gameMeMove')?.textContent,
        opMoveText: document.querySelector('#gameOpMove')?.textContent,
        choices: [...document.querySelectorAll('.rps-choice-btns button')].map(button => ({ move: button.dataset.move, selected: button.classList.contains('selected'), disabled: button.disabled })),
        game: typeof state !== 'undefined' && state.game ? { round: state.game.round, myMove: state.game.myMove, theirMove: state.game.theirMove, roundResolved: state.game.roundResolved, finished: state.game.finished, myScore: state.game.myScore, theirScore: state.game.theirScore } : null
      })).catch(() => ({ error: 'unavailable' }))));
      await page.screenshot({ path: `room-test-page-${i + 1}.png`, fullPage: true }).catch(() => {});
    } catch {}
  }
  console.error('Browser diagnostics:\n' + diagnostics.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
