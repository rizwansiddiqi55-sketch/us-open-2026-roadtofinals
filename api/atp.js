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
  return { name: a.displayName || 'TBD', short: a.shortName || a.displayName || 'TBD', rank: (c.curatedRank && c.curatedRank.current) || null, ioc: flag ? flag.toUpperCase() : '' };
}
const ROUND = { 'group stage': 'RR', semifinal: 'SF', final: 'F' };

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
  res.status(200).json({ updated: new Date().toISOString(), tournament: 'Nitto ATP Finals 2026', venue: 'Inalpi Arena, Turin', matches, groups });
};
