// TEMPORARY: reports what TheRundown returns for WTA tennis on this (free) key. No key in the output. To be deleted after use.
const BASE = 'https://therundown.io/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  await sleep(1300);   // free plan allows 1 request per second
  const r = await fetch(BASE + path, { headers: { 'X-TheRundown-Key': process.env.THERUNDOWN_API_KEY || '' } });
  let body = null; try { body = await r.json(); } catch (e) {}
  const h = {}; ['x-datapoints', 'x-datapoints-used', 'x-datapoints-remaining', 'x-data-delay-seconds', 'x-plan', 'x-stats-access', 'x-stats-evaluation-active', 'x-stats-evaluation-expires-at'].forEach((k) => { const v = r.headers.get(k); if (v !== null) h[k] = v; });
  return { http: r.status, body, headers: h };
}
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o) : null);
module.exports = async (req, res) => {
  const out = { haveKey: !!process.env.THERUNDOWN_API_KEY };
  if (!out.haveKey) return res.status(200).json(out);
  try {
    const sp = await get('/sports');
    out.sports = { http: sp.http, headers: sp.headers, wta: JSON.stringify(sp.body || '').match(/WTA[^}]{0,80}/g) || null };
    const events = [];
    for (const date of ['2026-11-12']) {
      const e = await get('/sports/39/events/' + date + '?affiliate_ids=0&offset=0');
      const list = (e.body && (e.body.events || e.body.data)) || [];
      out['events_' + date] = { http: e.http, headers: e.headers, error: e.body && (e.body.error || e.body.message) || null, topKeys: keysOf(e.body), count: list.length };
      list.forEach((ev) => events.push({ date, id: ev.event_id || ev.id, status: (ev.score && ev.score.event_status) || ev.event_status || null, teams: (ev.teams || []).map((t) => t.name || t.team_name || JSON.stringify(t).slice(0, 40)), score: ev.score ? Object.fromEntries(Object.entries(ev.score).filter(([k]) => !/^(winner|venue)/i.test(k)).slice(0, 14)) : null, keys: keysOf(ev), schedule: ev.event_date || ev.date || null }));
    }
    out.events = events.slice(0, 14);
    const wtaF = (x) => x.teams.some((t) => /Gauff|Kostyuk|Pegula|Noskova/.test(t));
    const pick = events.filter((x) => wtaF(x) && /final/i.test(String(x.status))).slice(0, 1).concat(events.filter((x) => wtaF(x) && /progress/i.test(String(x.status))).slice(0, 1));
    out.statsTried = [];
    for (const ev of pick) {
      const s = await get('/events/' + ev.id + '/players/stats');
      const b = s.body || {};
      out.statsTried.push({ id: ev.id, status: ev.status, http: s.http, headers: s.headers, error: b.error || b.message || null, topKeys: keysOf(b), sample: JSON.stringify(b).slice(0, 1800) });
    }
  } catch (e) { out.error = String(e.message || e); }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
