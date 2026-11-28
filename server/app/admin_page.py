"""The admin voice dashboard page (GET /admin/voice, script at /admin/voice.js: the CSP forbids inline scripts). It carries no data: it asks for the admin token, then reads /api/admin/voice every few seconds."""

VOICE_DASHBOARD_HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aegis voice observability</title>
<style>
:root{color-scheme:light dark;--bg:#0f1115;--card:#171a21;--ink:#e8eaf0;--mut:#8b93a7;--ok:#3ecf8e;--warn:#f5a524;--bad:#f0616d;--line:#262b36}
@media (prefers-color-scheme:light){:root{--bg:#f5f6f8;--card:#fff;--ink:#14171f;--mut:#667085;--line:#e4e7ec}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,Segoe UI,sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 8px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}input,button{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button{cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto}
.kpi{display:flex;gap:18px;flex-wrap:wrap}.kpi b{display:block;font-size:22px}.kpi span{color:var(--mut);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:4px 8px 4px 0;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-weight:500}
.pill{padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600}.ok{background:#3ecf8e22;color:var(--ok)}.degraded{background:#f5a52422;color:var(--warn)}.err{color:var(--bad)}
.bar2{height:6px;background:var(--line);border-radius:4px;min-width:60px}.bar2>i{display:block;height:100%;background:var(--ok);border-radius:4px}
</style></head><body>
<h1>Aegis voice observability <span id="health" class="pill ok">...</span></h1>
<div class="bar"><input id="tok" type="password" placeholder="Admin token" autocomplete="off"><button id="go">Connect</button><span id="msg" style="color:var(--mut)"></span></div>
<div class="grid">
<div class="card"><h2>Overview</h2><div class="kpi" id="kpi"></div><p id="problems" class="err"></p></div>
<div class="card"><h2>Engines</h2><table id="engines"></table></div>
<div class="card"><h2>Languages</h2><table id="langs"></table></div>
<div class="card"><h2>Latency (ms)</h2><table id="lat"></table></div>
<div class="card"><h2>Fallbacks and queue</h2><table id="fb"></table></div>
<div class="card"><h2>Installed voices</h2><table id="inst"></table></div>
</div>
<div class="card" style="margin-top:12px"><h2>Latest voice events</h2><table id="ev"></table></div>
<script src="/admin/voice.js"></script></body></html>"""

VOICE_DASHBOARD_JS = r"""const $=id=>document.getElementById(id);let timer=null;
function cell(v){const td=document.createElement("td");td.textContent=v==null?"-":String(v);return td}
function fill(id,head,rows){const t=$(id);t.replaceChildren();const h=document.createElement("tr");head.forEach(x=>{const th=document.createElement("th");th.textContent=x;h.append(th)});t.append(h);
 rows.forEach(r=>{const tr=document.createElement("tr");r.forEach(v=>tr.append(cell(v)));t.append(tr)});if(!rows.length){const tr=document.createElement("tr");tr.append(cell("nothing yet"));t.append(tr)}}
function kpi(items){const k=$("kpi");k.replaceChildren();items.forEach(([n,l])=>{const d=document.createElement("div");const b=document.createElement("b");b.textContent=n;const s=document.createElement("span");s.textContent=l;d.append(b,s);k.append(d)})}
async function load(){
 const token=$("tok").value||sessionStorage.getItem("aegis_admin")||"";if(!token){$("msg").textContent="Enter the admin token.";return}
 try{const r=await fetch("/api/admin/voice",{headers:{"X-Admin-Token":token}});
  if(!r.ok){$("msg").textContent=r.status===401?"Wrong token.":"Admin API unavailable ("+r.status+").";return}
  sessionStorage.setItem("aegis_admin",token);const d=await r.json();$("msg").textContent="Updated "+new Date().toLocaleTimeString();
  const h=$("health");h.textContent=d.health.status;h.className="pill "+(d.health.status==="ok"?"ok":"degraded");$("problems").textContent=d.health.problems.join(" | ");
  kpi([[d.total_requests,"voice requests"],[(d.health.fallback_ratio*100).toFixed(0)+"%","recent fallbacks"],[d.process.rss_mb+" MB","memory"],[d.process.threads,"threads"],[Math.floor(d.process.uptime_s/60)+" min","uptime"],[d.provider||"off","provider"]]);
  fill("engines",["engine","requests","errors"],d.by_engine.map(x=>[x.engine,x.requests,x.errors]));
  fill("langs",["lang","requests","errors"],d.by_language.map(x=>[x.lang,x.requests,x.errors]));
  fill("lat",["engine","lang","n","avg","p50","p95","p99"],d.latency.map(x=>[x.engine,x.lang,x.count,x.avg_ms,x.p50_ms,x.p95_ms,x.p99_ms]));
  fill("fb",["what","detail","count"],[...d.fallbacks.map(x=>["fallback",x.from_engine+" > "+x.to_engine+" ("+x.lang+")",x.value]),...d.queue_timeouts.map(x=>["queue timeout",x.engine,x.value]),...d.downloads.map(x=>["download",x.engine+" "+x.result,x.value])]);
  fill("inst",["engine","voices / languages"],[["piper",(d.piper.voices||[]).join(", ")||"-"],["mms",(d.mms.languages||[]).join(", ")||"-"],["loaded now",[...(d.piper.loaded||[]),...(d.mms.loaded||[])].join(", ")||"-"],["downloading",[...(d.piper.downloading||[]),...(d.mms.downloading||[])].join(", ")||"-"]]);
  fill("ev",["time","engine","lang","outcome","ms","chars","fell back from","why","request"],d.events.map(e=>[new Date(e.t*1000).toLocaleTimeString(),e.engine,e.lang,e.outcome,e.ms,e.chars,e.fell_back_from,e.why,e.rid]));
 }catch(e){$("msg").textContent="Could not reach the server."}
}
$("go").onclick=()=>{load();clearInterval(timer);timer=setInterval(load,5000)};
if(sessionStorage.getItem("aegis_admin")){$("go").click()}
"""
