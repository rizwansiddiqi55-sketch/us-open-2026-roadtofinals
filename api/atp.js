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
const lt = { memo: null, at: 0, ttl: 120000, day: -1, calls: 0, blockedUntil: 0, note: '' };
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
    lt.memo = await r.json(); lt.at = now; lt.ttl = lt.calls < 45 ? 120000 : 240000; lt.note = '';
    return lt.memo;
  } catch (e) { lt.note = 'unreachable'; return null; }
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
    const total = (x) => x.reduce((t, y) => t + y.p1 + y.p2, 0);
    if (m.status === 'live' && (sets.length < m.sets.length || total(sets) < total(m.sets))) return;   // a score never goes backwards
    m.status = 'live'; m.sets = sets; m.feed = 'livetennis'; used = true;
    if (sc.server === 1 || sc.server === 2) { const srv = sc.server === 1 ? 'p1' : 'p2'; m.server = same ? srv : (srv === 'p1' ? 'p2' : 'p1'); }
    if (Array.isArray(sc.points) && sc.points.length === 2) { const pp = same ? sc.points : [sc.points[1], sc.points[0]]; m.points = pp.map((x) => (String(x).toUpperCase() === 'A' ? 'AD' : String(x).toUpperCase())); m.note = (sc.is_tiebreak ? 'Tiebreak: ' : 'Game: ') + m.points[0] + '-' + m.points[1]; }
  });
  return used;
}

module.exports = async (req, res) => {
  let j;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(ESPN, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error('espn ' + r.status);
    j = await r.json();
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'scoreboard unavailable' });
  }
  const ev = (j.events || []).find((e) => /ATP Finals/i.test(e.name || ''));
  const grp = ev && (ev.groupings || []).find((g) => /singles/i.test((g.grouping && g.grouping.displayName) || ''));
  const matches = [];
  ((grp && grp.competitions) || []).forEach((c) => {
    const cs = c.competitors || [];
    if (cs.length !== 2) return;
    const st = (c.status && c.status.type) || {};
    const status = st.state === 'in' ? 'live' : (st.state === 'post' ? 'final' : 'upcoming');
    const notes = ((c.notes || [])[0] || {}).text || '';
    const s = sets(cs[0], cs[1], notes);
    matches.push({
      id: c.id, roundCode: ROUND[String((c.round && c.round.displayName) || '').toLowerCase()] || 'RR', round: (c.round && c.round.displayName) || 'Group stage',
      status, start: c.startDate, timeValid: c.timeValid !== false, court: (c.venue && c.venue.court) || '',
      p1: player(cs[0]), p2: player(cs[1]), sets: status === 'upcoming' ? [] : s,
      winner: cs[0].winner ? 'p1' : (cs[1].winner ? 'p2' : null), detail: st.detail || '',
    });
  });
  matches.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Number(a.id) - Number(b.id));
  let feed = 'espn';
  try { if (await overlayLive(matches)) feed = 'livetennis'; } catch (e) { /* ESPN alone is fine */ }
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
  res.status(200).json({ updated: new Date().toISOString(), tournament: 'Nitto ATP Finals 2026', venue: 'Inalpi Arena, Turin', feed, feedNote: lt.note || undefined, feedCalls: lt.calls, matches, groups });
};
