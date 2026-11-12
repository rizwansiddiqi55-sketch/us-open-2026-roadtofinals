// TEMPORARY: reports the field names of the live-score provider response (no key, no secrets). To be deleted after use.
function paths(o, p, acc) {
  if (Array.isArray(o)) { if (o.length) paths(o[0], p + '[]', acc); return acc; }
  if (o && typeof o === 'object') { Object.keys(o).forEach((k) => paths(o[k], p ? p + '.' + k : k, acc)); return acc; }
  acc[p] = o; return acc;
}
module.exports = async (req, res) => {
  const key = process.env.TENNIS_API_KEY;
  const out = {};
  const urls = {
    wta: 'https://api.livetennisapi.com/api/public/v1/matches?tour=wta&status=live&limit=5',
    atp: 'https://api.livetennisapi.com/api/public/v1/matches?tour=atp&status=live&limit=2',
  };
  for (const [name, u] of Object.entries(urls)) {
    try {
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + key } });
      const body = await r.json().catch(() => null);
      const items = body && body.data ? body.data : [];
      const flat = items.length ? paths(items[0], '', {}) : {};
      out[name] = {
        http: r.status, topKeys: body ? Object.keys(body) : null, count: items.length,
        fields: flat,
        speedFields: Object.keys(flat).filter((k) => /speed|mph|kmh|km_h|fast/i.test(k)),
      };
    } catch (e) { out[name] = { error: String(e.message || e) }; }
    if (out[name].count) break;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
