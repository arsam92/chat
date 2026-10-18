(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChatGameLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const POLL_MAX_OPTIONS = 6;
  const NF_CATEGORIES = ['name', 'family', 'city', 'country', 'food', 'animal'];
  const UNO_COLORS = ['red', 'blue', 'green', 'yellow'];
  const UNO_SPECIALS = ['skip', 'reverse', 'draw2'];

  function normalizeComparableText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase('fa')
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[ۀة]/g, 'ه')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[\u200c\u200d\s\u200e\u200f\-_.,،؛:!?؟'"()[]{}]+/g, '');
  }

  function createPoll(question, options) {
    const cleanQuestion = String(question ?? '').trim().slice(0, 200);
    if (!cleanQuestion || !Array.isArray(options)) return null;

    const seen = new Set();
    const cleanOptions = [];
    for (const candidate of options) {
      const text = String(candidate && typeof candidate === 'object' ? candidate.text ?? '' : candidate ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      if (!text) continue;
      const key = normalizeComparableText(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      cleanOptions.push({ text, votes: 0 });
      if (cleanOptions.length === POLL_MAX_OPTIONS) break;
    }
    if (cleanOptions.length < 2) return null;
    return { question: cleanQuestion, options: cleanOptions, voters: {} };
  }

  function sanitizePollPayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.question !== 'string' || !Array.isArray(value.options)) return null;
    return createPoll(value.question, value.options);
  }

  function canAcceptPollVote(poll, optionIndex, voterId) {
    if (!poll || !Array.isArray(poll.options) ||
        !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length ||
        typeof voterId !== 'string' || !voterId) return false;
    if (!poll.voters || typeof poll.voters !== 'object' || Array.isArray(poll.voters)) return false;
    return !Object.prototype.hasOwnProperty.call(poll.voters, voterId);
  }

  function normalizeNFText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase('fa')
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[ۀة]/g, 'ه')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  function nfAnswerStartsWithLetter(value, letter) {
    const answer = String(value ?? '').trim();
    const normalizedLetter = normalizeNFText(letter);
    if (!answer || !normalizedLetter) return false;
    const firstLetter = answer.normalize('NFKC').replace(/^[^\p{L}]+/u, '');
    const first = Array.from(firstLetter)[0] || '';
    return normalizeNFText(first) === Array.from(normalizedLetter)[0];
  }

  function scoreNameFamily(mine = {}, theirs = {}, letter, categories = NF_CATEGORIES) {
    let myTotal = 0;
    let theirTotal = 0;
    const rows = categories.map(category => {
      const mineRaw = String(mine?.[category] ?? '').trim().slice(0, 80);
      const theirsRaw = String(theirs?.[category] ?? '').trim().slice(0, 80);
      const mineKey = normalizeNFText(mineRaw);
      const theirsKey = normalizeNFText(theirsRaw);
      const mineValid = !!mineKey && nfAnswerStartsWithLetter(mineRaw, letter);
      const theirsValid = !!theirsKey && nfAnswerStartsWithLetter(theirsRaw, letter);
      let myPts = 0;
      let theirPts = 0;
      let status = '';

      if (!mineKey && !theirsKey) {
        status = '⬜ هر دو خالی';
      } else if (mineValid && !theirsKey) {
        myPts = 10;
        status = '✅ جواب تو با حرف درست شروع می‌شود؛ حریف خالی گذاشت';
      } else if (theirsValid && !mineKey) {
        theirPts = 10;
        status = '❌ خالی گذاشتی؛ جواب حریف با حرف درست شروع می‌شود';
      } else if (!mineValid && theirsValid) {
        theirPts = 10;
        status = '❌ جواب تو با حرف انتخابی شروع نمی‌شود';
      } else if (mineValid && !theirsValid) {
        myPts = 10;
        status = '✅ جواب تو با حرف درست شروع می‌شود؛ جواب حریف نامعتبر است';
      } else if (!mineValid && !theirsValid) {
        status = '❌ حرف اول هر دو جواب نامعتبر است';
      } else if (mineKey === theirsKey) {
        myPts = 5;
        theirPts = 5;
        status = '🤝 یکسان؛ درستی معنایی خودکار تأیید نشده';
      } else {
        myPts = 10;
        theirPts = 10;
        status = '⚠️ متفاوت؛ معنی جواب‌ها نیاز به بررسی دارد';
      }

      myTotal += myPts;
      theirTotal += theirPts;
      return { category, mineRaw, theirsRaw, mineValid, theirsValid, myPts, theirPts, status };
    });
    return { myTotal, theirTotal, rows, winner: myTotal > theirTotal ? 'me' : myTotal < theirTotal ? 'them' : 'tie' };
  }

  function rpsWinner(myMove, theirMove, beats) {
    if (!['rock', 'paper', 'scissors'].includes(myMove) ||
        !['rock', 'paper', 'scissors'].includes(theirMove)) return null;
    if (myMove === theirMove) return 'tie';
    return beats[myMove] === theirMove ? 'me' : 'them';
  }

  function tttWinningLine(board) {
    if (!Array.isArray(board) || board.length !== 9) return null;
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const line of lines) {
      const [a,b,c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
    }
    return null;
  }

  function isValidUnoColor(color) {
    return UNO_COLORS.includes(color);
  }

  function isValidUnoCard(card, played = false) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
    if (card.type === 'number') {
      return UNO_COLORS.includes(card.color) && /^(?:[0-9])$/.test(String(card.value));
    }
    if (card.type === 'special') {
      return UNO_COLORS.includes(card.color) && UNO_SPECIALS.includes(card.value);
    }
    if (card.type === 'wild') {
      return card.value === 'wild' && (card.color === 'wild' || (played && UNO_COLORS.includes(card.color)));
    }
    return false;
  }

  function unoCardCanPlay(card, current) {
    if (!isValidUnoCard(card, false) || !isValidUnoCard(current, true)) return false;
    if (card.type === 'wild') return true;
    if (card.color === current.color) return true;
    if (card.type === current.type && card.value === current.value &&
        (card.type === 'number' || card.type === 'special')) return true;
    return false;
  }

  function unoCardsMatchInHand(heldCard, playedCard) {
    if (!isValidUnoCard(heldCard, false) || !isValidUnoCard(playedCard, true)) return false;
    if (heldCard.type !== playedCard.type || heldCard.value !== playedCard.value) return false;
    return heldCard.type === 'wild' || heldCard.color === playedCard.color;
  }

  return {
    createPoll,
    sanitizePollPayload,
    canAcceptPollVote,
    normalizeComparableText,
    normalizeNFText,
    nfAnswerStartsWithLetter,
    scoreNameFamily,
    rpsWinner,
    tttWinningLine,
    isValidUnoColor,
    isValidUnoCard,
    unoCardCanPlay,
    unoCardsMatchInHand
  };
});
