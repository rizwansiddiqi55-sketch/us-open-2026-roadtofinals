// Official ATP and WTA singles rankings (top 100) from ESPN's public rankings feed. They change weekly.
const URLS = {
  atp: 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings',
  wta: 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/rankings',
};
let last = null;
function snapshot() { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'rankings-snapshot.json'), 'utf8')); } catch (e) { return null; } }

async function one(tour) {
  let why = '';
  for (let i = 0; i < 2; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(URLS[tour], { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; tennis-fan-page)' } }); clearTimeout(t);
      if (!r.ok) { why = 'http ' + r.status; continue; }
      const j = await r.json();
      const rk = (j.rankings || [])[0];
      if (!rk || !Array.isArray(rk.ranks)) { why = 'no data'; continue; }
      return {
        updated: rk.update || null,
        players: rk.ranks.slice(0, 100).map((x) => {
          const a = x.athlete || {};
          return { rank: x.current, prev: x.previous, points: x.points, name: a.displayName || '', short: a.shortname || '', country: a.citizenshipCountry || '', countryName: a.flagAltText || '', age: a.age || null };
        }),
      };
    } catch (e) { why = (e && (e.cause && e.cause.code || e.name)) || 'error'; }
  }
  return { why };
}

module.exports = async (req, res) => {
  const [atp, wta] = await Promise.all([one('atp'), one('wta')]);
  const out = { fetched: new Date().toISOString(), atp: atp.players || null, wta: wta.players || null, atpUpdated: atp.updated || null, wtaUpdated: wta.updated || null };
  if (!out.atp && last && last.atp) { out.atp = last.atp; out.atpUpdated = last.atpUpdated; out.atpStale = true; }
  if (!out.wta && last && last.wta) { out.wta = last.wta; out.wtaUpdated = last.wtaUpdated; out.wtaStale = true; }
  if ((!out.atp || !out.wta)) { const sn = snapshot(); if (sn) { if (!out.atp && sn.atp) { out.atp = sn.atp; out.atpUpdated = sn.atpUpdated; out.atpStale = true; } if (!out.wta && sn.wta) { out.wta = sn.wta; out.wtaUpdated = sn.wtaUpdated; out.wtaStale = true; } } }
  if (!out.atp && !out.wta) { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ error: 'rankings unavailable', reason: atp.why || wta.why }); }
  if (!out.atpStale && !out.wtaStale) last = out;
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json(out);
};
