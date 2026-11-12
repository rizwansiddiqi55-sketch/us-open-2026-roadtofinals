// TEMPORARY: reports what the BALLDONTLIE WTA API returns on this key (no key in the output). To be deleted after use.
const BASE = 'https://api.balldontlie.io/wta/v1';
async function get(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY || '' } });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { http: r.status, body };
}
const slim = (m) => ({ id: m.id, round: m.round, status: m.match_status, state: m.status_state, live: m.is_live, p1: m.player1 && m.player1.full_name, p2: m.player2 && m.player2.full_name, score: m.score, sets: (m.set_scores || []).map((s) => s.player1_games + '-' + s.player2_games), g1: m.player1_game_score, g2: m.player2_game_score, server: m.server, start: m.start_time || m.date || null, keys: Object.keys(m) });
module.exports = async (req, res) => {
  const out = { haveKey: !!process.env.BALLDONTLIE_API_KEY };
  try {
    const t = await get('/tournaments?season=2026&per_page=100');
    out.tournaments = { http: t.http, error: t.body && t.body.error, finals: ((t.body && t.body.data) || []).filter((x) => /finals/i.test(x.name || '')).map((x) => ({ id: x.id, name: x.name, location: x.location, start: x.start_date, end: x.end_date })) };
    const fin = out.tournaments.finals[0];
    const live = await get('/matches?is_live=true&per_page=25');
    out.live = { http: live.http, error: live.body && live.body.error, count: ((live.body && live.body.data) || []).length, matches: ((live.body && live.body.data) || []).map(slim) };
    if (fin) {
      const m = await get('/matches?tournament_ids[]=' + fin.id + '&season=2026&per_page=100');
      out.finalsMatches = { http: m.http, error: m.body && m.body.error, matches: ((m.body && m.body.data) || []).map(slim) };
      const ids = out.finalsMatches.matches.filter((x) => x.status === 'finished').slice(-1).concat(out.live.matches.filter((x) => /Noskova|Pegula|Andreeva|Muchov|Sabalenka|Svitolina|Gauff|Kostyuk/.test((x.p1 || '') + (x.p2 || '')))).map((x) => x.id);
      out.statsFor = ids;
      if (ids.length) {
        const s = await get('/match_stats?' + ids.map((i) => 'match_ids[]=' + i).join('&'));
        out.stats = { http: s.http, error: s.body && s.body.error, rows: ((s.body && s.body.data) || []).map((r) => Object.assign({ matchId: r.match && r.match.id, player: r.player && r.player.full_name }, Object.fromEntries(Object.entries(r).filter(([k]) => !['match', 'player'].includes(k))))) };
      }
    }
  } catch (e) { out.error = String(e.message || e); }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
