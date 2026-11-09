// Live score endpoint for the WTA Finals page.
// - Reads the confirmed schedule/results from /data/scores.json (static, maintained by hand).
// - If TENNIS_API_KEY is set and a match window is open, overlays LIVE scores from Live Tennis API.
// - Never overwrites a confirmed final. Falls back to the static file on any problem.
// The key lives only in the TENNIS_API_KEY environment variable (never in the page or repo).

const PROVIDER = 'https://api.livetennisapi.com/api/public/v1/matches?tour=wta&status=live&limit=50';

// Quota guards (kept per warm serverless instance, on top of the CDN cache).
let blockedUntil = 0;          // set when the provider says the daily allowance is spent
let memo = null;               // last good provider response
let memoAt = 0;
const MEMO_MS = 120000;        // never call the provider more than once per 2 minutes per instance

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

async function fetchProvider(key) {
  const now = Date.now();
  if (now < blockedUntil) throw new Error('quota blocked');
  if (memo && now - memoAt < MEMO_MS) return memo;
  const r = await fetch(PROVIDER, { headers: { Authorization: 'Bearer ' + key } });
  if (r.status === 429) {
    let until = now + 15 * 60 * 1000;
    try {
      const j = await r.json();
      if (j && j.resets_at) until = Math.max(until, Date.parse(j.resets_at) + 30000);
    } catch (e) {}
    blockedUntil = until;
    throw new Error('rate limited');
  }
  if (!r.ok) throw new Error('provider ' + r.status);
  memo = await r.json();
  memoAt = now;
  return memo;
}

async function overlayLive(data, key) {
  const body = await fetchProvider(key);
  const live = new Map();
  (body.data || []).forEach((pm) => {
    if (pm.is_doubles) return;
    live.set(pairKey(pm.players.p1.name, pm.players.p2.name), pm);
  });

  data.matches.forEach((m) => {
    if (m.status === 'final') return; // confirmed results are never overwritten
    const pm = live.get(pairKey(m.p1.name, m.p2.name));
    if (!pm) {
      // We had it as live, the feed no longer lists it live: probably just finished.
      if (m.status === 'live') m.note = 'Match finished — final score being confirmed';
      return;
    }
    const sc = pm.score || {};
    const g = sc.games || [[], []];
    const same = last(pm.players.p1.name) === last(m.p1.name);
    const a = same ? g[0] : g[1];
    const b = same ? g[1] : g[0];
    const sets = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) sets.push({ p1: a[i] || 0, p2: b[i] || 0 });
    m.status = 'live';
    m.sets = sets;
    m.live = true;
    delete m.note;
    // Provider: server 1 = its p1, 2 = its p2. Map to our p1/p2 (names may be in a different order).
    delete m.server;
    if (sc.server === 1 || sc.server === 2) {
      const srv = sc.server === 1 ? 'p1' : 'p2';
      m.server = same ? srv : (srv === 'p1' ? 'p2' : 'p1');
    }
    if (sc.is_tiebreak && Array.isArray(sc.points)) {
      const p = same ? sc.points : [sc.points[1], sc.points[0]];
      m.note = 'Tiebreak ' + p[0] + '-' + p[1];
    } else if (Array.isArray(sc.points) && sc.points.length === 2) {
      const p = same ? sc.points : [sc.points[1], sc.points[0]];
      m.note = 'Game: ' + p[0] + '-' + p[1];
    }
  });
  data.updated = new Date().toISOString();
  data.source = 'live';
  return data;
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
  try {
    const key = process.env.TENNIS_API_KEY;
    if (key && windowOpen(data.matches, Date.now())) {
      data = await overlayLive(data, key);
      ttl = 300; // 5 minutes: ~12 provider calls/hour, well inside the free 100/day
    }
  } catch (e) {
    data.source = 'static';
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + ttl + ', stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(data);
};
