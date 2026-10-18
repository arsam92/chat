import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GameLogic = require('../game-logic.js');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'exactly one inline application script expected');

const app = scripts[0][1];
assert.doesNotThrow(() => new Function(app), 'inline JavaScript must parse');
assert.match(html, /src="\.\/game-logic\.js"/, 'shared game logic must load from Pages');
assert.match(app, /const ROOM_NAME = 'global-chat-2026';/, 'all fresh clients must claim the same canonical room');
assert.match(app, /function getRoomSlugs\(\)/, 'previous URL-scoped rooms must remain discoverable');
assert.match(app, /function maintainRoomConnections\(\)/, 'room discovery must retry after the initial join');
assert.match(app, /discover\(slugs\)/, 'initial discovery must scan canonical and compatibility room IDs');
assert.match(app, /msg\.from !== conn\.peer/, 'poll votes must match the sending peer');
assert.match(app, /GameLogic\.canAcceptPollVote/, 'poll vote validation should use shared logic');
assert.match(app, /function onGameMove\(conn, msg\)/, 'RPS move handler should exist');
assert.match(app, /msg\.round !== g\.round/, 'late RPS moves must be rejected');
assert.match(app, /function onTTTMove\(conn, msg\)/, 'tic-tac-toe move handler should exist');
assert.match(app, /GameLogic\.tttWinningLine/, 'tic-tac-toe should use tested win detection');
assert.match(app, /function scoreNameFamily|GameLogic\.scoreNameFamily/, 'name-family scoring must use shared logic');
assert.match(app, /type: 'uno-start', id: u\.id, myHand: opHand, current/, 'UNO start must send a hand and current card');
assert.doesNotMatch(app, /type: 'uno-start', id: u\.id, deck/, 'UNO must not expose the remaining deck');
assert.match(app, /type: 'uno-draw-request'/, 'guest draws should be requested from the deck owner');
assert.match(html, /prefers-reduced-motion:\s*reduce/, 'reduced-motion preference must be respected');
assert.match(html, /id="mobileUsersBtn"/, 'mobile user-list button should exist');
assert.match(html, /id="sidebarShade"/, 'mobile drawer backdrop should exist');
assert.ok(app.includes("card.className = 'poll-card'"), 'poll results card should exist');
assert.match(html, /nf-invalid-letter/, 'name-family answers should display invalid starting letters');

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML element IDs must be unique');

// Poll validation: trim, cap, drop blanks, and deduplicate equivalent answers.
const poll = GameLogic.createPoll('  گوشی چی؟ ', ['الف', 'ب', ' الف ', '', 'ج', 'د', 'هـ', 'و']);
assert.equal(poll.question, 'گوشی چی؟');
assert.deepEqual(poll.options.map(option => option.text), ['الف', 'ب', 'ج', 'د', 'هـ', 'و']);
assert.equal(poll.options.length, 6);
assert.equal(GameLogic.createPoll('سؤال', ['یک', ' یک ']), null);
assert.equal(GameLogic.canAcceptPollVote(poll, 0, 'peer-a'), true);
poll.voters['peer-a'] = 0;
assert.equal(GameLogic.canAcceptPollVote(poll, 1, 'peer-a'), false, 'duplicate votes must be rejected');
assert.equal(GameLogic.canAcceptPollVote(poll, 99, 'peer-b'), false, 'invalid option index must be rejected');

// Persian normalization and name-family letter scoring.
assert.equal(GameLogic.normalizeNFText('مهدي'), GameLogic.normalizeNFText('مهدی'));
assert.equal(GameLogic.nfAnswerStartsWithLetter(' مهدی ', 'م'), true);
assert.equal(GameLogic.nfAnswerStartsWithLetter('تهران', 'م'), false);
const nf = GameLogic.scoreNameFamily(
  { name: 'مهدي', city: 'تهران', animal: 'مار' },
  { name: 'مهدی', city: 'مشهد', animal: 'گربه' },
  'م',
  ['name', 'city', 'animal']
);
assert.equal(nf.rows[0].myPts, 5, 'Arabic/Persian letter variants should compare as equal');
assert.equal(nf.rows[1].myPts, 0, 'answer that does not begin with the round letter must score zero');
assert.equal(nf.rows[1].theirPts, 10);
assert.equal(nf.rows[2].theirPts, 0, 'opponent answer starting with the wrong letter must score zero');

// Rock-paper-scissors and tic-tac-toe rules.
const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
assert.equal(GameLogic.rpsWinner('rock', 'scissors', beats), 'me');
assert.equal(GameLogic.rpsWinner('rock', 'paper', beats), 'them');
assert.equal(GameLogic.rpsWinner('paper', 'paper', beats), 'tie');
assert.equal(GameLogic.rpsWinner('hax', 'paper', beats), null);
assert.deepEqual(GameLogic.tttWinningLine(['X','X','X','O',null,'O',null,null,null]), [0,1,2]);
assert.deepEqual(GameLogic.tttWinningLine(['X',null,'O',null,'X',null,'O',null,'X']), [0,4,8]);
assert.equal(GameLogic.tttWinningLine(['X','O','X','X','O','O','O','X','X']), null);

// UNO: valid-card schema, matching rules, and wild-color discipline.
const redFive = { color: 'red', value: '5', type: 'number' };
const blueFive = { color: 'blue', value: '5', type: 'number' };
const blueSkip = { color: 'blue', value: 'skip', type: 'special' };
const heldWild = { color: 'wild', value: 'wild', type: 'wild' };
const playedWild = { color: 'green', value: 'wild', type: 'wild' };
assert.equal(GameLogic.isValidUnoCard(redFive), true);
assert.equal(GameLogic.unoCardCanPlay(redFive, blueFive), true, 'same number can be played');
assert.equal(GameLogic.unoCardCanPlay(blueSkip, redFive), false);
assert.equal(GameLogic.unoCardCanPlay(heldWild, redFive), true);
assert.equal(GameLogic.unoCardsMatchInHand(heldWild, playedWild), true);
assert.equal(GameLogic.isValidUnoCard({ color: 'pink', value: 'wild', type: 'wild' }, true), false);

console.log('Smoke checks passed: app syntax, poll integrity, NF letter scoring, RPS/TTT rules, UNO validation, responsive UI, and unique IDs.');
