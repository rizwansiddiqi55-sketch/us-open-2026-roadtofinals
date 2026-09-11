# US Open Road to the Finals — Live Scores

This version adds a Vercel serverless endpoint at `/api/live-score` and polls it every 5 seconds from `index.html`.

## Setup

1. Create a Sportradar Tennis API key with access to the live tennis feed.
2. In Vercel Project Settings → Environment Variables, add:
   `SPORTRADAR_API_KEY`
3. Deploy the project.
4. The page calls `/api/live-score?match=gauff-rybakina` every 5 seconds.

The server-side endpoint keeps the API key out of the browser. Sportradar's Tennis Live Summaries feed provides currently live matches and live scores; the provider documents a 1-second TTL/cache for this feed.
