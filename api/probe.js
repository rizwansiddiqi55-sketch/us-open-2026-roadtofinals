// TEMPORARY: checks which match lists the live-score provider serves on this key (no key or secrets in the output). To be deleted after use.
module.exports = async (req, res) => {
  const key = process.env.TENNIS_API_KEY;
  const base = 'https://api.livetennisapi.com/api/public/v1/matches?tour=wta&limit=40&status=';
  const names = ['gauff', 'kostyuk', 'pegula', 'noskova', 'sabalenka', 'andreeva', 'svitolina', 'muchova'];
  const out = {};
  for (const st of ['completed', 'upcoming']) {
    try {
      const r = await fetch(base + st, { headers: { Authorization: 'Bearer ' + key } });
      const body = await r.json().catch(() => null);
      const items = body && Array.isArray(body.data) ? body.data : [];
      const ours = items.filter((m) => m.players && [m.players.p1 && m.players.p1.name, m.players.p2 && m.players.p2.name].every((n) => names.some((x) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(x))));
      out[st] = {
        http: r.status, count: items.length, meta: body && body.meta, error: body && (body.error || body.message || body.detail) || null,
        ourMatches: ours.map((m) => ({ p1: m.players.p1.name, p2: m.players.p2.name, status: m.status, scheduled_time: m.scheduled_time, tournament: m.tournament, round: m.round, games: m.score && m.score.games, outcome: m.outcome, keys: Object.keys(m) })),
        sampleKeys: items[0] ? Object.keys(items[0]) : null,
      };
    } catch (e) { out[st] = { error: String(e.message || e) }; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
