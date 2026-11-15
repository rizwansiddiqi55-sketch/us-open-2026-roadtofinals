// Serves the Nitto ATP Finals page (/atp-finals-2026/) with link-preview tags (title, description, og:*) filled from the current scores.
// WhatsApp, iMessage, Telegram and search engines read the HTML as served and do not run the page's JavaScript.
// If anything fails, the unchanged page is returned.
const atpHandler = require('./atp.js');

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const last = (n) => String(n).split(' ').pop();
const setsText = (m, w) => (m.sets || []).map((x) => (w === 'p1' ? x.p1 + '-' + x.p2 : x.p2 + '-' + x.p1)).join(', ');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function uae(iso) {
  const u = new Date(Date.parse(iso) + 4 * 3600000), h = u.getUTCHours();
  return DOW[u.getUTCDay()] + ' ' + u.getUTCDate() + ' ' + MON[u.getUTCMonth()] + ' ' + String(h).padStart(2, '0') + ':' + String(u.getUTCMinutes()).padStart(2, '0') + ' UAE';
}

function preview(d) {
  const ms = d.matches || [];
  const live = ms.filter((m) => m.status === 'live')[0];
  const fins = ms.filter((m) => m.status === 'final' && m.winner);
  const lastF = fins[fins.length - 1];
  const next = ms.filter((m) => m.status === 'upcoming' && m.timeValid)[0];
  const final = ms.filter((m) => m.roundCode === 'F')[0];
  const res = (m) => { const w = m.winner, l = w === 'p1' ? 'p2' : 'p1'; return last(m[w].name) + ' beats ' + last(m[l].name) + ' ' + setsText(m, w); };
  let title, desc = [];
  if (final && final.status === 'final' && final.winner) {
    title = 'Champion: ' + final[final.winner].name + ' wins the title'; desc.push(res(final) + ' in the final.');
  } else if (live) {
    title = 'LIVE: ' + last(live.p1.name) + ' v ' + last(live.p2.name) + ' ' + setsText(live, 'p1');
    desc.push('Live score and the day\'s order of play in Dubai time.');
    if (lastF) desc.push('Earlier: ' + res(lastF) + '.');
  } else if (next && Date.parse(next.start) - Date.now() < 30 * 3600000 && !(lastF && Date.now() < Date.parse(lastF.start) + 3.5 * 3600000)) {
    title = 'Next: ' + last(next.p1.name) + ' v ' + last(next.p2.name) + ', ' + uae(next.start);
    if (lastF) desc.push('Latest result: ' + res(lastF) + '.');
  } else if (lastF) {
    title = res(lastF); if (next) desc.push('Next: ' + last(next.p1.name) + ' v ' + last(next.p2.name) + ', ' + uae(next.start) + '.');
  } else { title = 'Live scores, groups and schedule'; }
  desc.push('Nitto ATP Finals 2026 in Turin, in Dubai time.');
  return { title: 'Nitto ATP Finals 2026 — ' + title, description: desc.join(' ') };
}

function getData(req) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const res = { setHeader() {}, status() { return this; }, json(o) { clearTimeout(timer); resolve(o); } };
    Promise.resolve(atpHandler({ headers: req.headers }, res)).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

module.exports = async (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers.host;
  const base = process.env.STATIC_BASE || proto + '://' + host;
  let html;
  try {
    const r = await fetch(base + '/atp-finals-2026/index.html', { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error('page ' + r.status);
    html = await r.text();
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).send('Page unavailable');
  }
  try {
    const d = await getData(req);
    if (d && d.matches) {
      const p = preview(d), url = 'https://' + host + (/^atp-finals-2026\./.test(host) ? '/' : '/atp-finals-2026/');
      const tags =
        '<meta name="description" content="' + esc(p.description) + '">\n' +
        '<meta property="og:type" content="website">\n' +
        '<meta property="og:site_name" content="Nitto ATP Finals 2026 fan page">\n' +
        '<meta property="og:title" content="' + esc(p.title) + '">\n' +
        '<meta property="og:description" content="' + esc(p.description) + '">\n' +
        '<meta property="og:url" content="' + esc(url) + '">\n' +
        '<meta property="og:image" content="' + esc('https://' + host + '/icons/atp-icon-512.png') + '">\n' +
        '<meta name="twitter:card" content="summary">\n' +
        '<meta name="twitter:title" content="' + esc(p.title) + '">\n' +
        '<meta name="twitter:description" content="' + esc(p.description) + '">';
      html = html.replace(/<meta property="og:[^>]*>\n?/g, '');   // the page's own static preview tags are replaced by the live ones
      html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(p.title) + '</title>');
      html = html.replace(/<meta name="description"[^>]*>/, tags);
    }
  } catch (e) { /* keep the unchanged page */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  res.status(200).send(html);
};
