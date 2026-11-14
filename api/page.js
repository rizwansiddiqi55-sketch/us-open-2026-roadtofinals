// Serves the home page with the link-preview tags (page title, description, og:*) filled from the current scores.
// WhatsApp, iMessage, Telegram and search engines read the HTML as served and do not run the page's JavaScript,
// so the title has to be correct in the HTML itself. If anything fails, the unchanged index.html is returned.
const scoresHandler = require('./scores.js');

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nameOf = (p) => p.full || p.name;

function winnerOf(m) {
  let a = 0, b = 0;
  (m.sets || []).forEach((x) => { if (x.p1 > x.p2) a++; else b++; });
  return a > b ? 'p1' : 'p2';
}
function setsText(m, w) {
  return (m.sets || []).map((x) => (w === 'p1' ? x.p1 + '-' + x.p2 : x.p2 + '-' + x.p1)).join(', ');
}

function preview(d) {
  const ms = (d.matches || []).slice().sort((a, b) => a.order - b.order);
  const live = ms.filter((m) => m.status === 'live')[0];
  const finals = ms.filter((m) => m.status === 'final' && m.sets && m.sets.length);
  const last = finals[finals.length - 1];
  const next = ms.filter((m) => m.status === 'upcoming')[0];
  let title, desc = [];
  if (live) {
    const s = (live.sets || []).map((x) => x.p1 + '-' + x.p2).join(', ');
    title = 'LIVE: ' + live.p1.name + ' v ' + live.p2.name + (s ? ' ' + s : '') + ' (' + (live.round || 'Group stage') + ')';
    desc.push('Live score, win predictor and match story from the WTA Finals at Indian Wells.');
  } else if (last) {
    const w = winnerOf(last), l = w === 'p1' ? 'p2' : 'p1';
    title = last[w].name + ' beats ' + last[l].name + ' ' + setsText(last, w);
    if (last.roundCode === 'F') title += ' to win the WTA Finals';
  } else {
    title = 'Live scores, results and recaps';
  }
  if (last && live) {
    const w = winnerOf(last), l = w === 'p1' ? 'p2' : 'p1';
    desc.push('Earlier: ' + last[w].name + ' beat ' + last[l].name + ' ' + setsText(last, w) + '.');
  }
  if (!live && next) desc.push('Next: ' + next.p1.name + ' v ' + next.p2.name + ' (' + (next.round || 'Group stage') + ', ' + (next.timeTbc ? 'time to be confirmed' : next.label + ', ' + String(next.time || '').replace(/\s*\(EST\.\)/i, '') ) + ').');
  desc.push('WTA Finals 2026 at Indian Wells, in Dubai time.');
  return { title: 'WTA Finals 2026 — ' + title, description: desc.join(' ') };
}

async function getData(req, base) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const res = {
      setHeader() {}, status() { return this; },
      json(o) { clearTimeout(timer); resolve(o); },
    };
    Promise.resolve(scoresHandler({ headers: req.headers }, res)).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

module.exports = async (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers.host;
  const base = process.env.STATIC_BASE || proto + '://' + host;
  let html;
  try {
    const r = await fetch(base + '/index.html', { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error('index ' + r.status);
    html = await r.text();
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).send('Page unavailable');
  }
  try {
    const d = await getData(req, base);
    if (d && d.matches) {
      const p = preview(d), url = 'https://' + host + '/';
      const tags =
        '<meta name="description" content="' + esc(p.description) + '">\n' +
        '<meta property="og:type" content="website">\n' +
        '<meta property="og:site_name" content="WTA Finals 2026 fan recap">\n' +
        '<meta property="og:title" content="' + esc(p.title) + '">\n' +
        '<meta property="og:description" content="' + esc(p.description) + '">\n' +
        '<meta property="og:url" content="' + esc(url) + '">\n' +
        '<meta property="og:image" content="' + esc('https://' + host + '/icons/icon-512.png') + '">\n' +
        '<meta name="twitter:card" content="summary">\n' +
        '<meta name="twitter:title" content="' + esc(p.title) + '">\n' +
        '<meta name="twitter:description" content="' + esc(p.description) + '">';
      const before = html;
      html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(p.title) + '</title>');
      html = html.replace(/<meta name="description"[^>]*>/, tags);
      if (html === before) html = before;
    }
  } catch (e) { /* keep the unchanged page */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
  res.status(200).send(html);
};
