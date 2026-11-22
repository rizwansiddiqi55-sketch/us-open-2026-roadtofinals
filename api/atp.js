// Nitto ATP Finals (Turin): singles schedule, live scores and results, shaped from ESPN's public scoreboard.
// The page /atp-finals-2026/ reads this. Cached briefly at the edge; every stage fails soft.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';

function sets(c1, c2, notes) {
  const out = [], tbs = [];
  String(notes || '').replace(/\((\d+)-(\d+)\)/g, (m, a, b) => { tbs.push(Math.min(Number(a), Number(b))); return m; });
  const n = Math.max((c1.linescores || []).length, (c2.linescores || []).length);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = (c1.linescores || [])[i], b = (c2.linescores || [])[i];
    if (!a || !b || a.value == null || b.value == null) continue;
    const s = { p1: a.value, p2: b.value };
    if ((a.value === 7 && b.value === 6) || (a.value === 6 && b.value === 7)) {
      const loser = a.value === 6 ? a : b;
      if (loser.tiebreak != null) s.tb = loser.tiebreak; else if (tbs[k] != null) s.tb = tbs[k];
      k++;
    }
    out.push(s);
  }
  return out;
}
function player(c) {
  const a = c.athlete || {};
  const flag = a.flag && a.flag.href ? (a.flag.href.match(/\/([a-z]{3})\.png/i) || [])[1] : '';
  return { name: a.displayName || 'TBD', short: a.shortName || a.displayName || 'TBD', rank: (c.curatedRank && c.curatedRank.current) || null, ioc: flag ? flag.toUpperCase() : '', country: (a.flag && a.flag.alt) || '' };
}
const ROUND = { 'group stage': 'RR', semifinal: 'SF', final: 'F' };

// ---------------------------------------------------------------------------------------------
// Live Tennis API (free plan: 100 requests a day, resetting at 22:00 UTC). Adds the point score, who is serving and fresher games for matches
// ESPN shows live. One request about every 2 minutes at most (4 minutes after the first 45 requests of the day), and none when no match is on.
// ---------------------------------------------------------------------------------------------
const LT = 'https://api.livetennisapi.com/api/public/v1/matches?tour=atp&status=live&limit=50';
const LT_LIMIT = Number(process.env.TENNIS_DAY_LIMIT) || 95;
const lt = { memo: null, at: 0, ttl: 90000, day: -1, calls: 0, blockedUntil: 0, note: '' };
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const lastName = (n) => norm(n).split(/\s+/).pop();
const pairKey = (a, b) => [lastName(a), lastName(b)].sort().join('|');
const cleanKey = (k) => String(k || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^bearer\s+/i, '').trim();

async function liveFeed() {
  const key = cleanKey(process.env.TENNIS_API_KEY);
  if (!key) { lt.note = 'no key'; return null; }
  const now = Date.now(), day = Math.floor((now - 22 * 3600000) / 86400000);
  if (day !== lt.day) { lt.day = day; lt.calls = 0; }
  if (lt.memo && now - lt.at < lt.ttl) return lt.memo;
  if (now < lt.blockedUntil) return lt.memo && now - lt.at < 10 * 60000 ? lt.memo : null;
  if (lt.calls >= LT_LIMIT) { lt.note = 'daily limit reached'; return null; }
  lt.calls++;
  try {
    let r = await fetch(LT, { headers: { Authorization: 'Bearer ' + key } });
    if (r.status === 401 || r.status === 403) { const r2 = await fetch(LT, { headers: { 'X-API-Key': key } }); if (r2.ok || (r2.status !== 401 && r2.status !== 403)) r = r2; }
    if (r.status === 429) { let until = now + 15 * 60000; try { const j = await r.json(); if (j && j.resets_at) until = Math.max(until, Date.parse(j.resets_at) + 30000); } catch (e) { /* keep the default */ } lt.blockedUntil = until; lt.note = 'rate limited'; return null; }
    if (r.status === 401 || r.status === 403) { lt.blockedUntil = now + 10 * 60000; lt.note = 'key rejected ' + r.status; return null; }
    if (!r.ok) { lt.note = 'http ' + r.status; return null; }
    lt.memo = await r.json(); lt.at = now; lt.ttl = lt.calls < 80 ? 90000 : 180000;   // every 90 s for the first 80 calls of the day, then every 3 min so the free 100/day lasts to the end of the match lt.note = '';
    return lt.memo;
  } catch (e) { lt.note = 'unreachable'; return null; }
}

// ---------------------------------------------------------------------------------------------
// Live match statistics from Cito's live feed (monthly request budget): at most one request every 5 minutes while an ATP match is live.
// The last numbers are kept so they can be shown after the match.
// ---------------------------------------------------------------------------------------------
const CITO_LIVE = 'https://api.citoapi.com/api/v1/tennis/live';
const cito = [{ remaining: null, blockedUntil: 0 }, { remaining: null, blockedUntil: 0 }];
const statsMemo = {};   // match id -> { at, rows }
let statsTriedAt = 0, statsNote = '';
const STAT_KEYS = [['total_points_won', 'Points won'], ['aces', 'Aces'], ['double_faults', 'Double faults'], ['first_serve_points_won', '1st serve points won'], ['second_serve_points_won', '2nd serve points won'], ['break_points_won', 'Break points won'], ['service_games_won', 'Service games won'], ['max_points_in_a_row', 'Longest run of points']];
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
async function citoLive() {
  const keys = [process.env.CITO_API_KEY, process.env.CITO_API_KEY2];
  const order = keys.map((k, i) => ({ k: cleanKey(k), st: cito[i] })).filter((x) => x.k && Date.now() >= x.st.blockedUntil && (x.st.remaining === null || x.st.remaining > 40))
    .sort((a, b) => (b.st.remaining === null ? 1e9 : b.st.remaining) - (a.st.remaining === null ? 1e9 : a.st.remaining));
  for (const x of order) {
    try {
      const r = await fetch(CITO_LIVE, { headers: { 'x-api-key': x.k } });
      const rem = r.headers && r.headers.get ? r.headers.get('x-ratelimit-monthly-remaining') : null;
      if (rem !== null && rem !== undefined && rem !== '') x.st.remaining = Number(rem);
      if (r.status === 429) { x.st.blockedUntil = Date.now() + 30 * 60000; statsNote = 'cito rate limited'; continue; }
      if (r.status === 401 || r.status === 403) { x.st.blockedUntil = Date.now() + 60 * 60000; statsNote = 'cito key rejected'; continue; }
      if (!r.ok) { statsNote = 'cito ' + r.status; continue; }
      statsNote = ''; return (await r.json()).items || [];
    } catch (e) { statsNote = 'cito unreachable'; }
  }
  if (!order.length && !statsNote) statsNote = 'no cito budget';
  return null;
}
async function attachStats(matches) {
  const live = matches.filter((m) => m.status === 'live');
  if (live.length && Date.now() - statsTriedAt >= 5 * 60000) {
    statsTriedAt = Date.now();
    const items = await citoLive();
    (items || []).forEach((it) => {
      if (!it.stats_available || !it.player1 || !it.player2) return;
      const m = live.find((x) => pairKey(x.p1.name, x.p2.name) === pairKey(it.player1.name, it.player2.name));
      if (!m) return;
      const rows = statRows(it, lastName(it.player1.name) === lastName(m.p1.name));
      if (rows.length) statsMemo[m.id] = { at: new Date().toISOString(), rows };
    });
  }
  matches.forEach((m) => { if ((m.status === 'live' || (m.status === 'final' && !live.length)) && statsMemo[m.id]) m.stats = statsMemo[m.id]; });
}

async function overlayLive(matches) {
  const now = Date.now();
  const active = matches.some((m) => m.status === 'live' || (m.status === 'upcoming' && m.timeValid && now >= Date.parse(m.start) - 15 * 60000 && now <= Date.parse(m.start) + 5 * 3600000));
  if (!active) return false;
  const body = await liveFeed();
  if (!body || !Array.isArray(body.data)) return false;
  const byPair = new Map();
  body.data.forEach((pm) => { if (!pm.is_doubles && pm.players && pm.players.p1 && pm.players.p2) byPair.set(pairKey(pm.players.p1.name, pm.players.p2.name), pm); });
  let used = false;
  matches.forEach((m) => {
    if (m.status === 'final') return;
    const pm = byPair.get(pairKey(m.p1.name, m.p2.name));
    if (!pm) return;
    const sc = pm.score || {}, g = sc.games || [[], []], same = lastName(pm.players.p1.name) === lastName(m.p1.name);
    const a = same ? g[0] : g[1], b = same ? g[1] : g[0], sets = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) sets.push({ p1: a[i] || 0, p2: b[i] || 0 });
    if (!sets.length) return;
    // ESPN is authoritative for sets that are already finished; the live feed only supplies the set in progress (it can be a game out on earlier sets)
    const finished = (x) => (x.p1 >= 6 && x.p1 - x.p2 >= 2) || x.p1 === 7 || (x.p2 >= 6 && x.p2 - x.p1 >= 2) || x.p2 === 7;
    (m.sets || []).forEach((e, i) => { if (i < sets.length - 1 && finished(e)) sets[i] = { p1: e.p1, p2: e.p2, tb: e.tb }; });
    const total = (x) => x.reduce((t, y) => t + y.p1 + y.p2, 0);
    if (m.status === 'live' && (sets.length < m.sets.length || total(sets) < total(m.sets))) return;   // a score never goes backwards
    m.status = 'live'; m.sets = sets; m.feed = 'livetennis'; used = true;
    if (sc.server === 1 || sc.server === 2) { const srv = sc.server === 1 ? 'p1' : 'p2'; m.server = same ? srv : (srv === 'p1' ? 'p2' : 'p1'); }
    if (Array.isArray(sc.points) && sc.points.length === 2) { const pp = same ? sc.points : [sc.points[1], sc.points[0]]; m.points = pp.map((x) => (String(x).toUpperCase() === 'A' ? 'AD' : String(x).toUpperCase())); m.note = (sc.is_tiebreak ? 'Tiebreak: ' : 'Game: ') + m.points[0] + '-' + m.points[1]; }
  });
  return used;
}

const ESPN_URLS = [ESPN, 'https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard', ESPN + '?lang=en&region=us'];
let lastGood = null;   // last complete response, served if ESPN fails for a moment
async function getScoreboard() {
  const why = [];
  for (const url of ESPN_URLS) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; tennis-fan-page)' } }); clearTimeout(t);
      if (!r.ok) { why.push(new URL(url).host + ' http ' + r.status); continue; }
      const j = await r.json();
      if (j && Array.isArray(j.events)) return { j };
      why.push(new URL(url).host + ' no events');
    } catch (e) { why.push(new URL(url).host + ' ' + ((e && (e.cause && e.cause.code || e.name)) || 'error')); }
  }
  return { why: why.join('; ') };
}

// Saved copy of the schedule and results (data/atp-snapshot.json), used only when ESPN cannot be reached from the server.
function loadSnapshot() {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'atp-snapshot.json'), 'utf8')); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  const got = await getScoreboard();
  const j = got.j;
  let snapMatches = null, snapNote = '';
  if (!j) {
    if (lastGood) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json(Object.assign({}, lastGood, { stale: true, feedNote: got.why })); }
    const snap = loadSnapshot();
    if (!snap || !Array.isArray(snap.matches)) { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ error: 'scoreboard unavailable', reason: got.why }); }
    snapMatches = snap.matches; snapNote = 'ESPN unreachable (' + got.why + '); showing saved schedule with live scores from the live feed';
  }
  const ev = ((j && j.events) || []).find((e) => /ATP Finals/i.test(e.name || ''));
  const grp = ev && (ev.groupings || []).find((g) => /singles/i.test((g.grouping && g.grouping.displayName) || ''));
  const matches = [];
  ((grp && grp.competitions) || []).forEach((c) => {
    const cs = c.competitors || [];
    if (cs.length !== 2) return;
    const st = (c.status && c.status.type) || {};
    // ESPN reports a halted match (suspended, delayed, medical timeout) as state 'post' with completed:false: it is still in progress
    const halted = st.state === 'post' && st.completed === false && !(cs[0].winner || cs[1].winner);
    const status = (st.state === 'in' || halted) ? 'live' : (st.state === 'post' ? 'final' : 'upcoming');
    const notes = ((c.notes || [])[0] || {}).text || '';
    const s = sets(cs[0], cs[1], notes);
    matches.push({
      id: c.id, roundCode: ROUND[String((c.round && c.round.displayName) || '').toLowerCase()] || 'RR', round: (c.round && c.round.displayName) || 'Group stage',
      status, start: c.startDate, timeValid: c.timeValid !== false, court: (c.venue && c.venue.court) || '',
      p1: player(cs[0]), p2: player(cs[1]), sets: status === 'upcoming' ? [] : s,
      winner: cs[0].winner ? 'p1' : (cs[1].winner ? 'p2' : null), detail: st.detail || '',
    });
    if (halted) matches[matches.length - 1].note = 'Play halted (' + (st.detail || 'suspended') + ')';
  });
  if (snapMatches) snapMatches.forEach((m) => matches.push(m));
  matches.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Number(a.id) - Number(b.id));
  let feed = snapMatches ? 'saved' : 'espn';
  try { if (await overlayLive(matches)) feed = 'livetennis'; } catch (e) { /* ESPN alone is fine */ }
  try { await attachStats(matches); } catch (e) { /* stats are optional */ }
  // Groups: players linked by round-robin matches (ESPN does not name the groups)
  const parent = {};
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const rank = {};
  matches.filter((m) => m.roundCode === 'RR').forEach((m) => {
    [m.p1, m.p2].forEach((p) => { if (!parent[p.name]) parent[p.name] = p.name; rank[p.name] = p.rank; });
    parent[find(m.p1.name)] = find(m.p2.name);
  });
  const g = {};
  Object.keys(parent).forEach((n) => { (g[find(n)] = g[find(n)] || []).push(n); });
  const groups = Object.keys(g).map((k) => g[k].sort((a, b) => (rank[a] || 99) - (rank[b] || 99)))
    .sort((a, b) => (rank[a[0]] || 99) - (rank[b[0]] || 99))
    .map((players, i) => ({ name: 'Group ' + 'AB'[i], players }));
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + (matches.some((m) => m.status === 'live') ? 20 : 120) + ', stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const out = { updated: new Date().toISOString(), tournament: 'Nitto ATP Finals 2026', venue: 'Inalpi Arena, Turin', feed, stale: snapMatches ? true : undefined, feedNote: snapNote || lt.note || undefined, feedCalls: lt.calls, statsNote: statsNote || undefined, matches, groups };
  lastGood = out;
  res.status(200).json(out);
};
