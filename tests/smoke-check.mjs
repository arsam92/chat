import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'exactly one inline application script expected');

const app = scripts[0][1];
assert.doesNotThrow(() => new Function(app), 'inline JavaScript must parse');
assert.match(app, /function onPollVote\(conn, msg\)/, 'poll handler should exist');
assert.match(app, /poll\.voters\[conn\.peer\] !== undefined/, 'a participant must not vote twice');
assert.match(app, /function onGameMove\(conn, msg\)/, 'RPS move handler should exist');
assert.match(app, /function onTTTMove\(conn, msg\)/, 'tic-tac-toe move handler should exist');
assert.match(app, /opponentHandCount: myHand\.length/, 'UNO startup should not send the opponent hand');
assert.match(html, /prefers-reduced-motion:\s*reduce/, 'reduced-motion preference must be respected');
assert.match(html, /id="mobileUsersBtn"/, 'mobile user-list button should exist');
assert.match(html, /id="sidebarShade"/, 'mobile drawer backdrop should exist');

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML element IDs must be unique');

console.log('Smoke checks passed: JavaScript syntax, key regressions, mobile UI, and unique IDs.');
