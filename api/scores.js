// Live score endpoint for the WTA Finals page.
// - Reads the confirmed schedule/results from /data/scores.json (static, maintained by hand).
// - If TENNIS_API_KEY is set and a match window is open, overlays LIVE scores from Live Tennis API.
// - Never overwrites a confirmed final. Falls back to the static file on any problem.
// The key lives only in the TENNIS_API_KEY environment variable (never in the page or repo).

const PROVIDER = 'https://api.livetennisapi.com/api/public/v1/matches?tour=wta&status=live&limit=50';

// Quota guards (kept per warm serverless instance, on top of the CDN cache).
const blocked = {};            // per-key: epoch ms until which that key must not be used
let memo = null;               // last good provider response
let memoAt = 0;
let memoTtl = 150000;          // how long the current provider answer is reused (adaptive, see below)
// Update rhythm: about every 2 minutes while a match is live, easing to about every 3 minutes once 50 of the day's 95 calls are used
// (free plan = 100 requests/day), and every 4 minutes while we are only waiting for a match to start.
function nextTtl(body, calls) {
  const live = !!(body && Array.isArray(body.data) && body.data.some((x) => !x.is_doubles));
  if (!live) return 240000;
  return calls < 50 ? 105000 : 170000;
}
let dayKey = '';               // per-instance daily call counter (free plan = 100/day)
let dayCalls = 0;
const DAY_LIMIT = 95;
const seen = {};               // id -> last live snapshot seen on this instance (kept so a finished match never resets to 'upcoming')

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function last(name) {
  const parts = norm(name).split(/\s+/);
  return parts[parts.length - 1];
}
function pairKey(a, b) {
  return [last(a), last(b)].sort().join('|');
}

async function loadStatic(base) {
  const r = await fetch(base + '/data/scores.json', { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error('static ' + r.status);
  return r.json();
}

// Is any unfinished match close to its start time (or already live)? Protects the free daily quota.
function windowOpen(matches, now) {
  return matches.some((m) => {
    if (m.status === 'final') return false;
    if (m.status === 'live') return true;
    if (!m.start) return false;
    const t = Date.parse(m.start);
    return now >= t - 15 * 60 * 1000 && now <= t + 5 * 60 * 60 * 1000;
  });
}

// Tries each configured key in order (TENNIS_API_KEY, then TENNIS_API_KEY2). A key that is
// rate-limited (429) or rejected (401/403) is parked, and the next key is used instead.
async function fetchProvider(keys) {
  const now = Date.now();
  if (memo && now - memoAt < memoTtl) return memo;
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCalls = 0; }
  if (dayCalls >= DAY_LIMIT) throw new Error('daily call guard');
  let lastErr = new Error('no usable key');
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (now < (blocked[i] || 0)) continue;
    let r;
    try {
      dayCalls++;
      r = await fetch(PROVIDER, { headers: { Authorization: 'Bearer ' + key } });
    } catch (e) { lastErr = e; continue; }
    if (r.status === 429) {
      let until = now + 15 * 60 * 1000;
      try {
        const j = await r.json();
        if (j && j.resets_at) until = Math.max(until, Date.parse(j.resets_at) + 30000);
      } catch (e) {}
      blocked[i] = until;
      lastErr = new Error('rate limited');
      continue;
    }
    if (r.status === 401 || r.status === 403) { blocked[i] = now + 60 * 60 * 1000; lastErr = new Error('key rejected'); continue; }
    if (!r.ok) { lastErr = new Error('provider ' + r.status); continue; }
    memo = await r.json();
    memoAt = now;
    memoTtl = nextTtl(memo, dayCalls);
    return memo;
  }
  throw lastErr;
}

async function overlayLive(data, keys) {
  const body = await fetchProvider(keys);
  const live = new Map();
  (body.data || []).forEach((pm) => {
    if (pm.is_doubles) return;
    live.set(pairKey(pm.players.p1.name, pm.players.p2.name), pm);
  });

  data.matches.forEach((m) => {
    if (m.status === 'final') return; // confirmed results are never overwritten
    if (m.pinUntil && Date.now() < Date.parse(m.pinUntil)) { m.live = true; return; } // manually confirmed score is pinned
    const pm = live.get(pairKey(m.p1.name, m.p2.name));
    if (!pm) {
      // The feed no longer lists it live: probably just finished. Keep the last live score (never reset to 'upcoming').
      const snap = seen[m.id];
      if (snap && Date.now() - snap.at < 6 * 60 * 60 * 1000) {
        m.status = 'live';
        m.sets = snap.sets;
        delete m.live; delete m.server; delete m.points; delete m.lag;
        m.note = 'Match finished — final score being confirmed';
      } else if (m.status === 'live') {
        m.note = 'Match finished — final score being confirmed';
      }
      return;
    }
    const sc = pm.score || {};
    const g = sc.games || [[], []];
    const same = last(pm.players.p1.name) === last(m.p1.name);
    const a = same ? g[0] : g[1];
    const b = same ? g[1] : g[0];
    const sets = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) sets.push({ p1: a[i] || 0, p2: b[i] || 0 });
    // Best of three: when the feed already shows a player with two completed sets, the match is over.
    const won = (x, y) => (x >= 6 && x - y >= 2) || (x === 7 && (y === 5 || y === 6));
    const w1 = sets.filter((x) => won(x.p1, x.p2)).length;
    const w2 = sets.filter((x) => won(x.p2, x.p1)).length;
    if (w1 >= 2 || w2 >= 2) {
      m.status = 'final';
      m.sets = sets;
      delete m.note; delete m.live; delete m.server; delete m.points; delete m.lag;
      finals[m.id] = { sets: sets };
      return;
    }
    m.status = 'live';
    m.sets = sets;
    m.live = true;
    seen[m.id] = { sets: sets.map((x) => Object.assign({}, x)), at: Date.now() };
    delete m.note;
    // Warn when the feed itself looks behind (its data is old/stale, or no games recorded long after the start).
    {
      const reasons = [];
      // age_seconds = time since the score last changed; observed_age_seconds = time since the source last looked at the match.
      // A feed that is still being observed but whose score has not moved for 5+ minutes means play is paused (timeout, break, delay), not that the feed is behind.
      const changeAge = Number(sc.age_seconds) || 0;
      const hasObs = sc.observed_age_seconds !== undefined && sc.observed_age_seconds !== null && Number.isFinite(Number(sc.observed_age_seconds));
      const feedAge = hasObs ? Number(sc.observed_age_seconds) : changeAge;
      const liveAt = Date.parse(pm.live_at || '');
      const total = sets.reduce((a, x) => a + x.p1 + x.p2, 0);
      if (sc.stale || feedAge > 180) reasons.push('feed data is ' + Math.max(1, Math.round(feedAge / 60)) + ' min old');
      if (hasObs && !sc.stale && feedAge <= 180 && changeAge >= 300) m.paused = Math.round(changeAge / 60); else delete m.paused;
      if (liveAt && sets.length === 1 && total === 0 && Date.now() - liveAt > 12 * 60 * 1000) reasons.push('no games recorded yet');
      if (reasons.length) m.lag = reasons.join('; '); else delete m.lag;
    }
    // Provider: server 1 = its p1, 2 = its p2. Map to our p1/p2 (names may be in a different order).
    delete m.server;
    if (sc.server === 1 || sc.server === 2) {
      const srv = sc.server === 1 ? 'p1' : 'p2';
      m.server = same ? srv : (srv === 'p1' ? 'p2' : 'p1');
    }
    if (Array.isArray(sc.points) && sc.points.length === 2) {
      const pp = same ? sc.points : [sc.points[1], sc.points[0]];
      m.points = pp.map((x) => (String(x).toUpperCase() === 'A' ? 'AD' : String(x).toUpperCase()));
    } else { delete m.points; }
    if (sc.is_tiebreak && Array.isArray(sc.points)) {
      const p = same ? sc.points : [sc.points[1], sc.points[0]];
      m.note = 'Tiebreak ' + p[0] + '-' + p[1];
    } else if (Array.isArray(sc.points) && sc.points.length === 2) {
      const p = same ? sc.points : [sc.points[1], sc.points[0]];
      m.note = 'Game: ' + p[0] + '-' + p[1];
    }
    // A hand-set alert (e.g. medical timeout) clears itself as soon as the live score moves on from the score it was set at.
    if (m.alert && m.alertSig) {
      const sig = m.sets.map((x) => x.p1 + '-' + x.p2).join(',') + '|' + (m.points || []).join('-');
      if (sig !== m.alertSig) { delete m.alert; delete m.alertUntil; delete m.alertSig; }
    }
  });
  data.updated = new Date().toISOString();
  data.source = 'live';
  return data;
}


// ---------------------------------------------------------------------------------------------
// Cito API (second fallback). Free plan = 500 requests/MONTH and 60s-delayed live data, so it is
// used sparingly: (a) to CONFIRM FINALS (finished matches) when the main feed has dropped a match
// we show as live, and (b) as a live backup only if the main feed is completely unavailable.
// ---------------------------------------------------------------------------------------------
const CITO = 'https://api.citoapi.com/api/v1/tennis';
const CITO_TOURNAMENT = 'wta_2026_808'; // Indian Wells Finals
const finals = {};                       // id -> confirmed final (kept for the life of the instance)
const cito = { blockedUntil: 0, remaining: null, done: null, doneAt: 0, live: null, liveAt: 0 };

async function citoGet(path) {
  const key = process.env.CITO_API_KEY;
  if (!key) throw new Error('no cito key');
  if (Date.now() < cito.blockedUntil) throw new Error('cito blocked');
  if (cito.remaining !== null && cito.remaining < 30) throw new Error('cito monthly budget protected');
  const r = await fetch(CITO + path, { headers: { 'x-api-key': key } });
  const rem = r.headers && r.headers.get ? r.headers.get('x-ratelimit-monthly-remaining') : null;
  if (rem !== null && rem !== undefined && rem !== '') cito.remaining = Number(rem);
  if (r.status === 429) { cito.blockedUntil = Date.now() + 30 * 60 * 1000; throw new Error('cito rate limited'); }
  if (r.status === 401 || r.status === 403) { cito.blockedUntil = Date.now() + 60 * 60 * 1000; throw new Error('cito key rejected'); }
  if (!r.ok) throw new Error('cito ' + r.status);
  return r.json();
}

async function citoCompleted() {
  if (cito.done && Date.now() - cito.doneAt < 10 * 60 * 1000) return cito.done;
  const j = await citoGet('/matches?tournament_id=' + CITO_TOURNAMENT + '&page_size=50');
  cito.done = (j.items || []).filter((m) => m.status === 'COMPLETED');
  cito.doneAt = Date.now();
  return cito.done;
}

async function citoLiveItems(maxAge) {
  if (cito.live && Date.now() - cito.liveAt < (maxAge || 3 * 60 * 1000)) return cito.live;
  const j = await citoGet('/live');
  cito.live = (j.items || []).filter((m) => m.tournament_id === CITO_TOURNAMENT);
  cito.liveAt = Date.now();
  return cito.live;
}

function citoSets(item, same) {
  return (item.sets || []).map((x) => {
    const a = same ? x.player1_games : x.player2_games;
    const b = same ? x.player2_games : x.player1_games;
    const set = { p1: a == null ? 0 : a, p2: b == null ? 0 : b };
    const tp = x.tiebreak_points;
    if (tp && tp.loser != null && !tp.in_progress) set.tb = tp.loser;
    return set;
  });
}

function findMatch(data, item) {
  const key = pairKey(item.player1.name, item.player2.name);
  // same two players can meet again in a later round, so the round must match too (matches without roundCode are round-robin)
  return data.matches.find((m) => pairKey(m.p1.name, m.p2.name) === key && (m.roundCode || 'RR') === (item.round || 'RR'));
}

async function citoAssist(data, primaryOk) {
  if (!process.env.CITO_API_KEY) return;
  const now = Date.now();
  const stale = data.matches.filter((m) => m.status === 'live' && !m.live); // shown live, not confirmed live by main feed
  // Started long ago (or seen live earlier) but still not final: ask Cito whether it has finished.
  const overdue = data.matches.filter((m) => m.status !== 'final' && !m.live && m.start && now > Date.parse(m.start) + (seen[m.id] ? 20 : 75) * 60 * 1000 && now < Date.parse(m.start) + 7 * 60 * 60 * 1000);
  if (overdue.length) stale.push.apply(stale, overdue);
  const open = windowOpen(data.matches, now);
  if (!stale.length && (primaryOk || !open)) return;

  // (a) confirm finals
  const done = await citoCompleted();
  done.forEach((it) => {
    const m = findMatch(data, it);
    if (!m || m.status === 'final') return;
    const same = last(it.player1.name) === last(m.p1.name);
    const sets = citoSets(it, same);
    if (!sets.length) return;
    // Keep tiebreak points we already know when the set score matches (Cito does not always report them).
    sets.forEach((x, i) => { const old = (m.sets || [])[i]; if (x.tb == null && old && old.tb != null && old.p1 === x.p1 && old.p2 === x.p2) x.tb = old.tb; });
    m.status = 'final';
    m.sets = sets;
    delete m.note; delete m.live; delete m.server;
    finals[m.id] = { sets: sets };
  });

  // (b) live backup, only if the main feed failed entirely
  if (!primaryOk && open) {
    const live = await citoLiveItems();
    const matched = {};
    live.forEach((it) => {
      const m = findMatch(data, it);
      if (!m || m.status === 'final') return;
      if (m.pinUntil && Date.now() < Date.parse(m.pinUntil)) return;
      const same = last(it.player1.name) === last(m.p1.name);
      matched[m.id] = true;
      m.status = 'live';
      m.live = true;
      m.sets = citoSets(it, same);
      seen[m.id] = { sets: m.sets.map((x) => Object.assign({}, x)), at: Date.now() };
      data.backup = 'cito';
      if (it.server === 1 || it.server === 2) {
        const srv = it.server === 1 ? 'p1' : 'p2';
        m.server = same ? srv : (srv === 'p1' ? 'p2' : 'p1');
      }
      if (it.game_score) {
        const parts = String(it.game_score).split('-');
        m.points = same ? parts.slice(0, 2) : parts.slice(0, 2).reverse();
        m.note = 'Game: ' + (same ? it.game_score : parts.reverse().join('-'));
      }
      data.source = 'live';
      data.updated = new Date().toISOString();
    });
    // A match we saw live that the backup no longer lists has probably just finished: keep its last score (never reset to 'upcoming').
    data.matches.forEach((m) => {
      const snap = seen[m.id];
      if (matched[m.id] || m.status === 'final' || !snap || Date.now() - snap.at > 6 * 60 * 60 * 1000) return;
      m.status = 'live'; m.sets = snap.sets; delete m.live; delete m.server; delete m.points;
      m.note = 'Match finished — final score being confirmed';
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Schedule from Cito: newly published matches of the tournament (e.g. the next day's order of play, semifinals, final)
// are added automatically. One request per poll, at most every 3 hours (free plan = 500 requests/month).
// ---------------------------------------------------------------------------------------------
const COUNTRIES = {
  BLR: ['🇧🇾', 'Belarus'], RUS: ['🇷🇺', 'Russia'], UKR: ['🇺🇦', 'Ukraine'], CZE: ['🇨🇿', 'Czechia'], USA: ['🇺🇸', 'United States'],
  KAZ: ['🇰🇿', 'Kazakhstan'], POL: ['🇵🇱', 'Poland'], ITA: ['🇮🇹', 'Italy'], ESP: ['🇪🇸', 'Spain'], FRA: ['🇫🇷', 'France'],
  GER: ['🇩🇪', 'Germany'], GBR: ['🇬🇧', 'Great Britain'], CAN: ['🇨🇦', 'Canada'], CHN: ['🇨🇳', 'China'], JPN: ['🇯🇵', 'Japan'],
  GRE: ['🇬🇷', 'Greece'], TUN: ['🇹🇳', 'Tunisia'], BRA: ['🇧🇷', 'Brazil'], SUI: ['🇨🇭', 'Switzerland'], AUS: ['🇦🇺', 'Australia'],
  DEN: ['🇩🇰', 'Denmark'], LAT: ['🇱🇻', 'Latvia'], ROU: ['🇷🇴', 'Romania'], CRO: ['🇭🇷', 'Croatia'], BEL: ['🇧🇪', 'Belgium'],
  NED: ['🇳🇱', 'Netherlands'], SRB: ['🇷🇸', 'Serbia'], SVK: ['🇸🇰', 'Slovakia'], ARG: ['🇦🇷', 'Argentina'], MEX: ['🇲🇽', 'Mexico'],
  COL: ['🇨🇴', 'Colombia'], EGY: ['🇪🇬', 'Egypt'],
};
const ROUND_NAMES = { RR: 'Group stage', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final' };
const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const sched = { at: 0, found: [] };   // found: Cito items already seen for this tournament

function fromCito(it, data) {
  const known = {};
  data.matches.forEach((m) => { [m.p1, m.p2].forEach((p) => { known[last(p.name)] = p; }); });
  const person = (p) => {
    const k = last(p.name), old = known[k];
    const c = COUNTRIES[p.ioc] || ['🎾', p.ioc || ''];
    if (old) return Object.assign({}, old, { ioc: p.ioc, country: c[1] });
    const parts = String(p.name).trim().split(/\s+/);
    return { name: parts[parts.length - 1], flag: c[0], full: p.name, ioc: p.ioc, country: c[1] };
  };
  const t = Date.parse(it.scheduled_at);
  const u = new Date(t + 4 * 3600000); // UAE wall clock
  const label = DOW[u.getUTCDay()] + ' ' + MON[u.getUTCMonth()] + ' ' + u.getUTCDate();
  const h = u.getUTCHours(), mm = String(u.getUTCMinutes()).padStart(2, '0');
  const time = ((h % 12) || 12) + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM') + ' UAE';
  const day = Math.round((Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()) - Date.UTC(2026, 10, 9)) / 86400000);
  const rc = it.round || 'RR';
  const court = (String(it.court || '').match(/(\d+)\s*$/) || [])[1];
  const p1 = person(it.player1), p2 = person(it.player2);
  return {
    id: (last(p1.full) + '-' + last(p2.full) + (rc === 'RR' ? '' : '-' + rc.toLowerCase())),
    status: 'upcoming', court: court ? 'Court ' + court : 'Court 2', label, time,
    p1, p2, sets: [], start: new Date(t).toISOString(),
    dayText: 'Day ' + (ORDINALS[day] || (day + 1)) + ' of the WTA Finals',
    roundCode: rc, round: ROUND_NAMES[rc] || it.round_name || 'Match', fromCito: true,
  };
}

async function citoSchedule(data) {
  if (!process.env.CITO_API_KEY) return;
  const now = Date.now();
  if (now - sched.at >= 3 * 60 * 60 * 1000 && (cito.remaining === null || cito.remaining > 60)) {
    sched.at = now;
    try {
      const latest = Math.max.apply(null, data.matches.map((m) => Date.parse(m.start) || 0).concat([now]));
      const dates = [];
      for (let i = 0; i < 3; i++) dates.push(new Date(latest + i * 86400000).toISOString().slice(0, 10));
      let empty = 0;
      for (const d of dates) {
        if (empty >= 1) break;                      // stop at the first day that is not published yet
        const j = await citoGet('/schedule?date=' + d + '&tour=wta&page_size=100');
        const items = (j.items || []).filter((x) => x.tournament_id === CITO_TOURNAMENT && x.match_type !== 'doubles');
        if (!items.length) { empty++; continue; }
        items.forEach((x) => { if (!sched.found.some((y) => y.match_id === x.match_id)) sched.found.push(x); });
      }
    } catch (e) { /* schedule is optional */ }
  }
  const have = (it) => data.matches.some((m) => pairKey(m.p1.name, m.p2.name) === pairKey(it.player1.name, it.player2.name) && (m.roundCode || 'RR') === (it.round || 'RR'));
  const fresh = sched.found.filter((it) => !have(it) && !/COMPLETED|FINISHED|CANCEL/i.test(it.status || '')).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  if (!fresh.length) return;
  let order = Math.max.apply(null, data.matches.map((m) => m.order || 0));
  const add = fresh.map((it) => fromCito(it, data));
  // later matches of a day are "estimated" (they follow the earlier one on court)
  const firstOfDay = {};
  add.forEach((m) => { if (firstOfDay[m.label] === undefined) firstOfDay[m.label] = m.start; else m.time += ' (EST.)'; });
  add.forEach((m) => { m.order = ++order; data.matches.push(m); });
}

const setWon = (x, y) => (x >= 6 && x - y >= 2) || (x === 7 && (y === 5 || y === 6));
// ---------------------------------------------------------------------------------------------
// ESPN scoreboard (public site feed, no key; unofficial and undocumented, so it is only used inside try/catch):
//  - official FINAL set scores (with tiebreak points) for finished matches, ahead of the Cito check,
//  - newly listed matches (semifinals, final, next day's order of play) once both players are known.
// One request every 3 minutes while a match is due or live, otherwise every 30 minutes.
// ---------------------------------------------------------------------------------------------
const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard';
const espn = { at: 0, comps: [] };
const ESPN_ROUNDS = { 'group stage': 'RR', 'round robin': 'RR', quarterfinal: 'QF', semifinal: 'SF', final: 'F' };

function espnSets(c1, c2, notes) {
  const out = [];
  const n = Math.max((c1.linescores || []).length, (c2.linescores || []).length);
  const tbs = [];
  String(notes || '').replace(/\((\d+)-(\d+)\)/g, (m, a, b) => { tbs.push(Math.min(Number(a), Number(b))); return m; });
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = (c1.linescores || [])[i], b = (c2.linescores || [])[i];
    if (!a || !b || a.value == null || b.value == null) continue;
    const set = { p1: a.value, p2: b.value };
    const tie = (a.value === 7 && b.value === 6) || (a.value === 6 && b.value === 7);
    if (tie) {
      const loser = a.value === 6 ? a : b;                 // tiebreak points of the loser, as on the page
      if (loser.tiebreak != null) set.tb = loser.tiebreak;
      else if (tbs[k] != null) set.tb = tbs[k];
      k++;
    }
    out.push(set);
  }
  return out;
}

async function espnSync(data) {
  const now = Date.now();
  const due = data.matches.some((m) => m.status !== 'final' && m.start && now > Date.parse(m.start) - 20 * 60 * 1000 && now < Date.parse(m.start) + 7 * 3600 * 1000);
  if (now - espn.at >= (due ? 3 * 60 * 1000 : 30 * 60 * 1000)) {
    espn.at = now;
    try {
      const r = await fetch(ESPN_URL);
      if (r.ok) {
        const j = await r.json();
        const ev = (j.events || []).find((e) => /WTA Finals/i.test(e.name || ''));
        const grp = ev && (ev.groupings || []).find((g) => /singles/i.test((g.grouping && g.grouping.displayName) || ''));
        espn.comps = grp ? (grp.competitions || []) : [];
      }
    } catch (e) { /* ESPN is optional */ }
  }
  const nameOf = (c) => (c.athlete && (c.athlete.displayName || c.athlete.fullName)) || '';
  let order = Math.max.apply(null, data.matches.map((m) => m.order || 0));
  const fresh = [];
  espn.comps.forEach((c) => {
    const cs = c.competitors || [];
    if (cs.length !== 2) return;
    const n1 = nameOf(cs[0]), n2 = nameOf(cs[1]);
    if (!n1 || !n2 || /tbd/i.test(n1 + n2)) return;
    const rc = ESPN_ROUNDS[String((c.round && c.round.displayName) || '').toLowerCase()] || 'RR';
    const key = pairKey(n1, n2);
    const m = data.matches.find((x) => pairKey(x.p1.name, x.p2.name) === key && (x.roundCode || 'RR') === rc);
    const st = c.status && c.status.type;
    if (m) {
      if (m.status === 'final' || !st || !st.completed) return;
      const same = last(n1) === last(m.p1.name);
      const sets = espnSets(same ? cs[0] : cs[1], same ? cs[1] : cs[0], (c.notes && c.notes[0] && c.notes[0].text) || '');
      const w1 = sets.filter((x) => setWon(x.p1, x.p2)).length, w2 = sets.filter((x) => setWon(x.p2, x.p1)).length;
      if (!sets.length || Math.max(w1, w2) < 2) return;      // not a complete best-of-three result: leave it to the other feeds
      m.status = 'final'; m.sets = sets;
      delete m.note; delete m.live; delete m.server; delete m.points; delete m.lag; delete m.paused; delete m.alert; delete m.alertUntil; delete m.alertSig;
      finals[m.id] = { sets };
    } else if (st && st.name !== 'STATUS_FINAL' && c.timeValid !== false) {   // ESPN lists semifinal/final slots with placeholder times until the order of play is set
      fresh.push({ scheduled_at: c.date || c.startDate, player1: { name: n1 }, player2: { name: n2 }, round: rc, court: null, status: 'SCHEDULED' });
    }
  });
  if (fresh.length) {
    fresh.sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    const add = fresh.map((it) => fromCito(it, data));
    const first = {};
    add.forEach((m) => { if (first[m.label] === undefined) first[m.label] = true; else m.time += ' (EST.)'; m.source = 'espn'; });
    add.forEach((m) => { m.order = ++order; delete m.fromCito; m.fromCito = true; data.matches.push(m); });
  }
}

// Live match stats (aces, serve %, break points ...) from the Cito live feed. One request every 5 minutes while a match is live
// (the free plan allows 500/month); the last snapshot is kept so the page always has the latest known numbers.
const statsMemo = {};   // match id -> { at, rows }
let statsTriedAt = 0;
const STAT_KEYS = [
  ['total_points_won', 'Points won'],
  ['aces', 'Aces'],
  ['double_faults', 'Double faults'],
  ['first_serve_points_won', '1st serve points won'],
  ['second_serve_points_won', '2nd serve points won'],
  ['break_points_won', 'Break points won'],
  ['service_games_won', 'Service games won'],
  ['max_points_in_a_row', 'Longest run of points'],
];
function statRows(item, same) {
  const by = {};
  (item.stats || []).forEach((x) => { (by[x.key] = by[x.key] || {})[x.side] = x; });
  const rows = [];
  STAT_KEYS.forEach(([key, label]) => {
    const e = by[key]; if (!e || !e[1] || !e[2]) return;
    const a = same ? e[1] : e[2], b = same ? e[2] : e[1];
    const share = (a.pct != null && b.pct != null) ? [a.pct, b.pct] : [Number(a.numerator) || 0, Number(b.numerator) || 0];
    const tot = share[0] + share[1];
    rows.push({ label, p1: a.display, p2: b.display, w1: tot ? Math.round(share[0] / tot * 100) : 50 });
  });
  return rows;
}
async function citoStats(data) {
  if (!process.env.CITO_API_KEY) return;
  const live = data.matches.filter((m) => m.status === 'live' && m.live);
  if (live.length) {
    const now = Date.now();
    if (now - statsTriedAt >= 5 * 60 * 1000 && (cito.remaining === null || cito.remaining > 60)) {
      statsTriedAt = now;
      try {
        const items = await citoLiveItems(5 * 60 * 1000);
        items.forEach((it) => {
          if (!it.stats_available) return;
          const m = findMatch(data, it);
          if (!m || m.status === 'final') return;
          const same = last(it.player1.name) === last(m.p1.name);
          const rows = statRows(it, same);
          if (rows.length) statsMemo[m.id] = { at: new Date().toISOString(), rows };
        });
      } catch (e) { /* stats are optional */ }
    }
  }
  data.matches.forEach((m) => { if (m.status === 'live' && m.live && statsMemo[m.id]) m.stats = statsMemo[m.id]; });
}

module.exports = async (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const base = process.env.STATIC_BASE || proto + '://' + req.headers.host;
  let data;
  try {
    data = await loadStatic(base);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'static scores unavailable' });
  }
  data.source = 'static';
  let ttl = 60;
  // Apply finals already confirmed on this instance (saves Cito calls).
  try { await citoSchedule(data); } catch (e) { /* optional */ }
  data.matches.forEach((m) => { if (finals[m.id] && m.status !== 'final') { m.status = 'final'; m.sets = finals[m.id].sets; delete m.note; delete m.live; delete m.server; } });
  let primaryOk = false;
  try {
    const keys = [process.env.TENNIS_API_KEY, process.env.TENNIS_API_KEY2].filter(Boolean);
    if (keys.length && windowOpen(data.matches, Date.now())) {
      data = await overlayLive(data, keys);
      primaryOk = true;
      ttl = Math.ceil(memoTtl / 1000); // matches the provider memo: about 2 minutes while live
    }
  } catch (e) {
    data.source = 'static';
  }
  try {
    try { await espnSync(data); } catch (e) { /* optional */ }
    await citoAssist(data, primaryOk);
    await citoStats(data);
    if (data.matches.some((m) => finals[m.id])) { data.updated = new Date().toISOString(); }
  } catch (e) { /* Cito is best-effort */ }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + ttl + ', stale-while-revalidate=20');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(data);
};
