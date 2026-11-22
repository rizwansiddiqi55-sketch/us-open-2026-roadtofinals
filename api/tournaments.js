// Tournaments running now and coming up (ATP and WTA), from ESPN's public scoreboard date ranges. Falls back to a saved list.
const BASE = (t) => 'https://site.api.espn.com/apis/site/v2/sports/tennis/' + t + '/scoreboard';
const d8 = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
// We cover only Grand Slams, ATP/WTA 1000 events, the season-ending finals, any tournament in Dubai the Mubadala Abu Dhabi Open and the Qatar Open.
// ESPN does not label tournament levels, so this is a list of names (checked against the 2027 calendar). Edit it here to add or drop events.
const RULES = [
  { re: /^(australian open|roland garros|french open|wimbledon|us open)$/i, cat: 'GRAND SLAM' },
  { re: /^(bnp paribas open|miami open|rolex monte-carlo masters|mutua madrid open|internazionali bnl d'italia|omnium banque nationale.*|national bank open.*|cincinnati open|rolex shanghai masters|rolex paris masters)$/i, cat: '1000', tours: ['ATP', 'WTA'] },
  { re: /^(china open|wuhan open)$/i, cat: '1000', tours: ['WTA'] },
  { re: /^(nitto atp finals|.*wta finals.*)$/i, cat: 'SEASON FINALS' },
  { re: /dubai/i, cat: 'DUBAI' },
  { re: /abu dhabi/i, cat: 'ABU DHABI' },
  { re: /^qatar /i, cat: 'QATAR' },
];
function classify(t) {
  for (const r of RULES) {
    if (!r.re.test(t.name.trim())) continue;
    const tours = r.tours ? t.tours.filter((x) => r.tours.indexOf(x) >= 0) : t.tours;
    if (!tours.length) continue;
    const name = /omnium banque nationale/i.test(t.name) ? 'National Bank Open (Canada)' : (/wta finals/i.test(t.name) ? 'WTA Finals (Indian Wells)' : t.name);
    return Object.assign({}, t, { name, cat: r.cat, tours });
  }
  return null;
}
let last = null;
function snapshot() { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'tournaments-snapshot.json'), 'utf8')); } catch (e) { return null; } }

async function tour(t, from, to) {
  const url = BASE(t) + '?dates=' + d8(from) + '-' + d8(to);
  for (let i = 0; i < 2; i++) {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; tennis-fan-page)' } }); clearTimeout(timer);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j.events)) return j.events.map((e) => ({ name: e.name || e.shortName || '', start: (e.date || '').slice(0, 10), end: (e.endDate || e.date || '').slice(0, 10), venue: (e.venue && (e.venue.displayName || (e.venue.address && [e.venue.address.city, e.venue.address.country].filter(Boolean).join(', ')))) || '' }));
    } catch (e) { /* try again, then give up */ }
  }
  return null;
}

module.exports = async (req, res) => {
  const now = new Date(), from = new Date(now.getTime() - 86400000);
  // ESPN returns a limited number of events per request, so the next ~14 months are asked for in quarter-year windows
  const wins = []; for (let i = 0; i < 5; i++) { const a = new Date(from.getTime() + i * 92 * 86400000), b = new Date(a.getTime() + 92 * 86400000); wins.push([a, b]); }
  const get = async (t) => { const parts = await Promise.all(wins.map((w) => tour(t, w[0], w[1]))); return parts.some((p) => p) ? [].concat.apply([], parts.map((p) => p || [])) : null; };
  const [atp, wta] = await Promise.all([get('atp'), get('wta')]);
  let out;
  if (!atp && !wta) {
    const sn = last || snapshot();
    if (!sn) { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ error: 'tournaments unavailable' }); }
    out = Object.assign({}, sn, { stale: true });
  } else {
    const by = {};
    [['ATP', atp || []], ['WTA', wta || []]].forEach(([tg, list]) => list.forEach((e) => {
      if (!e.name || !e.start) return;
      const k = e.name.toLowerCase().replace(/\s+presented by.*$/, '').replace(/[^a-z0-9]+/g, '') + '|' + e.start.slice(0, 7);
      const o = by[k] || (by[k] = { name: e.name.replace(/\s+presented by.*$/i, '').replace(/\s+powered by.*$/i, ''), start: e.start, end: e.end, venue: e.venue, tours: [] });
      if (o.tours.indexOf(tg) < 0) o.tours.push(tg);
      if (e.end > o.end) o.end = e.end;
    }));
    const today = now.toISOString().slice(0, 10);
    const all = Object.keys(by).map((k) => classify(by[k])).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
    out = { fetched: now.toISOString(), now: all.filter((t) => t.start <= today && t.end >= today), upcoming: all.filter((t) => t.start > today) };
    last = out;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(out);
};
