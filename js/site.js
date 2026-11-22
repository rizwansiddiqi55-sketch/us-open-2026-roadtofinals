// Shared behaviour: dark mode toggle, favourites (stored on this device), search. No accounts, nothing is sent anywhere.
(function(){
  var doc=document, root=doc.documentElement;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k); if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} return null; }
  // ---------- theme ----------
  function isDark(){ var t=root.getAttribute('data-theme'); if(t) return t==='dark'; return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches); }
  function paintTheme(){ var b=doc.getElementById('tbTheme'); if(!b) return; b.querySelector('.ic').textContent=isDark()?'☀️':'🌙'; b.querySelector('.lb').textContent=isDark()?'Light':'Dark'; b.setAttribute('aria-label',isDark()?'Switch to light mode':'Switch to dark mode'); }
  // ---------- favourites ----------
  function favs(){ try{ return JSON.parse(ls('tbFav')||'[]'); }catch(e){ return []; } }
  function saveFavs(a){ ls('tbFav',JSON.stringify(a)); paintFavs(); }
  function hasFav(k){ return favs().some(function(x){return x.k===k;}); }
  function toggleFav(it){ var a=favs(), i=a.findIndex(function(x){return x.k===it.k;}); if(i>=0) a.splice(i,1); else a.push(it); saveFavs(a); return i<0; }
  function paintFavs(){ var n=favs().length, c=doc.querySelector('#tbFav .cnt'); if(c) c.textContent=n?String(n):''; doc.querySelectorAll('[data-fav]').forEach(function(b){ var on=hasFav(b.getAttribute('data-k')); b.classList.toggle('on',on); b.textContent=on?'★':'☆'; b.setAttribute('aria-pressed',on); }); }
  function starBtn(it){ return '<button type="button" class="star" data-fav="1" data-k="'+esc(it.k)+'" data-t="'+esc(it.t)+'" data-n="'+esc(it.n)+'" data-u="'+esc(it.u)+'" aria-label="Favourite '+esc(it.n)+'">☆</button>'; }
  window.TB={star:starBtn,paint:paintFavs,hasFav:hasFav};
  doc.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('[data-fav]'); if(!b) return; e.preventDefault(); e.stopPropagation(); toggleFav({k:b.getAttribute('data-k'),t:b.getAttribute('data-t'),n:b.getAttribute('data-n'),u:b.getAttribute('data-u')}); if(doc.getElementById('tbFavBox')&&doc.getElementById('tbFavBox').parentNode.classList.contains('show')) drawFavs(); });
  // ---------- overlays ----------
  function overlay(id,title,inner){ var o=doc.getElementById(id); if(o) return o; o=doc.createElement('div'); o.className='tbov'; o.id=id; o.innerHTML='<div class="tbbox" role="dialog" aria-label="'+esc(title)+'"><button class="x" aria-label="Close">&times;</button><h2>'+esc(title)+'</h2>'+inner+'</div>'; doc.body.appendChild(o); o.addEventListener('click',function(e){ if(e.target===o||(e.target.classList&&e.target.classList.contains('x'))) o.classList.remove('show'); }); return o; }
  doc.addEventListener('keydown',function(e){ if(e.key==='Escape') doc.querySelectorAll('.tbov.show').forEach(function(o){o.classList.remove('show');}); });
  function drawFavs(){ var a=favs(), box=doc.getElementById('tbFavBox'); if(!a.length){ box.innerHTML='<p>No favourites yet. Tap the star next to a player or tournament to save it here. They stay on this device.</p>'; return; }
    var g={player:[],tournament:[]}; a.forEach(function(x){ (g[x.t]||(g[x.t]=[])).push(x); });
    function sec(t,l){ return g[t]&&g[t].length?'<h3>'+l+'</h3>'+g[t].map(function(x){ return '<div class="row"><a class="grow" href="'+esc(x.u)+'" style="padding:0">'+esc(x.n)+'</a>'+starBtn(x)+'</div>'; }).join(''):''; }
    box.innerHTML='<div class="tbres">'+sec('player','PLAYERS')+sec('tournament','TOURNAMENTS')+'</div>'; paintFavs(); }
  // ---------- search ----------
  var idx=null, loading=false;
  function load(){ if(idx||loading) return; loading=true; idx=[
    {g:'Pages',n:'Live scores (ATP Finals)',u:'/atp-finals-2026/#live'},{g:'Pages',n:'Schedule in Dubai time',u:'/atp-finals-2026/#schedule'},{g:'Pages',n:'Group standings',u:'/atp-finals-2026/#standings-sec'},{g:'Pages',n:'Match stories (in each tournament)',u:'/atp-finals-2026/#stories-sec'},{g:'Pages',n:'Tennis news',u:'/news'},{g:'Pages',n:'Rankings',u:'/rankings'},{g:'Pages',n:'Players',u:'/players'},{g:'Pages',n:'2026 stats',u:'/stats'},{g:'Pages',n:'Head to head',u:'/h2h'},{g:'Pages',n:'Tennis warm-up and injury prevention',u:'/warm-up'},{g:'Pages',n:'About',u:'/about'},{g:'Pages',n:'Contact',u:'/contact'}];
    fetch('/api/rankings').then(function(r){return r.json();}).then(function(d){ ['atp','wta'].forEach(function(t){ (d[t]||[]).forEach(function(p){ idx.push({g:'Players',n:p.name,s:(t==='atp'?'ATP':'WTA')+' #'+p.rank+' · '+(p.countryName||p.country),u:'/players?q='+encodeURIComponent(p.name),fav:{k:'p:'+p.name,t:'player',n:p.name,u:'/players?q='+encodeURIComponent(p.name)}}); }); }); render(); }).catch(function(){});
    fetch('/api/tournaments').then(function(r){return r.json();}).then(function(d){ (d.now||[]).concat(d.upcoming||[]).forEach(function(t){ var u=/nitto atp finals/i.test(t.name)?'/atp-finals-2026/':'/home#tournaments'; idx.push({g:'Tournaments',n:t.name,s:t.start,u:u,fav:{k:'t:'+t.name,t:'tournament',n:t.name,u:u}}); }); render(); }).catch(function(){});
    fetch('/data/archive-2026.json').then(function(r){return r.json();}).then(function(d){ (d.events||[]).forEach(function(t){ var ch=[t.results&&t.results.men&&t.results.men.champion,t.results&&t.results.women&&t.results.women.champion].filter(Boolean).join(' / '); idx.push({g:'Tournaments',n:t.name+' 2026',s:ch?'Champion: '+ch:'',u:'/home#archive',fav:{k:'t:'+t.name+' 2026',t:'tournament',n:t.name+' 2026',u:'/home#archive'}}); }); render(); }).catch(function(){}); }
  function render(){ var q=(doc.getElementById('tbQ')||{}).value||'', box=doc.getElementById('tbRes'); if(!box) return; q=q.trim().toLowerCase();
    if(!q){ box.innerHTML='<div class="empty">Type a player, a tournament or a page. Example: Alcaraz, Dubai, rankings.</div>'; return; }
    var hits=(idx||[]).filter(function(x){ return (x.n+' '+(x.s||'')).toLowerCase().indexOf(q)>=0; }), groups={}; hits.forEach(function(x){ (groups[x.g]=groups[x.g]||[]).push(x); });
    var h=''; ['Players','Tournaments','Pages'].forEach(function(g){ var l=(groups[g]||[]).slice(0,7); if(!l.length) return; h+='<h3>'+g.toUpperCase()+'</h3>'+l.map(function(x){ return '<div class="row"><a class="grow" href="'+esc(x.u)+'" style="padding:0;display:flex;gap:8px;align-items:center"><span>'+esc(x.n)+'</span><span class="sub">'+esc(x.s||'')+'</span></a>'+(x.fav?starBtn(x.fav):'')+'</div>'; }).join(''); });
    box.innerHTML=h||'<div class="empty">No results for “'+esc(q)+'”.</div>'; paintFavs(); }
  function openSearch(){ var o=overlay('tbSearchOv','Search','<input id="tbQ" type="search" placeholder="Search players, tournaments, pages" autocomplete="off" aria-label="Search"><div class="tbres" id="tbRes"></div>'); o.classList.add('show'); load(); var q=doc.getElementById('tbQ'); if(!q._b){ q._b=1; q.addEventListener('input',render); q.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var a=doc.querySelector('#tbRes a'); if(a) location.href=a.getAttribute('href'); } }); } render(); setTimeout(function(){ q.focus(); },30); }
  function openFavs(){ var o=overlay('tbFavOv','Favourites','<div class="tbfavs" id="tbFavBox"></div>'); o.classList.add('show'); drawFavs(); }
  // ---------- wire up ----------
  function init(){
    var s=doc.getElementById('tbSearch'), f=doc.getElementById('tbFav'), t=doc.getElementById('tbTheme');
    if(s) s.addEventListener('click',openSearch); if(f) f.addEventListener('click',openFavs);
    if(t) t.addEventListener('click',function(){ var n=isDark()?'light':'dark'; root.setAttribute('data-theme',n); ls('tbTheme',n); paintTheme(); });
    paintTheme(); paintFavs();
    doc.addEventListener('keydown',function(e){ if((e.key==='/'||(e.key==='k'&&(e.metaKey||e.ctrlKey)))&&!/input|textarea/i.test((doc.activeElement||{}).tagName||'')){ e.preventDefault(); openSearch(); } });
    // highlight the menu item for this page
    var p=location.pathname.replace(/\/$/,'')||'/', h=location.hash;
    doc.querySelectorAll('.tbnav nav a').forEach(function(a){ var u=a.getAttribute('href').split('#'), on=false; if(u[0].replace(/\/$/,'')===p||(p==='/home'&&u[0]==='/home')) on=(u[1]?('#'+u[1]===h):(!h||u[0]!=='/atp-finals-2026/')); if(u[0]==='/atp-finals-2026/'&&p==='/atp-finals-2026'&&u[1]) on=('#'+u[1]===h||(!h&&u[1]==='live')); a.toggleAttribute('aria-current',false); if(on) a.setAttribute('aria-current','page'); });
    window.addEventListener('hashchange',paintFavs);
  }
  if(doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',init); else init();
})();
