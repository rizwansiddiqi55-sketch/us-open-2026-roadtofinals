export default async function handler(req, res) {
  const key = process.env.SPORTRADAR_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Missing SPORTRADAR_API_KEY environment variable.' });
  }

  const url = 'https://api.sportradar.com/tennis/production/v3/en/schedules/live/summaries.json';
  try {
    const upstream = await fetch(url, {
      headers: { 'x-api-key': key },
      cache: 'no-store'
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: 'Sportradar request failed', detail: text.slice(0, 500) });
    }

    const data = await upstream.json();
    const summaries = Array.isArray(data.summaries) ? data.summaries : [];
    const target = summaries.find(item => {
      const competitors = item?.sport_event?.competitors || [];
      const names = competitors.map(c => (c?.name || '').toLowerCase());
      return names.some(n => n.includes('gauff')) && names.some(n => n.includes('rybakina'));
    });

    if (!target) {
      return res.status(200).json({
        updatedAt: data.generated_at || new Date().toISOString(),
        match: null,
        message: 'Gauff-Rybakina is not currently present in the live feed.'
      });
    }

    const event = target.sport_event || {};
    const status = target.sport_event_status || {};
    const competitors = event.competitors || [];
    const getCompetitor = needle => competitors.find(c => (c?.name || '').toLowerCase().includes(needle));
    const g = getCompetitor('gauff');
    const r = getCompetitor('rybakina');
    const scoreFor = c => {
      if (!c) return null;
      if (c.qualifier === 'home') return status.home_score ?? null;
      if (c.qualifier === 'away') return status.away_score ?? null;
      const idx = competitors.findIndex(x => x?.id === c.id);
      return idx === 0 ? (status.home_score ?? null) : (status.away_score ?? null);
    };
    const periods = Array.isArray(status.period_scores) ? status.period_scores : [];
    const statusLabel = status.status === 'ended' || status.status === 'closed'
      ? 'FINAL'
      : (status.match_status || 'LIVE').replace(/_/g, ' ').toUpperCase();

    return res.status(200).json({
      updatedAt: data.generated_at || new Date().toISOString(),
      match: {
        eventId: event.id,
        status: status.status,
        statusLabel,
        gameState: status.game_state || null,
        periodScores: periods,
        venue: target?.venue?.name || event?.venue?.name || 'Arthur Ashe Stadium',
        gauff: {
          score: scoreFor(g),
          name: g?.name || 'Coco Gauff'
        },
        rybakina: {
          score: scoreFor(r),
          name: r?.name || 'Elena Rybakina'
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to retrieve live score.', detail: error.message });
  }
}
