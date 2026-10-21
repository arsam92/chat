import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GameLogic = require('../game-logic.js');
const KnowledgeQuiz = require('../knowledge-quiz.js');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'exactly one inline application script expected');

const app = scripts[0][1];
assert.doesNotThrow(() => new Function(app), 'inline JavaScript must parse');
assert.match(html, /src="\.\/game-logic\.js"/, 'shared game logic must load from Pages');
assert.match(html, /src="\.\/knowledge-quiz\.js"/, 'knowledge quiz module must load from Pages');
assert.ok(html.includes('id="umQuiz"'), 'the user menu should offer the information quiz');
assert.ok(html.includes('id="pmVoiceCallBtn"') && html.includes('state.peer.call(peerId,stream'), 'private chat should launch WebRTC voice calls');
assert.ok(html.includes("peer.on('call', mediaCall => handleIncomingVoiceCall(mediaCall))"), 'incoming PeerJS media calls should be handled');
assert.ok(html.includes('id="voiceAcceptBtn"') && html.includes('id="voiceMuteBtn"') && html.includes('id="voiceHangupBtn"'), 'voice calling should expose accept, mute and hang-up controls');
assert.ok(html.includes('QUIZ_DURATION_MS=3*60*1000') && html.includes('pickQuestions(10)'), 'the quiz should use 10 questions and a three-minute limit');
assert.ok(html.includes("case 'quiz-round-result': onQuizRoundResult(conn, msg); break;"), 'quiz result messages should be routed');
assert.match(app, /const ROOM_NAME = \/\^ci-\[a-z0-9-\]\{1,40\}\$\/.test\(requestedTestRoom\) \? requestedTestRoom : 'global-chat-2026';/, 'regular visitors share the canonical room while CI uses isolated rooms');
assert.ok(app.includes('return [...new Set([canonical, slugify(scopedName)])];'), 'fresh clients use a stable room plus a legacy compatibility alias');
assert.ok(app.includes("if (ROOM_NAME !== 'global-chat-2026') return [canonical];"), 'isolated test rooms must never scan or join the public room alias');
const roomDiscoveryStart = app.indexOf('async function discover(slugs)');
const roomDiscoveryEnd = app.indexOf('function finishDiscover()', roomDiscoveryStart);
const roomDiscoverySource = app.slice(roomDiscoveryStart, roomDiscoveryEnd);
assert.ok(roomDiscoveryStart >= 0 && roomDiscoveryEnd > roomDiscoveryStart, 'shared room discovery should be present');
assert.ok(!roomDiscoverySource.includes('if (hasRoomConnection) return;'), 'an existing canonical peer must not skip legacy-room discovery');
assert.match(app, /state\.mySlot === 0 && legacySlug && now - \(state\.lastLegacyRoomProbeAt \|\| 0\) >= 30000/, 'the canonical room owner should periodically discover old clients');
assert.match(app, /if \(rosterChanged\) broadcast\(\{ type: 'user-list', members: roster\(\) \}\)/, 'new peers should propagate roster updates until room namespaces converge');
assert.match(app, /function probePeerIds\(ids\)/, 'room discovery must probe an explicit target list');
assert.match(app, /for \(let slot = 0; slot < Math\.min\(MAX_SLOTS, Math\.max\(0, state\.mySlot\)\); slot\+\+\)/, 'new clients should scan earlier occupied slots instead of every empty slot');
assert.ok(app.includes('for (const slug of roomIds.filter(id => id !== canonicalSlug))'), 'legacy room IDs are scanned only in the fallback phase');
assert.match(app, /Retry only earlier slots; later participants are responsible for dialing us/, 'maintenance should retry only relevant peers');
assert.match(app, /msg\.from !== conn\.peer/, 'poll votes must match the sending peer');
assert.match(app, /GameLogic\.canAcceptPollVote/, 'poll vote validation should use shared logic');
assert.ok(app.includes('bubble._pollData = poll;'), 'poll data must be stored before the bubble is attached to its message');
assert.ok(app.includes('if (bubble._pollData) {\n    w._pollData = bubble._pollData;\n    updatePollUI(w, w._pollData);'), 'poll state must be initialized after the message is mounted');
assert.ok(!app.includes("bubble.closest('.msg')._pollData = poll;"), 'poll creation must not look for a parent before DOM mounting');
assert.match(app, /function syncPollOptionDraft\(\)/, 'adding/removing poll options must preserve the current live field values');
assert.ok(app.includes("const optionInputs = [...$('pollOptionsList').querySelectorAll('input')];"), 'poll creation must read current values directly from the visible inputs');
assert.ok(html.includes('id="pollError"'), 'poll validation errors should be visible near the form');
assert.match(app, /classList\.add\('rps-revealing', 'reveal-3d'\)/, 'RPS should activate the new synchronized card reveal animation');
assert.match(app, /classList\.add\('count-up'\)/, 'RPS score changes should animate');
assert.match(app, /mark-in/, 'tic-tac-toe marks should animate as they appear');
assert.ok(html.includes('ARSAM ARCADE'), 'game modals should include the new arcade styling');
assert.match(html, /fonts\.googleapis\.com\/css2\?family=Vazirmatn/, 'the app should load the Persian-friendly Vazirmatn font');
assert.ok(html.includes('id="pmTyping"') && html.includes('id="pmPresenceText"'), 'private chat should display live typing and presence state');
assert.ok(html.includes('id="pmSendBtn"'), 'private chat should have its own accessible send button');
assert.ok(html.includes('id="pmDeviceInfoBtn"'), 'private chat should expose a user-triggered device-report option');
assert.ok(html.includes('id="deviceReportDisclosure"') && html.includes('id="deviceReportConfirm"'), 'sharing must require an explicit, understandable consent dialog');
assert.match(app, /function openDeviceReportDialog\(\)/, 'device reports must be initiated by a visible private-chat action');
assert.match(app, /async function sendMyDeviceReport\(\)/, 'the actual report must be built only after consent confirmation');
assert.match(app, /if \(!targetId \|\| targetId !== state\.pmOpenFor\)/, 'report must be cancelled if the selected private recipient changes');
assert.match(app, /referrerPolicy: 'no-referrer'/, 'IP lookup should avoid sending the page URL as the referrer');
assert.equal((app.match(/fetch\(/g) || []).length, 1, 'the app should make no other hidden fetches for IP/device collection');
assert.match(html, /تا وقتی تأیید نکنی هیچ گزارشی جمع‌آوری یا ارسال نمی‌شود/, 'consent text must say that reports are not collected automatically');
assert.match(app, /case 'pm-typing': onPMTyping\(conn, msg\)/, 'private typing events must be routed separately from public typing');
assert.match(app, /function renderPM\(options = \{\}\)/, 'private messages should rerender without replaying every old message');
assert.match(app, /function insertMemeToken\(url, input\)/, 'the sticker picker should insert a meme at the current caret');
assert.match(app, /function appendTextWithMemes\(container, value\)/, 'message bubbles should render meme tokens as safe inline images');
assert.ok(html.includes('id="pmStickerBtn"') && html.includes('id="pmStickerGrid"'), 'private chat should offer an inline meme picker');
assert.match(app, /d\.onclick = \(\) => \{ insertMemeToken\(url, \$\('chatInput'\)\); closePanels\(\); \}/, 'public sticker selection should insert into the message, not send separately');
assert.match(app, /className = 'inline-meme'/, 'inline meme images should have a dedicated style and rendering class');
assert.match(app, /function closeSettings\(\)/, 'settings should have a controlled close animation');
assert.ok(html.includes('id="rpsCountdown"') && html.includes('id="rpsFootnote"'), 'rock-paper-scissors should have a dedicated duel countdown/reveal UI');
assert.match(app, /function revealRPSRound\(g\)/, 'RPS must reveal both moves together after the suspense countdown');
assert.match(app, /function finishRPSRound\(g, winner\)/, 'RPS scoring should happen only after the move reveal animation');
assert.ok(!app.includes("checkGameResult = function()"), 'legacy RPS code must not override the synchronized countdown state machine');
assert.ok(!app.includes("document.querySelectorAll('.game-choice-btns button')"), 'legacy selector must not leave new RPS controls locked between rounds');
assert.match(app, /function createUNOCard\(card, options = \{\}\)/, 'UNO should render actual layered card faces instead of a bare emoji');
assert.match(app, /function unoTakeCards\(u, amount = 1\)/, 'UNO should draw from the deck and recycle discarded cards when needed');
assert.match(app, /const penaltyAmount = GameLogic\.unoCardPenalty\(played\)/, 'UNO +2 and +4 penalties should use shared rule logic');
assert.match(app, /u\.opHand\.push\(\.\.\.penaltyCards\)/, 'UNO penalties must be added to the opponent hand');
assert.match(app, /if \(penaltyCards\.length\) u\.myHand\.push\(\.\.\.penaltyCards\)/, 'UNO guest should receive its penalty cards through sync');
assert.match(app, /u\.drawnCardOnly = canPlay/, 'only the newly drawn playable card should be enabled');
assert.match(app, /function unoPassDraw\(\)/, 'players need to end their turn after choosing not to play a drawn card');
assert.match(app, /function unoResolveChallenge\(challenge\)/, 'Wild Draw Four needs an accept/challenge decision');
assert.match(app, /function onUNOChallengeDecision\(conn, msg\)/, 'Wild Draw Four decisions must reach the deck owner');
assert.match(app, /function onUNOChallengeResult\(conn, msg\)/, 'Wild Draw Four outcomes must synchronize to the guest');
assert.match(html, /id="unoChallengeActions"/, 'the challenge decision UI should exist');
assert.match(app, /card: null, hostHandCount: u\.myHand\.length/, 'the host must never leak a card drawn into its own hand');
assert.match(html, /id="unoPassDraw"/, 'the drawn-card pass-turn control should exist');
assert.ok(app.includes("ellipse") && app.includes("uno-back-oval"), 'UNO faces and backs should use the custom card artwork builder');
assert.match(html, /prefers-reduced-motion: reduce/, 'new animations must respect reduced-motion preferences');
assert.match(app, /function onGameMove\(conn, msg\)/, 'RPS move handler should exist');
assert.match(app, /msg\.round !== g\.round/, 'late RPS moves must be rejected');
assert.match(app, /function onTTTMove\(conn, msg\)/, 'tic-tac-toe move handler should exist');
assert.match(app, /GameLogic\.tttWinningLine/, 'tic-tac-toe should use tested win detection');
assert.match(app, /function scoreNameFamily|GameLogic\.scoreNameFamily/, 'name-family scoring must use shared logic');
assert.match(app, /type: 'uno-start', id: u\.id, myHand: opHand, current/, 'UNO start must send a hand and current card');
assert.doesNotMatch(app, /type: 'uno-start', id: u\.id, deck/, 'UNO must not expose the remaining deck');
assert.match(app, /type: 'uno-draw-request'/, 'guest draws should be requested from the deck owner');
assert.match(app, /function moderateOutgoingText\(text\)/, 'outgoing messages must pass through the profanity filter');
assert.match(app, /function applyPeerModerationBan\(peerId, name, violation, isPrivate = false\)/, 'incoming profanity must be removed and its sender temporarily blocked');
assert.match(app, /case 'moderation-report': onModerationReport\(conn, msg\)/, 'moderation reports must be routed');
assert.match(app, /function scrollToPMMessage\(msgId\)/, 'private reply quotes must jump to the correct message');
assert.match(app, /state\.pmReplyTo = replySnapshot\(o\)/, 'private replies must retain the original sender and message ID');
assert.ok(html.includes('id="pmReplyPreview"') && html.includes('id="pmRpName"'), 'private chat should show who a reply is addressed to');
assert.match(app, /w\.dataset\.replyTo = o\.reply\.msgId/, 'message DOM should explicitly record the reply target');
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
const heldWild4 = { color: 'wild', value: 'wild4', type: 'wild' };
const playedWild4 = { color: 'blue', value: 'wild4', type: 'wild' };
assert.equal(GameLogic.isValidUnoCard(heldWild4), true, 'Wild Draw Four must exist in the deck');
assert.equal(GameLogic.isValidUnoCard(playedWild4, true), true, 'Wild Draw Four with the chosen active color is a valid played card');
assert.equal(GameLogic.unoCardPenalty({ color: 'red', value: 'draw2', type: 'special' }), 2);
assert.equal(GameLogic.unoCardPenalty(playedWild4), 4);
assert.equal(GameLogic.unoCardCanPlay(heldWild4, redFive, [redFive, heldWild4], 1), true,
  'Wild Draw Four can be played and challenged if it is not legal');
assert.equal(GameLogic.unoWildDrawFourIsLegal([redFive, heldWild4], 'red', 1), false,
  'a challenge should succeed if the player held a card of the active color');
assert.equal(GameLogic.unoWildDrawFourIsLegal([blueFive, heldWild4], 'red', 1), true,
  'a challenge should fail if the player had no card of the active color');
assert.equal(GameLogic.unoCardCanPlay(heldWild, redFive), true, 'normal Wild may be played even when another color card matches');
assert.equal(GameLogic.classifyProfanity('اسکول پلشت دلقک'), null, 'mild teasing words must not be punished');
assert.equal(GameLogic.classifyProfanity('سلام دوست خوبم'), null, 'normal conversation should pass moderation');
assert.equal(GameLogic.classifyProfanity('shit')?.severity, 1, 'less severe profanity should get the shortest ban tier');
assert.equal(GameLogic.classifyProfanity('کسکش')?.severity, 2, 'strong profanity should get the middle ban tier');
assert.equal(GameLogic.classifyProfanity('کس‌کش')?.severity, 2, 'invisible joiners should not bypass profanity checks');
assert.equal(GameLogic.classifyProfanity('کیر مادر')?.severity, 3, 'very severe profanity should get the longest initial ban tier');

// General-knowledge duel rules and answer-key privacy.
let quizSeed=0.314159;
const nextQuizRandom=()=>{quizSeed=(quizSeed*3.7+0.11)%1;return quizSeed;};
const questions=KnowledgeQuiz.pickQuestions(10,nextQuizRandom);
assert.equal(questions.length,10);
assert.equal(new Set(questions.map(q=>q.id)).size,10,'questions should not repeat');
assert.ok(questions.every(q=>q.options.length===4&&Number.isInteger(q.answerIndex)&&q.answerIndex>=0&&q.answerIndex<4));
const publicQuestions=KnowledgeQuiz.publicQuestions(questions);
assert.equal(KnowledgeQuiz.sanitizePublicQuestions(publicQuestions).length,10);
assert.ok(publicQuestions.every(q=>!Object.prototype.hasOwnProperty.call(q,'answerIndex')),'answer keys must not be sent to the guest');
assert.equal(KnowledgeQuiz.sanitizePublicQuestions(publicQuestions.slice(0,9)),null,'incomplete game payload must be rejected');
assert.deepEqual(KnowledgeQuiz.scoreAnswers(questions,questions.map(q=>q.answerIndex)),{correctCount:10,total:10,percent:100});
assert.deepEqual(KnowledgeQuiz.scoreAnswers(questions,[]),{correctCount:0,total:10,percent:0});

console.log('Smoke checks passed: app syntax, poll integrity, NF letter scoring, RPS/TTT rules, classic UNO +4 legality/penalties, moderation tiers, accurate replies, responsive UI, and unique IDs.');
