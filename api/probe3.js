// TEMPORARY: checks which endpoints the Tennis Database API answers on this key (key never echoed). To be deleted after use.
const BASE = 'https://api.tennisdatabaseapi.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  await sleep(400);
  try {
    const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + (process.env.TENNISDB_API_KEY || ''), Accept: 'application/json' } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    const lim = {}; ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'x-plan'].forEach((k) => { const v = r.headers.get(k); if (v !== null) lim[k] = v; });
    return { path, http: r.status, type: r.headers.get('content-type'), limits: lim, topKeys: j && typeof j === 'object' ? Object.keys(j).slice(0, 12) : null, sample: t.slice(0, 500).replace(process.env.TENNISDB_API_KEY || '@@', '[key]') };
  } catch (e) { return { path, error: String(e.message || e) }; }
}
module.exports = async (req, res) => {
  const out = { haveKey: !!process.env.TENNISDB_API_KEY, keyLength: (process.env.TENNISDB_API_KEY || '').length, results: [] };
  if (!out.haveKey) return res.status(200).json(out);
  for (const p of ['/v1/results/yesterday', '/v1/results/today', '/v1/live', '/v1/matches/live', '/v1/fixtures/today', '/v1/stats', '/openapi.json', '/v1/openapi.json', '/docs', '/v1']) out.results.push(await get(p));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
