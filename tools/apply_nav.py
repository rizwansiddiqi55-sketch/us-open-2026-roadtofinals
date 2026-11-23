#!/usr/bin/env python3
"""Puts the shared site bar (menu, search, favourites, dark mode) on every page and makes each page follow data-theme.
Run from the repo root:  python3 tools/apply_nav.py   (idempotent)."""
import re,sys
PAGES=['atp-finals-2026/index.html','home.html','rankings.html','warm-up.html','about.html','al-habtoor.html','privacy.html','terms.html','contact.html','players.html','stats.html','h2h.html','news.html']
LINKS=[('HOME','/home',False),('LIVE','/atp-finals-2026/#live',True),('MATCHES','/atp-finals-2026/#schedule',False),('TOURNAMENTS','/home#tournaments',False),('PLAYERS','/players',False),('RANKINGS','/rankings',False),('H2H','/h2h',False),('STATS','/stats',False),('NEWS','/news',False),('FITNESS','/warm-up',False)]
NAV=('<div class="tbnav"><div class="in"><a class="brand" href="/" aria-label="TennisByte home"><img class="tblogo" src="/icons/tennisbyte-logo-concept1-loop.png" alt="TennisByte logo" width="119" height="52"><b>Tennis<span>Byte</span>.com</b></a>'
 '<nav aria-label="Site menu">'+''.join('<a href="%s"%s>%s</a>'%(u,' class="live"' if live else '',n) for n,u,live in LINKS)+'</nav>'
 '<div class="tools"><button type="button" id="tbSearch" aria-label="Search"><span class="ic">&#128269;</span><span class="lb">Search</span></button>'
 '<button type="button" id="tbFav" aria-label="Favourites"><span class="ic">&#11088;</span><span class="lb">Favourites</span><span class="cnt"></span></button>'
 '<button type="button" id="tbTheme" aria-label="Switch to dark mode"><span class="ic">&#127769;</span><span class="lb">Dark</span></button></div></div></div>')
HEAD=('<script>try{var t=localStorage.getItem("tbTheme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>\n'
      '<link rel="stylesheet" href="/css/site.css"><script src="/js/site.js" defer></script>\n')
def balanced(s,i):
    d=0
    for j in range(i,len(s)):
        if s[j]=='{': d+=1
        elif s[j]=='}':
            d-=1
            if d==0: return j
    return -1
def theme_support(html):
    out=[];pos=0
    for m in re.finditer(r'@media\s*\(prefers-color-scheme:\s*dark\)\s*\{',html):
        if m.start()<pos: continue
        o=m.end()-1; c=balanced(html,o)
        if c<0: continue
        inner=html[o+1:c]
        if 'data-theme' in inner: continue
        rules=re.findall(r'([^{}]+)\{([^{}]*)\}',inner)
        def pref(sel,p):
            return ','.join((x.replace(':root',p,1) if x.startswith(':root') else (p+' '+x if x[:1] in '.#[' else ':where('+p+') '+x)) for x in [y.strip() for y in sel.split(',')])
        mq='@media (prefers-color-scheme:dark){'+''.join('%s{%s}'%(pref(s,':root:not([data-theme=light])'),d) for s,d in rules)+'}'
        dk=''.join('%s{%s}'%(pref(s,':root[data-theme=dark]'),d) for s,d in rules)
        out.append((m.start(),c+1,mq+dk))
    for a,b,rep in reversed(out): html=html[:a]+rep+html[b:]
    return html
for f in PAGES:
    try: s=open(f,encoding='utf-8').read()
    except FileNotFoundError: print('skip',f); continue
    s=re.sub(r'<style id="tbnav-css">.*?</style>\s*','',s,flags=re.S)
    if '/css/site.css' not in s: s=s.replace('</head>',HEAD+'</head>',1)
    if re.search(r'<div class="tbnav">.*?</nav>(<div class="tools">.*?</div>)?</div></div>',s,re.S): s=re.sub(r'<div class="tbnav">.*?</nav>(<div class="tools">.*?</div>)?</div></div>',lambda m:NAV,s,1,flags=re.S)
    else: s=re.sub(r'(<body[^>]*>)',lambda m:m.group(1)+'\n'+NAV,s,1)
    if not f.startswith('atp-finals'): s=theme_support(s)
    if '<a href="/warm-up">Warm-up</a>' not in s and '<footer>' in s and 'href="/about">About</a>' in s and f!='atp-finals-2026/index.html': s=s.replace('<a href="/about">About</a>','<a href="/warm-up">Warm-up</a><a href="/about">About</a>',1)
    open(f,'w',encoding='utf-8').write(s); print('ok',f)
