// TEMPORARY: reads WTA Finals matches and their statistics from the Tennis Database API (key never echoed). To be deleted after use.
const BASE = 'https://api.tennisdatabaseapi.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  await sleep(900);
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + (process.env.TENNISDB_API_KEY || ''), Accept: 'application/json' } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  const lim = {}; ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'].forEach((k) => { const v = r.headers.get(k); if (v !== null) lim[k] = v; });
  return { http: r.status, j, text: t, lim };
}
const names = /Gauff|Kostyuk|Pegula|Noskova|Sabalenka|Andreeva|Svitolina|Muchov/i;
module.exports = async (req, res) => {
  const out = { haveKey: !!process.env.TENNISDB_API_KEY };
  if (!out.haveKey) return res.status(200).json(out);
  try {
    const u = await get('/usage'); out.usage = { http: u.http, body: u.j };
    const m = await get('/matches?date=2026-11-12&tour=women&per_page=50');
    const list = (m.j && m.j.data) || [];
    out.matches = { http: m.http, meta: m.j && m.j.meta, count: list.length, wtaFinals: list.filter((x) => names.test(JSON.stringify([x.winner, x.loser])) ).map((x) => ({ id: x.id, tournament: x.tournament && x.tournament.name, round: x.round, winner: x.winner && x.winner.name, loser: x.loser && x.loser.name, score: x.score, status: x.status, start: x.start_time, keys: Object.keys(x) })) };
    const ids = out.matches.wtaFinals.map((x) => x.id).slice(0, 2);
    out.statistics = [];
    for (const id of ids) { const s = await get('/matches/' + id + '/statistics'); out.statistics.push({ id, http: s.http, lim: s.lim, topKeys: s.j && Object.keys(s.j), sample: s.text.slice(0, 2600) }); }
    if (ids[0]) { const p = await get('/matches/' + ids[0] + '/points'); out.points = { id: ids[0], http: p.http, topKeys: p.j && Object.keys(p.j), sample: p.text.slice(0, 700) }; }
    const f = await get('/fixtures?tour=women&per_page=20'); out.fixtures = { http: f.http, count: ((f.j && f.j.data) || []).length, wtaFinals: ((f.j && f.j.data) || []).filter((x) => names.test(JSON.stringify(x))).slice(0, 6).map((x) => ({ id: x.id, start: x.start_time, round: x.round, players: [x.player1 && x.player1.name, x.player2 && x.player2.name], status: x.status, keys: Object.keys(x) })) };
  } catch (e) { out.error = String(e.message || e); }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
