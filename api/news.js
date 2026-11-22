// Latest tennis headlines gathered from news sites. Only the headline, the short summary the publisher supplies, a thumbnail and the link back to the original story are used.
const SOURCES = [
  { name: 'ESPN', type: 'espn', tour: 'ATP', url: 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/news?limit=25' },
  { name: 'ESPN', type: 'espn', tour: 'WTA', url: 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/news?limit=25' },
  { name: 'BBC Sport', type: 'rss', url: 'https://feeds.bbci.co.uk/sport/tennis/rss.xml' },
  { name: 'The Guardian', type: 'rss', url: 'https://www.theguardian.com/sport/tennis/rss' },
];
let last = null;
function snapshot() { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'news-snapshot.json'), 'utf8')); } catch (e) { return null; } }
const clean = (s, n) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 240);
const tag = (xml, t) => { const m = xml.match(new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + t + '>', 'i')); return m ? m[1] : ''; };

async function get(url, accept) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 7000);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { accept: accept || '*/*', 'user-agent': 'Mozilla/5.0 (compatible; tennis-fan-page)' } }); if (!r.ok) return null; return r; } catch (e) { return null; } finally { clearTimeout(timer); }
}
async function fromEspn(s) {
  const r = await get(s.url, 'application/json'); if (!r) return [];
  let j; try { j = await r.json(); } catch (e) { return []; }
  return (j.articles || []).map((a) => ({ title: clean(a.headline, 200), desc: clean(a.description, 260), url: a.links && a.links.web && a.links.web.href, img: a.images && a.images[0] && a.images[0].url, time: a.published || a.lastModified, source: s.name, tour: s.tour, premium: !!a.premium })).filter((x) => x.title && x.url && !x.premium);
}
async function fromRss(s) {
  const r = await get(s.url, 'application/rss+xml, application/xml, text/xml'); if (!r) return [];
  let xml; try { xml = await r.text(); } catch (e) { return []; }
  return (xml.match(/<item[\s\S]*?<\/item>/gi) || []).slice(0, 25).map((it) => {
    const img = (it.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || it.match(/<media:content[^>]*url="([^"]+)"/i) || it.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1];
    const d = Date.parse(clean(tag(it, 'pubDate')) || clean(tag(it, 'dc:date')));
    return { title: clean(tag(it, 'title'), 200), desc: clean(tag(it, 'description'), 260), url: clean(tag(it, 'link'), 500) || clean(tag(it, 'guid'), 500), img, time: isNaN(d) ? null : new Date(d).toISOString(), source: s.name };
  }).filter((x) => x.title && /^https?:/.test(x.url || ''));
}
const kind = (x) => (x.tour ? [x.tour] : (/\b(wta|women|womens|women's)\b/i.test(x.title + ' ' + x.desc) ? ['WTA'] : (/\b(atp|men's|mens)\b/i.test(x.title + ' ' + x.desc) ? ['ATP'] : [])));

module.exports = async (req, res) => {
  const lists = await Promise.all(SOURCES.map((s) => (s.type === 'espn' ? fromEspn(s) : fromRss(s)).catch(() => [])));
  const seen = new Set(), items = [];
  [].concat.apply([], lists).forEach((x) => { const k = x.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60); if (seen.has(k)) return; seen.add(k); x.tags = kind(x); items.push(x); });
  items.sort((a, b) => Date.parse(b.time || 0) - Date.parse(a.time || 0));
  let out;
  if (items.length) { out = { fetched: new Date().toISOString(), sources: Array.from(new Set(items.map((x) => x.source))), items: items.slice(0, 50) }; last = out; }
  else { const sn = last || snapshot(); if (!sn) { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ error: 'news unavailable' }); } out = Object.assign({}, sn, { stale: true }); }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(out);
};
