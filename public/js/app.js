// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const PREDEF_COMPS = [
  'Motor libre','Motor acoplado',
  'Reductor entrada','Reductor salida',
  'Rodamiento acoplado','Rodamiento libre',
  'Rodamiento cola 01','Rodamiento cola 02',
  'Chumacera intermedia','Acoplamiento','Ventilador','Bomba','Compresor'
];
const SEV = {
  normal:  { l:'Normal',  c:'var(--gr)', cls:'bn' },
  alerta:  { l:'Alerta',  c:'var(--yw)', cls:'ba' },
  critico: { l:'Crítico', c:'var(--rd)', cls:'bc' }
};
const ISO_ALERT = 2.3, ISO_CRIT = 4.5;

function relDate(dateStr) {
  if(!dateStr) return '';
  // dateStr is "YYYY-MM-DD"
  const parts = dateStr.split('-');
  if(parts.length < 3) return dateStr;
  const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  const now = new Date(); now.setHours(0,0,0,0);
  const diff = Math.round((now - d) / 86400000);
  if(diff === 0) return '<span style="color:var(--gr);font-weight:700">Hoy</span>';
  if(diff === 1) return '<span style="color:var(--gr)">Ayer</span>';
  if(diff <= 7)  return `<span style="color:var(--yw)">${diff}d atrás</span>`;
  if(diff <= 30) return `<span style="color:var(--yw)">${diff}d atrás</span>`;
  if(diff <= 90) return `<span style="color:var(--or)">${Math.round(diff/7)}sem</span>`;
  return `<span style="color:var(--rd)">${Math.round(diff/30)} meses</span>`;
}

// ── STATE ─────────────────────────────────────────────────────────────────────
const S = {
  user: null, zones: [], curZone: null, curMachine: null, curComp: null, curMeas: null,
  machines: [], components: [], measurements: [], newImgs: [],
  editZone: null, editMac: null, selPredef: [], customComps: [], charts: {}
};

// ── UTILS ─────────────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function badgeH(s) { const x = SEV[s]||SEV.normal; return `<span class="badge ${x.cls}">${x.l}</span>`; }
function isAdmin() { return S.user?.role === 'admin'; }
function fv(v, d='—') { const n = parseFloat(v); return isNaN(n) ? d : n.toFixed(2); }
function axisSevDot(v) {
  const n = parseFloat(v)||0; if(!n) return '';
  const col = n >= ISO_CRIT ? 'var(--rd)' : n >= ISO_ALERT ? 'var(--yw)' : 'var(--gr)';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-left:4px"></span>`;
}
function calcSev(vx,vy,vz) {
  const m = Math.max(parseFloat(vx)||0, parseFloat(vy)||0, parseFloat(vz)||0);
  if(!m) return 'normal'; if(m >= ISO_CRIT) return 'critico'; if(m >= ISO_ALERT) return 'alerta'; return 'normal';
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let _tTmr;
function toast(msg, type='ok', dur=3000) {
  const t = document.getElementById('toast');
  t.innerHTML = msg; t.className = 'show ' + type;
  if(_tTmr) clearTimeout(_tTmr);
  _tTmr = setTimeout(() => t.className='', dur);
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── VIEWS ─────────────────────────────────────────────────────────────────────
function showView(id, pushToHistory) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0); updateBC(id);
  if (pushToHistory !== false) {
    const state = {
      view: id,
      curZone: S.curZone ? S.curZone.id : null,
      curMachine: S.curMachine ? S.curMachine.id : null,
      curMeas: S.curMeas ? S.curMeas.id : null
    };
    history.pushState(state, '', '#' + id);
  }
}

window.addEventListener('popstate', function(e) {
  if (!e.state || !S.user) return;
  const { view, curZone, curMachine } = e.state;
  if (view === 'v-zones') {
    goZones(false);
  } else if (view === 'v-zone-list') {
    openZoneList();
  } else if (view === 'v-zone' && curZone) {
    goZone(curZone, false);
  } else if (view === 'v-machine' && curMachine) {
    goMachineById(curMachine, false);
  } else if (view === 'v-meas') {
    if (S.curMeas) showView('v-meas', false);
    else if (curMachine) goMachineById(curMachine, false);
  } else {
    goZones(false);
  }
});
function updateBC(vid) {
  const bc = document.getElementById('breadcrumb');
  let p = [`<span class="bc-link" onclick="goZones()">🏭 Zonas</span>`];
  if(vid==='v-zone'||vid==='v-machine'||vid==='v-meas') {
    p.push(`<span class="bc-sep">›</span>`);
    const zn = S.curZone ? `${S.curZone.icon||'📍'} ${S.curZone.name}` : 'Zona';
    if(vid==='v-zone') p.push(`<span class="bc-cur">${zn}</span>`);
    else p.push(`<span class="bc-link" onclick="goZone()">${zn}</span>`);
  }
  if(vid==='v-machine'||vid==='v-meas') {
    p.push(`<span class="bc-sep">›</span>`);
    const mn = S.curMachine ? `🔧 ${S.curMachine.name}` : 'Máquina';
    if(vid==='v-machine') p.push(`<span class="bc-cur">${mn}</span>`);
    else p.push(`<span class="bc-link" onclick="goMachine()">${mn}</span>`);
  }
  if(vid==='v-meas') p.push(`<span class="bc-sep">›</span><span class="bc-cur">Medición</span>`);
  bc.innerHTML = p.join('');
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
const APP = {
  async init() {
    const loadEl = document.getElementById('loading');
    const msgEl = document.getElementById('loading-msg');
    const retryEl = document.getElementById('loading-retry');
    if(loadEl) loadEl.style.display = 'flex';
    // Render free tier: server sleeps after 15min inactivity
    const t1 = setTimeout(() => { if(msgEl) msgEl.textContent = 'El servidor está despertando... (puede tardar hasta 60s en el plan gratuito)'; }, 5000);
    const t2 = setTimeout(() => { if(retryEl) retryEl.style.display = 'block'; if(msgEl) msgEl.textContent = 'Tardando más de lo esperado. Pulsa Reintentar o espera.'; }, 35000);
    const done = () => { clearTimeout(t1); clearTimeout(t2); if(loadEl) loadEl.style.display = 'none'; };
    const token = localStorage.getItem('vibmon_token');
    if(token) {
      API._token = token;
      try {
        const d = await API.get('/auth/me');
        S.user = d.user; done(); this.showApp();
      } catch { done(); this.showLogin(); }
    } else { done(); this.showLogin(); }
  },

  showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('hdr').style.display = 'none';
    document.getElementById('app-content').style.display = 'none';
  },

  showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('hdr').style.display = 'flex';
    document.getElementById('app-content').style.display = 'block';
    document.getElementById('ubadge').textContent = S.user.role==='admin' ? `👤 ${S.user.username.toUpperCase()}` : '👁 SOLO LECTURA';
    ['btn-exp','btn-imp','btn-cfg','btn-bulk','btn-add-zone-list'].forEach(id => {
      const e = document.getElementById(id); if(e) e.style.display = isAdmin() ? '' : 'none';
    });
    history.replaceState({ view: 'v-zones', curZone: null, curMachine: null, curMeas: null }, '', '#v-zones');
    goZones(false);
  },

  logout() {
    S.user = null; API.setToken(null);
    this.showLogin();
    document.getElementById('l-user').value = '';
    document.getElementById('l-pass').value = '';
    document.getElementById('lerr').textContent = '';
  }
};

async function doLogin() {
  const u = document.getElementById('l-user').value.trim();
  const p = document.getElementById('l-pass').value;
  if(!u||!p) { document.getElementById('lerr').textContent='Introduce usuario y contraseña'; return; }
  const btn = document.getElementById('btn-login');
  btn.innerHTML = '<span class="spin"></span> Entrando...'; btn.disabled = true;
  try {
    const d = await API.post('/auth/login', { username: u, password: p });
    API.setToken(d.token); S.user = d.user;
    APP.showApp();
  } catch(e) {
    document.getElementById('lerr').textContent = e.message;
  } finally { btn.innerHTML = 'Entrar'; btn.disabled = false; }
}
function enterViewer() {
  S.user = { role:'viewer', username:'Visitante' };
  API.setToken(null);
  APP.showApp();
}
function logout() { APP.logout(); }

// ── CONFIG ────────────────────────────────────────────────────────────────────
async function saveCFG() {
  const op = document.getElementById('cp-old').value;
  const np = document.getElementById('cp-new').value;
  if(!op) { toast('Introduce la contraseña actual','err'); return; }
  try {
    await API.post('/auth/change-password', { currentPassword: op, newPassword: np||undefined });
    closeModal('mcfg'); toast('✓ Contraseña actualizada');
  } catch(e) { toast(e.message,'err'); }
}

// ── ZONES ─────────────────────────────────────────────────────────────────────
async function goZones(push) {
  showView('v-zones', push);
  try {
    const d = await API.get('/zones');
    S.zones = d.zones;
    renderZones(d.zones, d.stats);
  } catch(e) { toast(e.message,'err'); }
}
function openZoneList() {
  showView('v-zone-list', true);
  const grid = document.getElementById('zone-list-grid');
  if(!S.zones || !S.zones.length) {
    grid.innerHTML = '<p style="color:var(--tx2);text-align:center;padding:32px">Sin zonas definidas.</p>';
    return;
  }
  // Build cards using DOM to avoid any quote escaping issues
  grid.innerHTML = '';
  S.zones.forEach(z => {
    const hC = (z.critico_count||0)>0, hA = (z.alerta_count||0)>0;
    const mc = parseInt(z.machine_count||0);
    const cr = parseInt(z.critico_count||0);
    const al = parseInt(z.alerta_count||0);
    const ok = mc - cr - al;
    const col = cr>0?'var(--rd)':al>0?'var(--yw)':mc>0?'var(--gr)':'var(--tx3)';

    const card = document.createElement('div');
    card.className = 'zcard' + (hC?' zc':hA?' za':'');
    card.style.position = 'relative';
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => goZone(z.id));

    const badge = (!cr&&!al&&ok>0)
      ? '<span class="badge" style="background:rgba(0,255,136,.15);color:var(--gr);border:1px solid rgba(0,255,136,.3)">✓ OK</span>'
      : (cr?'<span class="badge bc">'+cr+' crítica'+(cr!==1?'s':'')+'</span>':'')
        +(al?'<span class="badge ba">'+al+' alerta'+(al!==1?'s':'')+'</span>':'');

    card.innerHTML =
      '<div class="zone-icon">'+(z.icon||'🏭')+'</div>'+
      '<div class="zone-name">'+z.name+'</div>'+
      '<div class="zone-desc">'+(z.description||'')+'</div>'+
      '<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px">'+
        '<span class="tag">🔧 '+mc+' máquina'+(mc!==1?'s':'')+'</span>'+
        badge+
      '</div>'+
      '<div style="position:absolute;top:10px;right:12px;font-size:18px;font-weight:700;color:'+col+';font-family:var(--mono)">'+(cr+al>0?cr+al:'✓')+'</div>';

    grid.appendChild(card);
  });
}

function renderZones(zones, stats) {
  // Set dashboard date
  const dateEl = document.getElementById('dash-date');
  if(dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('es-ES', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  }
  // Build KPIs using DOM to avoid onclick quote issues
  const gkpis = document.getElementById('gkpis');
  gkpis.innerHTML = '';

  // Row 1: Zones header bar
  const zonesBar = document.createElement('div');
  zonesBar.className = 'card';
  zonesBar.style.cssText = 'display:flex;align-items:center;gap:16px;padding:14px 20px;margin-bottom:12px;cursor:pointer;border-color:rgba(0,212,255,.2)';
  zonesBar.innerHTML =
    '<span style="font-size:24px">🏭</span>' +
    '<div style="flex:1">' +
      '<div style="font-size:11px;font-family:var(--mono);color:var(--ac);letter-spacing:2px">ZONAS DE LA FÁBRICA</div>' +
      '<div style="font-size:22px;font-weight:900;color:#f1f5f9;font-family:var(--mono)">' + (stats?.zone_count||0) + ' zonas · ' + (stats?.machine_count||0) + ' máquinas</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--ac)">Ver todas →</div>';
  zonesBar.addEventListener('click', openZoneList);
  gkpis.appendChild(zonesBar);

  // Row 2: 3 KPI cards
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px';

  // Críticas
  const kpiCrit = document.createElement('div');
  kpiCrit.className = 'card kpi';
  kpiCrit.style.cssText = 'cursor:pointer;border-color:' + (stats?.critico_count?'rgba(255,51,85,.35)':'var(--br)');
  kpiCrit.innerHTML =
    '<div style="font-size:26px;margin-bottom:4px">' + (stats?.critico_count>0?'🔴':'✅') + '</div>' +
    '<div class="kpin" style="color:' + (stats?.critico_count?'var(--rd)':'var(--gr)') + '">' + (stats?.critico_count||0) + '</div>' +
    '<div class="kpil">Críticas</div>' +
    '<div style="font-size:10px;color:' + (stats?.critico_count?'var(--rd)':'var(--tx2)') + ';margin-top:4px">' + (stats?.critico_count>0?'Ver listado →':'Sin alertas críticas') + '</div>';
  kpiCrit.addEventListener('click', () => showAlertList('critico'));
  row.appendChild(kpiCrit);

  // En alerta
  const kpiAlert = document.createElement('div');
  kpiAlert.className = 'card kpi';
  kpiAlert.style.cssText = 'cursor:pointer;border-color:' + (stats?.alerta_count?'rgba(255,204,0,.35)':'var(--br)');
  kpiAlert.innerHTML =
    '<div style="font-size:26px;margin-bottom:4px">' + (stats?.alerta_count>0?'⚠️':'✅') + '</div>' +
    '<div class="kpin" style="color:' + (stats?.alerta_count?'var(--yw)':'var(--gr)') + '">' + (stats?.alerta_count||0) + '</div>' +
    '<div class="kpil">En alerta</div>' +
    '<div style="font-size:10px;color:' + (stats?.alerta_count?'var(--yw)':'var(--tx2)') + ';margin-top:4px">' + (stats?.alerta_count>0?'Ver listado →':'Sin alertas') + '</div>';
  kpiAlert.addEventListener('click', () => showAlertList('alerta'));
  row.appendChild(kpiAlert);

  // En buen estado
  const kpiOk = document.createElement('div');
  kpiOk.className = 'card kpi';
  kpiOk.style.cssText = 'border-color:' + ((stats?.normal_count||0)>0?'rgba(0,255,136,.25)':'var(--br)');
  kpiOk.innerHTML =
    '<div style="font-size:26px;margin-bottom:4px">✅</div>' +
    '<div class="kpin" style="color:var(--gr)">' + (stats?.normal_count||0) + '</div>' +
    '<div class="kpil">En buen estado</div>' +
    '<div style="font-size:10px;color:var(--tx2);margin-top:4px">' + ((stats?.machine_count||0)>0?Math.round(((stats?.normal_count||0)/(stats?.machine_count||1))*100)+'% del total':'') + '</div>';
  row.appendChild(kpiOk);

  gkpis.appendChild(row)

  document.getElementById('btn-add-zone').style.display = isAdmin() ? '' : 'none';
  const grid = document.getElementById('zone-grid');
  if(!zones.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--tx2)">
      <div style="font-size:48px;margin-bottom:12px">🏭</div><p style="margin-bottom:14px">No hay zonas definidas aún.</p>
      ${isAdmin()?`<button class="btn bp" onclick="openModal('mzone')">+ Crear primera zona</button>`:'<p style="font-size:11px">Contacta con el administrador.</p>'}
    </div>`;
  } else {
    grid.innerHTML = zones.map(z => {
      const hC = (z.critico_count||0)>0, hA = (z.alerta_count||0)>0;
      return `<div class="zcard ${hC?'zc':hA?'za':''}" onclick="goZone('${z.id}')">
        <div class="zone-icon">${z.icon||'🏭'}</div>
        <div class="zone-name">${z.name}</div>
        <div class="zone-desc">${z.description||''}</div>
        <div class="row">
          <span class="tag">🔧 ${z.machine_count||0} máquina${(z.machine_count||0)!==1?'s':''}</span>
          ${hC?`<span class="badge bc">Crítico</span>`:hA?`<span class="badge ba">Alerta</span>`:''}
        </div>
      </div>`;
    }).join('');
  }

  // Alerts
  loadAlerts();
  // Last activity + quick stats
  loadDashboardExtra(zones, stats);
}
async function loadAlerts() {
  try {
    const alerts = await API.get('/measurements/alerts');
    const sec = document.getElementById('alrt-sec');
    // Always keep panel hidden on load - only show when user clicks filter buttons
    // But update the KPI buttons to show counts
    if(!alerts.length) { sec.style.display='none'; return; }
    sec.style.display = 'block'; // always visible in dashboard
    document.getElementById('alrt-list').style.display = 'none'; // but content collapsed
    document.getElementById('alrt-list').innerHTML = alerts.map(m => {
      const mx = Math.max(parseFloat(m.vx)||0,parseFloat(m.vy)||0,parseFloat(m.vz)||0);
      return `<div class="hr" onclick="openMeasFromAlert('${m.id}','${m.machine_id}','${m.component_id}')">
        <span style="font-size:18px">${m.severity==='critico'?'🔴':'🟡'}</span>
        <div style="flex:1"><div style="font-size:12px"><b>${m.machine_name}</b> › ${m.comp_name} — max <b style="color:var(--ac)">${mx.toFixed(2)} mm/s</b></div>
        <div style="font-size:10px;color:var(--tx2)">${m.zone_icon||''} ${m.zone_name} · ${m.fault_type||'Sin clasificar'} · ${m.date}</div></div>
        ${badgeH(m.severity)}</div>`;
    }).join('');
  } catch {}
}
async function openMeasFromAlert(measId, macId, compId) {
  // Find zone and machine, then navigate to measurement detail
  try {
    if(!S.zones || !S.zones.length) {
      const d = await API.get('/zones'); S.zones = d.zones;
    }
    for(const z of S.zones) {
      const machines = await API.get('/zones/'+z.id+'/machines');
      const mac = machines.find(m=>m.id===macId);
      if(mac) {
        S.curZone = z; S.curMachine = mac; S.machines = machines;
        machines.forEach(m => DB_machines[m.id] = m);
        const ms = await API.get('/components/'+compId+'/measurements');
        S.measurements = ms;
        S.curComp = mac.components?.find(c=>c.id===compId);
        renderMeasDetail(measId);
        return;
      }
    }
    toast('No se encontró la medición','err');
  } catch(e) { toast(e.message,'err'); }
}

// Zone CRUD
function openZoneModal(zone=null) {
  S.editZone = zone;
  document.getElementById('mzone-title').childNodes[0].textContent = zone ? '✏ EDITAR ZONA ' : '+ NUEVA ZONA ';
  document.getElementById('zn').value = zone?.name||'';
  document.getElementById('zd').value = zone?.description||'';
  document.getElementById('zi').value = zone?.icon||'';
  document.getElementById('zdel').style.display = zone ? '' : 'none';
  openModal('mzone');
}
async function saveZone() {
  const name = document.getElementById('zn').value.trim();
  if(!name) { toast('Nombre obligatorio','err'); return; }
  const body = { name, description: document.getElementById('zd').value.trim(), icon: document.getElementById('zi').value.trim()||'🏭' };
  try {
    if(S.editZone) { await API.put('/zones/'+S.editZone.id, body); toast('✓ Zona actualizada'); }
    else { await API.post('/zones', body); toast(`✓ Zona "${name}" creada`); }
    closeModal('mzone'); goZones();
  } catch(e) { toast(e.message,'err'); }
}
async function deleteZone() {
  if(!confirm('¿Eliminar zona y todo su contenido?')) return;
  try { await API.del('/zones/'+S.editZone.id); closeModal('mzone'); goZones(); toast('Zona eliminada'); }
  catch(e) { toast(e.message,'err'); }
}

// ── ZONE DETAIL ───────────────────────────────────────────────────────────────
const DB_machines = {}; // cache

async function goZone(zoneId, push) {
  // Ensure zones are loaded (e.g. when coming from zone-list)
  if(zoneId && (!S.zones || !S.zones.length)) {
    try { const d = await API.get('/zones'); S.zones = d.zones; } catch(e) {}
  }
  if(zoneId) S.curZone = S.zones.find(z=>z.id===zoneId) || S.curZone || { id: zoneId };
  showView('v-zone', push);
  document.getElementById('zone-title').textContent = (S.curZone?.icon||'📍')+' '+(S.curZone?.name||'Zona');
  document.getElementById('zone-desc').textContent = S.curZone?.description||'';
  document.getElementById('btn-add-mac').style.display = isAdmin() ? '' : 'none';
  document.getElementById('btn-edit-zone').style.display = isAdmin() ? '' : 'none';
  try {
    S.machines = await API.get('/zones/'+S.curZone.id+'/machines');
    S.machines.forEach(m => DB_machines[m.id] = m);
    renderMacGrid();
  } catch(e) { toast(e.message,'err'); }
}
function renderMacGrid() {
  const grid = document.getElementById('mac-grid');
  if(!S.machines.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:36px;color:var(--tx2)">
      <div style="font-size:36px;margin-bottom:10px">🔧</div><p>No hay máquinas en esta zona.</p>
      ${isAdmin()?`<button class="btn bp" style="margin-top:12px" onclick="openAddMachine()">+ Añadir primera máquina</button>`:''}
    </div>`;
    return;
  }
  grid.innerHTML = S.machines.map(mac => {
    const comps = mac.components?.length||0;
    const sevClass = mac.worst_severity === 'critico' ? 'sc' : mac.worst_severity === 'alerta' ? 'sa' : '';
    return `<div class="mcard ${sevClass}" onclick="goMachineById('${mac.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:7px;flex:1;margin-right:6px">
          <span style="font-size:22px">${mac.icon||'⚙'}</span>
          <div style="font-size:14px;font-weight:700;color:#f1f5f9">${mac.name}</div>
        </div>
        ${mac.worst_severity==='critico'?'<span class="badge bc" style="font-size:9px">CRÍTICO</span>':mac.worst_severity==='alerta'?'<span class="badge ba" style="font-size:9px">ALERTA</span>':''}
      </div>
      <div class="row" style="margin-bottom:7px">
        ${mac.type?`<span class="tag">${mac.type}</span>`:''}
        ${mac.rpm?`<span class="tag">⚙ ${mac.rpm} RPM</span>`:''}
      </div>
      ${mac.last_vx||mac.last_vy||mac.last_vz ? `
      <div style="font-family:var(--mono);font-size:11px;margin-bottom:5px;padding:5px 7px;background:var(--s2);border-radius:5px">
        <span style="color:var(--vx)">X:${parseFloat(mac.last_vx||0).toFixed(2)}</span>
        <span style="color:var(--tx3);margin:0 4px">·</span>
        <span style="color:var(--vy)">Y:${parseFloat(mac.last_vy||0).toFixed(2)}</span>
        <span style="color:var(--tx3);margin:0 4px">·</span>
        <span style="color:var(--vz)">Z:${parseFloat(mac.last_vz||0).toFixed(2)}</span>
        <span style="color:var(--tx3);font-size:9px"> mm/s</span>
      </div>` : ''}
      <div style="font-size:10px;color:var(--tx3)">${comps} componente${comps!==1?'s':''} · ${mac.last_date||'Sin mediciones'}</div>
    </div>`;
  }).join('');
}


// ── MACHINE ICONS ─────────────────────────────────────────────────────────────
const MAC_ICONS = [
  { icon: '⚙', label: 'Genérico' },
  { icon: '🔧', label: 'Motor' },
  { icon: '💨', label: 'Ventilador' },
  { icon: '💧', label: 'Bomba' },
  { icon: '⚡', label: 'Motor eléctrico' },
  { icon: '🔩', label: 'Reductor' },
  { icon: '🔄', label: 'Rodamiento' },
  { icon: '📦', label: 'Cinta/Redler' },
  { icon: '🏭', label: 'General' },
  { icon: '🌀', label: 'Compresor' },
  { icon: '🔗', label: 'Acoplamiento' },
  { icon: '⛽', label: 'Bomba hidráulica' },
  { icon: '🌬️', label: 'Extractor' },
  { icon: '🎡', label: 'Elevador/Noria' },
  { icon: '➡️', label: 'Transportador' },
  { icon: '🔀', label: 'Mezclador' },
  { icon: '🔨', label: 'Molino' },
  { icon: '🌊', label: 'Bomba sumergible' },
  { icon: '❄️', label: 'Refrigeración' },
  { icon: '🔋', label: 'Grupo electrógeno' },
];

function renderIconPicker(selectedIcon) {
  const container = document.getElementById('mac-icon-picker');
  if(!container) return;
  const sel = selectedIcon || document.getElementById('mac-icon-selected')?.value || '⚙';
  container.innerHTML = MAC_ICONS.map(({icon, label}) =>
    `<div onclick="selectMacIcon('${icon}')" title="${label}"
      style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;
      font-size:20px;border-radius:8px;cursor:pointer;transition:all .15s;
      border:2px solid ${icon===sel?'var(--ac)':'var(--br)'};
      background:${icon===sel?'rgba(0,212,255,.15)':'var(--s2)'}"
      id="icon-opt-${icon.codePointAt(0)}">${icon}</div>`
  ).join('');
}

function selectMacIcon(icon) {
  document.getElementById('mac-icon-selected').value = icon;
  renderIconPicker(icon);
}

// Machine CRUD
function openAddMachine() {
  S.editMac = null; S.selPredef = []; S.customComps = [];
  document.getElementById('mmac-title').childNodes[0].textContent = '+ NUEVA MÁQUINA ';
  ['mn','mr','mno'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('mt').value='';
  document.getElementById('mc-inp').value=''; document.getElementById('mc-tags').innerHTML='';
  document.getElementById('mdel').style.display='none';
  document.getElementById('mac-icon-selected').value='⚙';
  renderPredefChips(); renderIconPicker('⚙'); openModal('mmac');
}
function openEditMachine() {
  const mac = S.curMachine; if(!mac) return;
  S.editMac = mac;
  document.getElementById('mmac-title').childNodes[0].textContent = '✏ EDITAR MÁQUINA ';
  document.getElementById('mn').value = mac.name;
  document.getElementById('mt').value = mac.type||'';
  document.getElementById('mr').value = mac.rpm||'';
  document.getElementById('mno').value = mac.notes||'';
  document.getElementById('mc-inp').value = '';
  document.getElementById('mdel').style.display = '';
  S.selPredef = (mac.components||[]).filter(c=>PREDEF_COMPS.includes(c.name)).map(c=>c.name);
  S.customComps = (mac.components||[]).filter(c=>!PREDEF_COMPS.includes(c.name)).map(c=>({id:c.id,name:c.name}));
  const macIcon = mac.icon || '⚙';
  document.getElementById('mac-icon-selected').value = macIcon;
  renderPredefChips(); renderCustomTags(); renderIconPicker(macIcon); openModal('mmac');
}
function renderPredefChips() {
  document.getElementById('predef-chips').innerHTML = PREDEF_COMPS.map(n =>
    `<span class="chip ${S.selPredef.includes(n)?'sel':''}" onclick="togglePredef('${n}')">${n}</span>`).join('');
}
function togglePredef(n) { const i=S.selPredef.indexOf(n); if(i>=0)S.selPredef.splice(i,1); else S.selPredef.push(n); renderPredefChips(); }
function addCustomComp() {
  const v=document.getElementById('mc-inp').value.trim(); if(!v) return;
  S.customComps.push({id:uid(),name:v}); document.getElementById('mc-inp').value=''; renderCustomTags();
}
function removeCustom(i) { S.customComps.splice(i,1); renderCustomTags(); }
function renderCustomTags() {
  document.getElementById('mc-tags').innerHTML = S.customComps.map((c,i) =>
    `<span style="background:var(--s2);border:1px solid var(--br);border-radius:20px;padding:3px 10px;font-size:11px;display:inline-flex;align-items:center;gap:6px;margin:2px">
      ${c.name}<button onclick="removeCustom(${i})" style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:13px;padding:0;line-height:1">✕</button></span>`).join('');
}
async function saveMachine() {
  const name = document.getElementById('mn').value.trim();
  if(!name) { toast('Nombre obligatorio','err'); return; }
  const comps = [
    ...S.selPredef.map(n => { const ex = S.editMac?.components?.find(c=>c.name===n); return ex || {name:n}; }),
    ...S.customComps
  ];
  if(!comps.length) { toast('Añade al menos un componente','err'); return; }
  const icon = document.getElementById('mac-icon-selected')?.value || '⚙';
  const body = { name, type: document.getElementById('mt').value, rpm: document.getElementById('mr').value||null, notes: document.getElementById('mno').value.trim(), icon, components: comps };
  try {
    if(S.editMac) {
      await API.put('/machines/'+S.editMac.id, body);
      toast(`✓ Máquina "${name}" actualizada`,'ok');
      closeModal('mmac'); goMachineById(S.editMac.id);
    } else {
      const mac = await API.post('/zones/'+S.curZone.id+'/machines', body);
      closeModal('mmac');
      S.machines = await API.get('/zones/'+S.curZone.id+'/machines');
      S.machines.forEach(m=>DB_machines[m.id]=m);
      renderMacGrid();
      showSuccessBanner(`✓ Máquina "${name}" añadida correctamente`);
    }
  } catch(e) { toast(e.message,'err'); }
}
async function deleteMachine() {
  const id = S.editMac?.id || S.curMachine?.id; if(!id) return;
  if(!confirm('¿Eliminar máquina y todas sus mediciones?')) return;
  try { await API.del('/machines/'+id); closeModal('mmac'); goZone(); toast('Máquina eliminada'); }
  catch(e) { toast(e.message,'err'); }
}
function showSuccessBanner(msg) {
  document.querySelectorAll('.sbanner').forEach(b=>b.remove());
  const b = document.createElement('div'); b.className='sbanner';
  b.innerHTML = `<span style="font-size:22px">✅</span><div><div style="font-weight:700;color:var(--gr)">${msg}</div>
    <div style="font-size:11px;color:var(--tx2);margin-top:2px">Haz clic en la máquina para añadir mediciones</div></div>`;
  document.getElementById('mac-grid').insertAdjacentElement('beforebegin',b);
  setTimeout(()=>b.remove(),5000);
}

// ── MACHINE DETAIL ────────────────────────────────────────────────────────────
async function goMachineById(id, push) {
  const mac = S.machines.find(m=>m.id===id) || DB_machines[id];
  if(!mac) { toast('Máquina no encontrada','err'); return; }
  S.curMachine = mac; S.charts = {};
  document.getElementById('mac-title').textContent = '🔧 '+mac.name;
  document.getElementById('mac-actions').innerHTML = isAdmin()
    ? `<button class="btn bw sm" onclick="openEditMachine()">✏ Editar</button>
       <button class="btn bgr sm" onclick="window.open('/api/machines/${mac.id}/pdf','_blank')">📄 PDF completo</button>`
    : `<button class="btn bg sm" onclick="window.open('/api/machines/${mac.id}/pdf','_blank')">📄 PDF completo</button>`;
  document.getElementById('mac-info').innerHTML = `
    <div class="row">
      ${mac.type?`<span class="tag">🔩 ${mac.type}</span>`:''}
      ${mac.rpm?`<span class="tag">⚙ ${mac.rpm} RPM</span>`:''}
      <span class="tag">📍 ${S.curZone?.name||'?'}</span>
    </div>
    ${mac.notes?`<p style="margin-top:9px;font-size:12px;color:var(--tx2);line-height:1.6">${mac.notes}</p>`:''}`;
  // Ensure components loaded
  if(!mac.components) {
    const fresh = await API.get('/zones/'+S.curZone.id+'/machines');
    S.curMachine = fresh.find(m=>m.id===id)||mac;
  }
  renderMacKPIs();
  renderCompTabs(); // renders tabs hidden

  // Load ALL component measurements in parallel before showing the view
  const comps = S.curMachine.components || [];
  if(comps.length) {
    // Fetch all measurements simultaneously
    const allMeasResults = await Promise.all(
      comps.map(c => API.get('/components/'+c.id+'/measurements').catch(()=>[]))
    );

    // Build a map: compId -> measurements
    const measMap = {};
    comps.forEach((c, i) => { measMap[c.id] = allMeasResults[i]; });

    // Show/hide tabs and set colors based on results
    comps.forEach(c => {
      const ms = measMap[c.id] || [];
      const tab = document.getElementById('tab-'+c.id);
      const panel = document.getElementById('panel-'+c.id);
      if(!tab) return;
      if(ms.length === 0) {
        tab.style.display = 'none';
        if(panel) panel.style.display = 'none';
      } else {
        tab.style.display = '';
        tab.style.opacity = '1';
        tab.style.fontStyle = 'normal';
        const latest = ms.slice().sort((a,b)=>(b.measurement_date||b.date).localeCompare(a.measurement_date||a.date))[0];
        tab.classList.remove('tc','ta');
        if(latest.severity==='critico') tab.classList.add('tc');
        else if(latest.severity==='alerta') tab.classList.add('ta');
        const latestDate = latest.measurement_date || latest.date;
        tab.title = 'Última: '+latestDate+' · '+ms.length+' medición'+(ms.length!==1?'es':'');
      }
    });

    // Activate first visible component with its already-loaded measurements
    const firstComp = comps.find(c => {
      const t = document.getElementById('tab-'+c.id);
      return t && t.style.display !== 'none';
    });
    if(firstComp) {
      S.curComp = firstComp;
      S.measurements = measMap[firstComp.id];
      document.querySelectorAll('.ctab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.cpanel').forEach(p=>p.classList.remove('active'));
      const tab = document.getElementById('tab-'+firstComp.id);
      const panel = document.getElementById('panel-'+firstComp.id);
      if(tab) tab.classList.add('active');
      if(panel) panel.classList.add('active');
      renderLastMeasCard(firstComp.id);
      renderCompCharts(firstComp.id);
      renderHistory(firstComp.id);
      updateMacKPIs();
    }
  }

  showView('v-machine', push);
}
function goMachine() { if(S.curMachine) goMachineById(S.curMachine.id); }
function renderMacKPIs() {
  // KPIs computed from cached measurements
  document.getElementById('mac-kpis').innerHTML = ['normal','alerta','critico'].map(s=>
    `<div class="card kpi"><div class="kpin" style="font-size:22px;color:${SEV[s].c}">—</div><div class="kpil">${SEV[s].l}</div></div>`).join('');
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────
function renderCompTabs() {
  const mac = S.curMachine;
  if(!mac?.components?.length) { document.getElementById('comp-tabs').innerHTML=''; document.getElementById('comp-panels').innerHTML=''; return; }
  // Render all tabs hidden by default — updateCompTabColors will show only those with measurements
  document.getElementById('comp-tabs').innerHTML = mac.components.map(c =>
    `<div class="ctab" id="tab-${c.id}" onclick="activateComp('${c.id}')" style="display:none">${c.name}</div>`).join('');
  document.getElementById('comp-panels').innerHTML = mac.components.map(c => buildPanel(c, mac)).join('');
}

async function updateCompTabColors() {
  const mac = S.curMachine;
  if(!mac?.components?.length) return;
  for(const c of mac.components) {
    const tab = document.getElementById('tab-'+c.id);
    const panel = document.getElementById('panel-'+c.id);
    if(!tab) continue;
    try {
      const ms = await API.get('/components/'+c.id+'/measurements');
      if(ms.length === 0) {
        // Hide tab and panel entirely if no measurements
        tab.style.display = 'none';
        if(panel) panel.style.display = 'none';
      } else {
        tab.style.display = '';
        tab.style.opacity = '1';
        tab.style.fontStyle = 'normal';
        // Severity based only on LATEST measurement (by date)
        const latest = ms.slice().sort((a,b) => b.date.localeCompare(a.date))[0];
        const worst = latest.severity;
        tab.classList.remove('tc','ta');
        if(worst==='critico') { tab.classList.add('tc'); }
        else if(worst==='alerta') { tab.classList.add('ta'); }
        const latestDate = latest.measurement_date || latest.date;
        tab.title = `Última: ${latestDate} · ${ms.length} medición${ms.length!==1?'es':''}`;
        // Show last measurement summary under tab
        tab.dataset.lastDate = latestDate;
        tab.dataset.severity = worst;
      }
    } catch(e) {}
  }
  // After hiding empty tabs, activate first visible tab if current is hidden
  const visibleTabs = mac.components.filter(c => {
    const t = document.getElementById('tab-'+c.id);
    return t && t.style.display !== 'none';
  });
  if(visibleTabs.length && S.curComp) {
    const curTab = document.getElementById('tab-'+S.curComp.id);
    if(curTab && curTab.style.display === 'none') activateComp(visibleTabs[0].id);
  }
}
function buildPanel(c, mac) {
  return `<div class="cpanel" id="panel-${c.id}">
    <div style="font-family:var(--mono);font-size:11px;color:var(--ac);letter-spacing:1px;margin-bottom:12px">🔩 ${c.name.toUpperCase()}</div>

    <!-- ÚLTIMA MEDICIÓN destacada -->
    <div id="last-meas-${c.id}" style="display:none"></div>

    <!-- GRÁFICAS en desplegable -->
    <details id="charts-detail-${c.id}" style="margin-bottom:12px">
      <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--s2);border:1px solid var(--br);border-radius:8px;font-family:var(--mono);font-size:10px;color:var(--tx2);letter-spacing:1px;user-select:none">
        <span style="flex:1">📈 VER GRÁFICAS DE TENDENCIA</span><span>▼</span>
      </summary>
      <div style="border:1px solid var(--br);border-top:none;border-radius:0 0 8px 8px;padding:12px;background:var(--bg)">
        <div class="card" style="margin-bottom:8px">
          <div class="card-title">📈 Vibración X/Y/Z (mm/s ISO)</div>
          <canvas id="vc-${c.id}" height="100" style="display:none"></canvas>
          <div id="ve-${c.id}" style="text-align:center;color:var(--tx2);font-size:11px;padding:20px">Añade ≥2 mediciones para ver la gráfica</div>
          <div class="cleg">
            <span><i style="background:var(--vx)"></i>Eje X</span>
            <span><i style="background:var(--vy)"></i>Eje Y</span>
            <span><i style="background:var(--vz)"></i>Eje Z</span>
            <span><i style="background:rgba(255,204,0,.6)"></i>Límite alerta (ISO)</span>
          </div>
        </div>
        <div class="card">
          <div class="card-title">🌡 Temperatura</div>
          <canvas id="tc-${c.id}" height="80" style="display:none"></canvas>
          <div id="te-${c.id}" style="text-align:center;color:var(--tx2);font-size:11px;padding:18px">Sin datos de temperatura suficientes (≥2)</div>
        </div>
      </div>
    </details>

    <!-- AI LAST ANALYSIS -->
    <div id="ai-last-${c.id}" style="display:none">
      <details style="background:linear-gradient(135deg,rgba(0,68,170,.12),rgba(0,136,255,.06));border:1px solid rgba(0,136,255,.3);border-radius:10px;margin-bottom:12px;overflow:hidden">
        <summary style="padding:13px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none;user-select:none">
          <span style="font-family:var(--mono);font-size:10px;color:#4499ff;letter-spacing:2px;flex:1">🤖 ÚLTIMO ANÁLISIS IA</span>
          <span style="color:#4499ff;font-size:14px">▼</span>
        </summary>
        <div style="padding:0 16px 16px;border-top:1px solid rgba(0,136,255,.2)">
          <div id="ai-last-content-${c.id}" style="margin-top:12px;font-size:12px;color:var(--tx);line-height:1.9;white-space:pre-line"></div>
        </div>
      </details>
    </div>

    ${isAdmin() ? `
    <div class="card" id="addm-${c.id}" style="display:none">
      <div class="card-title">+ Nueva medición — ${c.name}</div>
      <div class="g2">
        <div>
          <label class="lbl">📅 Fecha de medición * <span style="font-size:10px;color:var(--tx2)">(cuándo se tomó realmente)</span></label>
          <input type="date" id="fd-${c.id}"/>
        </div>
        <div><label class="lbl">Punto de medición</label><input id="fp-${c.id}" placeholder="Ej: Lado libre, Vertical"/></div>
      </div>
      <label class="lbl">Valores X / Y / Z (mm/s ISO) *</label>
      <div class="xyz-inp">
        <div class="inp-x">
          <div class="xyz-axis-lbl" style="color:var(--vx)">X — HORIZONTAL</div>
          <input type="number" step=".01" id="vx-${c.id}" placeholder="0.00"/>
        </div>
        <div class="inp-y">
          <div class="xyz-axis-lbl" style="color:var(--vy)">Y — VERTICAL</div>
          <input type="number" step=".01" id="vy-${c.id}" placeholder="0.00"/>
        </div>
        <div class="inp-z">
          <div class="xyz-axis-lbl" style="color:var(--vz)">Z — AXIAL</div>
          <input type="number" step=".01" id="vz-${c.id}" placeholder="0.00"/>
        </div>
      </div>
      <div style="margin-top:6px">
        <button class="btn bg xs" onclick="autoSev('${c.id}')">⚡ Calcular severidad automática (ISO 10816)</button>
      </div>
      <div class="g2" style="margin-top:4px">
        <div><label class="lbl">Temperatura (°C)</label><input type="number" step=".1" id="ft-${c.id}" placeholder="—"/></div>
        <div><label class="lbl">Severidad</label>
          <select id="fs-${c.id}">
            <option value="normal">✅ Normal</option>
            <option value="alerta">⚠ Alerta</option>
            <option value="critico">🔴 Crítico</option>
          </select>
        </div>
      </div>
      <label class="lbl">Tipo de falla</label>
      <select id="ff-${c.id}">
        <option value="">— Sin clasificar —</option>
        <option>Desbalance (dominante 1X)</option><option>Desalineación (dominante 2X)</option>
        <option>Aflojamiento mecánico (armónicos múltiples)</option><option>Falla rodamiento (BPFO/BPFI/BSF)</option>
        <option>Falla engranaje (GMF)</option><option>Resonancia</option>
        <option>Rozamiento (rub, 0.5X)</option><option>Problema eléctrico (2×línea)</option>
        <option>Normal / Sin falla</option>
      </select>
      <label class="lbl">Observaciones</label>
      <textarea id="fn-${c.id}" placeholder="Condiciones de operación, ruidos, acciones tomadas..."></textarea>
      <label class="lbl">Imágenes del espectro / analizador</label>
      <div class="upz" onclick="document.getElementById('fi-${c.id}').click()">
        <div class="upz-icon">📊</div><p>Haz clic para añadir imágenes · Varias a la vez</p>
      </div>
      <input type="file" id="fi-${c.id}" accept="image/*" multiple style="display:none" onchange="handleImgs(event,'${c.id}')"/>
      <div class="igrid" id="ig-${c.id}"></div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn bai sm" id="ai-btn-${c.id}" onclick="analyzeAI('${c.id}')" disabled>🤖 Analizar con IA</button>
        <span id="ai-hint-${c.id}" style="color:var(--tx2);font-size:10px">Sube una imagen para activar</span>
      </div>
      <div id="ai-res-${c.id}" style="display:none"></div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn bp" onclick="saveMeas('${c.id}','${mac.id}')">💾 Guardar medición</button>
        <button class="btn bg" onclick="cancelMeas('${c.id}')">Cancelar</button>
      </div>
    </div>
    <div id="addbtn-${c.id}" style="margin-bottom:12px">
      <button class="btn bp sm" onclick="openAddMeas('${c.id}')">+ Añadir medición</button>
    </div>` : `
    <div id="addbtn-${c.id}" style="margin-bottom:12px">
      <span style="font-size:11px;color:var(--tx2)">👁 Solo lectura</span>
    </div>`}
    <div class="card">
      <div class="card-title">📋 Historial <span id="hcount-${c.id}" style="font-weight:400;color:var(--tx2)"></span>
        <div style="display:flex;gap:5px;margin-left:auto;align-items:center;flex-wrap:wrap">
          <button class="btn xs bg" onclick="renderHistory('${c.id}','all')" id="f-all-${c.id}">Todas</button>
          <button class="btn xs" style="background:rgba(255,51,85,.1);color:var(--rd);border:1px solid rgba(255,51,85,.3)" onclick="renderHistory('${c.id}','critico')">🔴</button>
          <button class="btn xs" style="background:rgba(255,204,0,.1);color:var(--yw);border:1px solid rgba(255,204,0,.3)" onclick="renderHistory('${c.id}','alerta')">⚠️</button>
          <button class="btn xs" style="background:rgba(0,255,136,.1);color:var(--gr);border:1px solid rgba(0,255,136,.3)" onclick="renderHistory('${c.id}','normal')">✅</button>
          <button class="btn bai xs" id="analyze-all-btn-${c.id}" onclick="analyzeAllMeasurements('${c.id}')">🤖 IA</button>
        </div>
      </div>
      <div id="analyze-all-prog-${c.id}" style="display:none;margin-bottom:10px">
        <div style="background:var(--s2);border-radius:4px;height:6px;overflow:hidden">
          <div id="analyze-all-bar-${c.id}" style="background:var(--ac);height:100%;width:0%;transition:width .3s;border-radius:4px"></div>
        </div>
        <div id="analyze-all-status-${c.id}" style="font-size:10px;color:var(--tx2);margin-top:4px"></div>
      </div>
      <div id="hist-${c.id}"></div>
    </div>
  </div>`;
}

async function activateComp(cid) {
  S.curComp = S.curMachine?.components?.find(c=>c.id===cid);
  document.querySelectorAll('.ctab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.cpanel').forEach(p=>p.classList.remove('active'));
  const tab=document.getElementById('tab-'+cid), panel=document.getElementById('panel-'+cid);
  if(tab) tab.classList.add('active');
  if(panel) panel.classList.add('active');
  try {
    S.measurements = await API.get('/components/'+cid+'/measurements');
    renderLastMeasCard(cid);
    renderCompCharts(cid);
    renderHistory(cid);
    updateMacKPIs();
  } catch(e) { toast(e.message,'err'); }
}

function renderLastMeasCard(cid) {
  const el = document.getElementById('last-meas-'+cid);
  if(!el) return;
  const ms = [...S.measurements].sort((a,b) => {
    const da = a.measurement_date || a.date;
    const db = b.measurement_date || b.date;
    return db.localeCompare(da);
  });
  if(!ms.length) { el.style.display='none'; return; }
  const m = ms[0];
  const maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
  const measDate = m.measurement_date || m.date;
  const uploadedAt = m.created_at ? new Date(m.created_at).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  const sameDay = measDate === (m.created_at ? m.created_at.split('T')[0] : m.date);
  const uploadHtml = (!sameDay && uploadedAt) ? '<div style="font-size:9px;color:var(--tx3);margin-top:3px">Subida: '+uploadedAt+'</div>' : '';
  const faultHtml = m.fault_type ? '<div style="margin-top:8px;font-size:11px;color:var(--tx2)">'+m.fault_type+'</div>' : '';
  const tempVal = m.temperature!=null ? parseFloat(m.temperature).toFixed(1)+'\u00b0C' : '\u2014';
  el.style.display = 'block';
  el.innerHTML =
    '<div class="card" style="border-left:3px solid '+(SEV[m.severity]?.c||'var(--gr)')+';margin-bottom:12px;cursor:pointer" onclick="renderMeasDetail(\'' +m.id+ '\')">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--ac);letter-spacing:1px">ULTIMA MEDICION</div>' +
        badgeH(m.severity) +
        '<div style="margin-left:auto;text-align:right">' +
          '<div style="font-size:16px;font-weight:700;font-family:var(--mono)">'+measDate+'</div>' +
          '<div style="font-size:12px;margin-top:2px">'+relDate(measDate)+'</div>' +
          uploadHtml +
        '</div>' +
      '</div>' +
      '<div class="xyz-grid" style="margin-bottom:10px">' +
        '<div class="xyz-cell xyz-x"><div class="xyz-label">X HORIZONTAL</div><div class="xyz-val">'+fv(m.vx)+'</div><div class="xyz-unit">mm/s ISO</div><div>'+axisSevDot(m.vx)+'</div></div>' +
        '<div class="xyz-cell xyz-y"><div class="xyz-label">Y VERTICAL</div><div class="xyz-val">'+fv(m.vy)+'</div><div class="xyz-unit">mm/s ISO</div><div>'+axisSevDot(m.vy)+'</div></div>' +
        '<div class="xyz-cell xyz-z"><div class="xyz-label">Z AXIAL</div><div class="xyz-val">'+fv(m.vz)+'</div><div class="xyz-unit">mm/s ISO</div><div>'+axisSevDot(m.vz)+'</div></div>' +
      '</div>' +
      '<div class="g2">' +
        '<div class="card" style="text-align:center;padding:8px"><div style="font-size:10px;color:var(--tx2)">TEMPERATURA</div><div style="font-size:18px;font-weight:700;color:var(--or);font-family:var(--mono)">'+tempVal+'</div></div>' +
        '<div class="card" style="text-align:center;padding:8px"><div style="font-size:10px;color:var(--tx2)">MAX. VALOR</div><div style="font-size:18px;font-weight:700;color:var(--ac);font-family:var(--mono)">'+maxV.toFixed(2)+' <span style="font-size:10px">mm/s</span></div></div>' +
      '</div>' +
      faultHtml +
      '<div style="text-align:right;margin-top:8px;font-size:10px;color:var(--tx3)">Ver detalle completo</div>' +
    '</div>';
}
function updateMacKPIs() {
  const allMs = S.measurements;
  const cnt = {normal:0,alerta:0,critico:0};
  allMs.forEach(m=>cnt[m.severity]=(cnt[m.severity]||0)+1);
  document.getElementById('mac-kpis').innerHTML = ['normal','alerta','critico'].map(s=>
    `<div class="card kpi" style="border-color:${s==='normal'?'var(--br)':s==='alerta'?'rgba(255,204,0,.2)':'rgba(255,51,85,.2)'}">
      <div class="kpin" style="font-size:22px;color:${SEV[s].c}">${cnt[s]}</div>
      <div class="kpil">${SEV[s].l}</div></div>`).join('');
}

// ── CHARTS ────────────────────────────────────────────────────────────────────
function renderCompCharts(cid) {
  const ms = S.measurements;
  if(S.charts[cid]) { try{S.charts[cid].vib?.destroy();}catch(e){} try{S.charts[cid].temp?.destroy();}catch(e){} }
  S.charts[cid] = {};
  const vc=document.getElementById('vc-'+cid), ve=document.getElementById('ve-'+cid);
  if(!vc) return;
  if(ms.length<2){vc.style.display='none';ve.style.display='block';}
  else {
    vc.style.display='block'; ve.style.display='none';
    const labels=ms.map(m=>m.date);
    const vxVals=ms.map(m=>parseFloat(m.vx)||0);
    const vyVals=ms.map(m=>parseFloat(m.vy)||0);
    const vzVals=ms.map(m=>parseFloat(m.vz)||0);
    const mx=Math.max(...vxVals,...vyVals,...vzVals)*1.3||1;
    S.charts[cid].vib = new Chart(vc,{type:'line',
      data:{labels,datasets:[
        {label:'X',data:vxVals,borderColor:'#00d4ff',pointRadius:4,pointHoverRadius:6,tension:.35,fill:false,borderWidth:2},
        {label:'Y',data:vyVals,borderColor:'#bf7fff',pointRadius:4,pointHoverRadius:6,tension:.35,fill:false,borderWidth:2},
        {label:'Z',data:vzVals,borderColor:'#00ff88',pointRadius:4,pointHoverRadius:6,tension:.35,fill:false,borderWidth:2},
        {label:'Alerta',data:Array(ms.length).fill(ISO_ALERT),borderColor:'rgba(255,204,0,.6)',borderDash:[6,4],pointRadius:0,fill:false,borderWidth:1.5},
        {label:'Crítico',data:Array(ms.length).fill(ISO_CRIT),borderColor:'rgba(255,51,85,.6)',borderDash:[6,4],pointRadius:0,fill:false,borderWidth:1.5}
      ]},
      options:{responsive:true,animation:{duration:600},
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>{
          if(ctx.datasetIndex>2)return ctx.dataset.label;
          return`${['X','Y','Z'][ctx.datasetIndex]}: ${ctx.parsed.y.toFixed(2)} mm/s`;
        }}}},
        scales:{
          x:{ticks:{color:'#5a7a9a',font:{size:9},maxRotation:45},grid:{color:'#0f2040'}},
          y:{min:0,max:mx,ticks:{color:'#5a7a9a',font:{size:9}},grid:{color:'#0f2040'}}}},
      plugins:[{id:'zones',beforeDraw(chart){
        const{ctx,scales:{y,x}}=chart;if(!y||!x)return;
        const pA=y.getPixelForValue(ISO_ALERT),pC=y.getPixelForValue(ISO_CRIT);
        const top=y.getPixelForValue(y.max),bot=y.getPixelForValue(0),l=x.left,r=x.right;
        ctx.save();
        ctx.fillStyle='rgba(255,51,85,.07)';ctx.fillRect(l,top,r-l,pC-top);
        ctx.fillStyle='rgba(255,204,0,.06)';ctx.fillRect(l,pC,r-l,pA-pC);
        ctx.fillStyle='rgba(0,255,136,.05)';ctx.fillRect(l,pA,r-l,bot-pA);
        ctx.restore();
      }}]
    });
  }
  const tc=document.getElementById('tc-'+cid), te=document.getElementById('te-'+cid);
  const tms=ms.filter(m=>m.temperature!=null&&!isNaN(parseFloat(m.temperature)));
  if(tms.length<2){tc.style.display='none';te.style.display='block';}
  else {
    tc.style.display='block'; te.style.display='none';
    const tv=tms.map(m=>parseFloat(m.temperature));
    S.charts[cid].temp=new Chart(tc,{type:'line',
      data:{labels:tms.map(m=>m.date),datasets:[{label:'°C',data:tv,borderColor:'#ff9944',backgroundColor:'rgba(255,153,68,.09)',pointRadius:4,tension:.35,fill:true}]},
      options:{responsive:true,animation:{duration:600},plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y.toFixed(1)} °C`}}},
        scales:{x:{ticks:{color:'#5a7a9a',font:{size:9}},grid:{color:'#0f2040'}},y:{ticks:{color:'#5a7a9a',font:{size:9},callback:v=>v+'°'},grid:{color:'#0f2040'}}}}});
  }
}

// ── MEASUREMENTS ──────────────────────────────────────────────────────────────
function openAddMeas(cid) {
  S.newImgs = [];
  document.getElementById('fd-'+cid).value = new Date().toISOString().slice(0,10);
  ['fp','ft','fn'].forEach(p=>{const e=document.getElementById(p+'-'+cid);if(e)e.value='';});
  ['vx','vy','vz'].forEach(p=>{const e=document.getElementById(p+'-'+cid);if(e)e.value='';});
  document.getElementById('fs-'+cid).value='normal';
  document.getElementById('ff-'+cid).value='';
  document.getElementById('ig-'+cid).innerHTML='';
  document.getElementById('ai-res-'+cid).style.display='none';
  document.getElementById('ai-btn-'+cid).disabled=true;
  document.getElementById('ai-hint-'+cid).textContent='Sube una imagen para activar';
  document.getElementById('addm-'+cid).style.display='block';
  document.getElementById('addbtn-'+cid).style.display='none';
  document.getElementById('addm-'+cid).scrollIntoView({behavior:'smooth'});
}
function cancelMeas(cid) {
  document.getElementById('addm-'+cid).style.display='none';
  document.getElementById('addbtn-'+cid).style.display='block';
  S.newImgs=[];
}
function autoSev(cid) {
  const vx=parseFloat(document.getElementById('vx-'+cid).value)||0;
  const vy=parseFloat(document.getElementById('vy-'+cid).value)||0;
  const vz=parseFloat(document.getElementById('vz-'+cid).value)||0;
  if(!vx&&!vy&&!vz){toast('Introduce al menos un valor X/Y/Z','err');return;}
  const s=calcSev(vx,vy,vz);
  document.getElementById('fs-'+cid).value=s;
  toast(`Severidad: ${SEV[s].l} (max ${Math.max(vx,vy,vz).toFixed(2)} mm/s · ISO 10816)`,'info');
}
function handleImgs(evt,cid) {
  Array.from(evt.target.files).forEach(file=>{
    const r=new FileReader(); r.onload=e=>{
      S.newImgs.push({name:file.name,dataUrl:e.target.result,file});
      renderImgGrid(cid);
      document.getElementById('ai-btn-'+cid).disabled=false;
      document.getElementById('ai-hint-'+cid).textContent=`${S.newImgs.length} imagen(es) lista(s)`;
    }; r.readAsDataURL(file);
  }); evt.target.value='';
}
function renderImgGrid(cid) {
  document.getElementById('ig-'+cid).innerHTML = S.newImgs.map((img,i)=>
    `<div class="ith"><img src="${img.dataUrl}" onclick="openLB('${img.dataUrl}')" title="${img.name}"/>
      <button class="del-img" onclick="removeImg(${i},'${cid}')">✕</button></div>`).join('');
}
function removeImg(i,cid) {
  S.newImgs.splice(i,1); renderImgGrid(cid);
  if(!S.newImgs.length){document.getElementById('ai-btn-'+cid).disabled=true;document.getElementById('ai-hint-'+cid).textContent='Sube una imagen para activar';}
}
async function saveMeas(cid, macId) {
  const vx=document.getElementById('vx-'+cid).value;
  const vy=document.getElementById('vy-'+cid).value;
  const vz=document.getElementById('vz-'+cid).value;
  if(!vx&&!vy&&!vz){toast('Introduce al menos un valor X, Y o Z','err');return;}
  const fd = new FormData();
  fd.append('machine_id', macId);
  const measDate = document.getElementById('fd-'+cid).value;
  fd.append('date', measDate);
  fd.append('measurement_date', measDate);
  fd.append('point', document.getElementById('fp-'+cid).value);
  fd.append('vx', vx||''); fd.append('vy', vy||''); fd.append('vz', vz||'');
  fd.append('temperature', document.getElementById('ft-'+cid).value||'');
  fd.append('severity', document.getElementById('fs-'+cid).value);
  fd.append('fault_type', document.getElementById('ff-'+cid).value);
  fd.append('notes', document.getElementById('fn-'+cid).value);
  fd.append('ai_result', window['_aiResult_'+cid] || '');
  S.newImgs.forEach(img => fd.append('images', img.file));
  try {
    const saved = await API.postForm('/components/'+cid+'/measurements', fd);
    S.measurements = await API.get('/components/'+cid+'/measurements');
    S.newImgs=[]; window['_aiResult_'+cid]=''; cancelMeas(cid);
    renderLastMeasCard(cid); renderCompCharts(cid); renderHistory(cid); updateMacKPIs();
    updateTabSev(cid);
    const maxV=Math.max(parseFloat(vx)||0,parseFloat(vy)||0,parseFloat(vz)||0);
    const b=document.createElement('div');b.className='sbanner';b.style.marginTop='12px';
    b.innerHTML=`<span style="font-size:20px">✅</span><div>
      <div style="font-weight:700;color:var(--gr)">¡Medición guardada correctamente!</div>
      <div style="font-size:11px;color:var(--tx2);margin-top:2px">${saved.date} · X:${vx||'—'} Y:${vy||'—'} Z:${vz||'—'} mm/s · ${SEV[saved.severity].l}</div>
    </div>`;
    const h=document.getElementById('hist-'+cid);
    if(h){h.insertAdjacentElement('beforebegin',b);setTimeout(()=>b.remove(),5000);}
  } catch(e){toast(e.message,'err');}
}
function updateTabSev(cid) {
  const ms=S.measurements; if(!ms.length)return;
  const latest = ms.slice().sort((a,b)=>(b.measurement_date||b.date).localeCompare(a.measurement_date||a.date))[0];
  const s = latest.severity;
  const tab=document.getElementById('tab-'+cid);
  if(tab)tab.className='ctab active'+(s==='critico'?' tc':s==='alerta'?' ta':'');
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function renderHistory(cid, filterSev) {
  let ms=[...S.measurements].reverse();
  if(filterSev && filterSev !== 'all') ms = ms.filter(m => m.severity === filterSev);
  const el=document.getElementById('hist-'+cid);
  const cnt=document.getElementById('hcount-'+cid);
  if(cnt)cnt.textContent=S.measurements.length?`(${S.measurements.length})`:'';
  // Show last AI result in component panel
  const lastWithAI = S.measurements.filter(m=>m.ai_result).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const aiBlock = document.getElementById('ai-last-'+cid);
  const aiContent = document.getElementById('ai-last-content-'+cid);
  if(aiBlock && aiContent && lastWithAI?.ai_result) {
    aiBlock.style.display='block';
    aiContent.textContent = lastWithAI.ai_result;
  } else if(aiBlock) { aiBlock.style.display='none'; }
  if(!ms.length){el.innerHTML='<p style="color:var(--tx2);font-size:12px;padding:8px 0">Sin mediciones aún.</p>';return;}
  el.innerHTML=ms.map(m=>{
    const imgs=m.images||[];
    const thumb=imgs.length?`<img class="hth" src="${imgs[0]}" onclick="event.stopPropagation();openLB('${imgs[0]}')">`:`<div class="hni">📊</div>`;
    const mDate = m.measurement_date || m.date;
    return`<div class="hr" onclick="renderMeasDetail('${m.id}')">
      ${thumb}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span>${mDate}</span>
          <span style="font-size:11px">${relDate(mDate)}</span>
          ${m.point?`<span style="color:var(--tx2);font-size:11px">${m.point}</span>`:''}
        </div>
        <div class="xyz-mini">
          <span class="vx">X:${fv(m.vx)}</span><span class="sep">·</span>
          <span class="vy">Y:${fv(m.vy)}</span><span class="sep">·</span>
          <span class="vz">Z:${fv(m.vz)}</span>
          <span style="color:var(--tx2);font-size:10px"> mm/s</span>
          ${m.temperature!=null?`<span style="color:var(--or);margin-left:6px"> ${parseFloat(m.temperature).toFixed(1)}°C</span>`:''}
        </div>
      </div>
      ${badgeH(m.severity)}<span style="color:var(--tx3)">›</span></div>`;
  }).join('');
}

// ── MEASUREMENT DETAIL ────────────────────────────────────────────────────────
async function renderMeasDetail(measId) {
  const m = S.measurements.find(x=>x.id===measId);
  if(!m) return;
  S.curMeas = m;
  const comp = S.curMachine?.components?.find(c=>c.id===m.component_id);
  const mDate = m.measurement_date || m.date;
  document.getElementById('md-title').textContent = `${S.curMachine?.name||'?'} › ${comp?.name||'?'} — ${mDate}`;
  document.getElementById('back-meas').onclick = () => goMachineById(S.curMachine.id);
  document.getElementById('btn-del-meas').style.display = isAdmin() ? '' : 'none';
  document.getElementById('btn-edit-meas').style.display = isAdmin() ? '' : 'none';
  const imgs = m.images||[];
  const imgHtml = imgs.length ? `<div class="card"><div class="card-title">📷 Imágenes (${imgs.length})</div>
    <div class="igrid">${imgs.map(src=>`<div class="ith"><img src="${src}" onclick="openLB('${src}')"/></div>`).join('')}</div></div>`:'';
  document.getElementById('md-content').innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:14px">
        ${comp?`<span class="tag">🔩 ${comp.name}</span>`:''}
        ${m.point?`<span class="tag">📐 ${m.point}</span>`:''}
        ${badgeH(m.severity)}
        <button class="btn bgr xs" onclick="window.open('/api/measurements/${m.id}/pdf','_blank')">📄 PDF</button>
      </div>
      <div class="xyz-grid">
        <div class="xyz-cell xyz-x">
          <div class="xyz-label">X — HORIZONTAL</div>
          <div class="xyz-val">${fv(m.vx)}</div>
          <div class="xyz-unit">mm/s ISO</div>
          <div>${axisSevDot(m.vx)}</div>
        </div>
        <div class="xyz-cell xyz-y">
          <div class="xyz-label">Y — VERTICAL</div>
          <div class="xyz-val">${fv(m.vy)}</div>
          <div class="xyz-unit">mm/s ISO</div>
          <div>${axisSevDot(m.vy)}</div>
        </div>
        <div class="xyz-cell xyz-z">
          <div class="xyz-label">Z — AXIAL</div>
          <div class="xyz-val">${fv(m.vz)}</div>
          <div class="xyz-unit">mm/s ISO</div>
          <div>${axisSevDot(m.vz)}</div>
        </div>
      </div>
      <div class="g2" style="margin-top:10px">
        <div class="card" style="text-align:center;padding:10px">
          <div style="font-size:10px;color:var(--tx2)">TEMPERATURA</div>
          <div style="font-size:20px;font-weight:700;color:var(--or);font-family:var(--mono)">${m.temperature!=null?parseFloat(m.temperature).toFixed(1)+'°C':'—'}</div>
        </div>
        <div class="card" style="text-align:center;padding:10px">
          <div style="font-size:10px;color:var(--tx2)">MÁX. VALOR</div>
          <div style="font-size:20px;font-weight:700;color:var(--ac);font-family:var(--mono)">${Math.max(parseFloat(m.vx)||0,parseFloat(m.vy)||0,parseFloat(m.vz)||0).toFixed(2)} <span style="font-size:10px">mm/s</span></div>
        </div>
      </div>
      ${m.ai_result?`<details style="background:linear-gradient(135deg,rgba(0,68,170,.12),rgba(0,136,255,.06));border:1px solid rgba(0,136,255,.3);border-radius:8px;margin-top:12px;overflow:hidden">
        <summary style="padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none;user-select:none">
          <span style="font-family:var(--mono);font-size:10px;color:#4499ff;letter-spacing:2px;flex:1">🤖 ANÁLISIS IA — VER DIAGNÓSTICO COMPLETO</span>
          <span style="color:#4499ff;font-size:14px">▼</span>
        </summary>
        <div style="padding:0 14px 14px;border-top:1px solid rgba(0,136,255,.2)">
          <div style="margin-top:10px;font-size:12px;color:var(--tx);line-height:1.9;white-space:pre-line">${m.ai_result}</div>
        </div>
      </details>`:''}
      ${m.fault_type?`<div style="margin-top:12px"><div style="font-size:10px;color:var(--tx2)">TIPO DE FALLA</div><div style="font-size:14px;margin-top:4px">${m.fault_type}</div></div>`:''}
      ${m.notes?`<div style="margin-top:10px"><div style="font-size:10px;color:var(--tx2)">OBSERVACIONES</div><p style="font-size:13px;color:var(--tx2);margin-top:4px;line-height:1.6">${m.notes}</p></div>`:''}
      <div style="margin-top:12px;padding:8px;background:var(--s2);border-radius:6px">
        <div style="font-size:10px;color:var(--tx2);margin-bottom:4px">FECHAS</div>
        <div style="font-size:12px">📅 Medición tomada: <strong>${mDate}</strong> <span style="margin-left:6px">${relDate(mDate)}</span></div>
        ${m.created_at && (m.measurement_date && m.measurement_date !== m.created_at?.split('T')[0]) ? `<div style="font-size:11px;color:var(--tx3);margin-top:3px">📤 Subida al sistema: ${new Date(m.created_at).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>` : ''}
        ${m.created_by ? `<div style="font-size:10px;color:var(--tx3);margin-top:2px">Por: ${m.created_by}</div>` : ''}
      </div>
    </div>
    ${imgHtml}`;
  showView('v-meas');
}
async function deleteMeas() {
  if(!confirm('¿Eliminar esta medición?')) return;
  try {
    await API.del('/measurements/'+S.curMeas.id);
    toast('Medición eliminada');
    goMachineById(S.curMachine.id);
  } catch(e) { toast(e.message,'err'); }
}





// ── DASHBOARD EXTRA ───────────────────────────────────────────────────────────
async function loadDashboardExtra(zones, stats) {
  // Zone heatmap
  const heatmap = document.getElementById('zone-heatmap');
  if(heatmap) {
    if(!zones.length) {
      heatmap.innerHTML = '<p style="color:var(--tx2);font-size:12px;text-align:center;padding:16px">Sin zonas definidas</p>';
    } else {
      heatmap.innerHTML = zones.map(z => {
        const mc = parseInt(z.machine_count||0);
        const cr = parseInt(z.critico_count||0);
        const al = parseInt(z.alerta_count||0);
        const ok = mc - cr - al;
        const col = cr > 0 ? 'var(--rd)' : al > 0 ? 'var(--yw)' : mc > 0 ? 'var(--gr)' : 'var(--tx3)';
        const bg = cr > 0 ? 'rgba(255,51,85,.08)' : al > 0 ? 'rgba(255,204,0,.08)' : 'rgba(0,255,136,.05)';
        const pct = mc > 0 ? Math.round(((cr+al)/mc)*100) : 0;
        const okPct = mc > 0 ? Math.round((ok/mc)*100) : 0;
        return `<div onclick="goZone('${z.id}')" style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;background:${bg};border:1px solid ${col}33;margin-bottom:6px;transition:all .2s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
          <span style="font-size:20px">${z.icon||'🏭'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${z.name}</div>
            <div style="font-size:10px;color:var(--tx2);margin-top:2px">${mc} máq${cr?` · <span style="color:var(--rd)">${cr} crit</span>`:''}${al?` · <span style="color:var(--yw)">${al} alert</span>`:''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:700;color:${col};font-family:var(--mono)">${cr+al > 0 ? cr+al : '✓'}</div>
            <div style="font-size:9px;color:${pct>0?'var(--rd)':'var(--gr)'}">${mc>0?(pct>0?pct+'% KO':okPct+'% OK'):''}</div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Quick stats (hidden, replaced by heatmap)
  const qs = document.getElementById('quick-stats-content');
  if(qs) {
    const totalMacs = zones.reduce((a,z) => a + parseInt(z.machine_count||0), 0);
    const crits = parseInt(stats?.critico_count||0);
    const alerts = parseInt(stats?.alerta_count||0);
    qs.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px">
          <div style="font-size:22px;font-weight:700;color:var(--ac);font-family:var(--mono)">${totalMacs}</div>
          <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:1px">Máquinas</div>
        </div>
        <div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px">
          <div style="font-size:22px;font-weight:700;color:${crits?'var(--rd)':'var(--gr)'};font-family:var(--mono)">${crits}</div>
          <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:1px">Críticos</div>
        </div>
        <div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px">
          <div style="font-size:22px;font-weight:700;color:${alerts?'var(--yw)':'var(--gr)'};font-family:var(--mono)">${alerts}</div>
          <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:1px">En alerta</div>
        </div>
        <div style="text-align:center;padding:10px;background:var(--s2);border-radius:8px">
          <div style="font-size:22px;font-weight:700;color:var(--gr);font-family:var(--mono)">${crits===0&&alerts===0?'OK':'!'}</div>
          <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:1px">Estado</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--tx2);text-align:center">
        ${crits===0&&alerts===0?'✅ Todo en estado normal':'⚠️ Hay '+(crits+alerts)+' mediciones que requieren atención'}
      </div>`;
  }

  // Last activity
  try {
    const la = document.getElementById('last-activity-list');
    if(!la) return;
    const alerts = await API.get('/measurements/alerts');
    // Get recent from all zones
    let recent = [];
    for(const z of zones.slice(0,3)) {
      try {
        const macs = await API.get('/zones/'+z.id+'/machines');
        for(const mac of macs.slice(0,2)) {
          for(const comp of (mac.components||[]).slice(0,1)) {
            const ms = await API.get('/components/'+comp.id+'/measurements');
            if(ms.length) recent.push({...ms[ms.length-1], machine_name: mac.name, comp_name: comp.name, zone_name: z.name, zone_icon: z.icon});
          }
        }
      } catch(e) {}
    }
    recent.sort((a,b) => b.date.localeCompare(a.date));
    recent = recent.slice(0,5);
    if(!recent.length) { la.innerHTML='<p style="color:var(--tx2);font-size:12px">Sin mediciones recientes.</p>'; return; }
    la.innerHTML = recent.map(m => {
      const mx = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--br2)">
        <span style="font-size:14px">${m.severity==='critico'?'🔴':m.severity==='alerta'?'🟡':'🟢'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.machine_name} › ${m.comp_name}</div>
          <div style="font-size:10px;color:var(--tx2)">${m.date} · <span style="color:var(--ac)">${mx.toFixed(2)} mm/s</span> · ${m.zone_icon||''} ${m.zone_name}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    const la = document.getElementById('last-activity-list');
    if(la) la.innerHTML='<p style="color:var(--tx2);font-size:12px">—</p>';
  }
}

// ── ALERT LIST VIEW ───────────────────────────────────────────────────────────
async function showAlertList(severity) {
  // Make sure we're on the dashboard view so alrt-sec is visible
  const currentView = document.querySelector('.view.active')?.id;
  if(currentView !== 'v-zones') {
    await goZones(true);
    // Small delay to let the view render
    await new Promise(r => setTimeout(r, 100));
  }

  const sec = document.getElementById('alrt-sec');
  const list = document.getElementById('alrt-list');

  // Always show, never collapse on re-click
  sec._currentFilter = severity;

  const all = await API.get('/measurements/alerts');
  const filtered = severity === 'all' ? all : all.filter(m => m.severity === severity);
  const title = severity === 'critico' ? '🔴 Mediciones Críticas' : severity === 'alerta' ? '⚠️ Mediciones en Alerta' : '📋 Todas las Alertas';
  const color = severity === 'critico' ? 'var(--rd)' : 'var(--yw)';

  sec.style.display = 'block';
  list.style.display = 'block';

  if(!filtered.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--tx2)">
      <div style="font-size:32px;margin-bottom:8px">✅</div>
      <p>No hay mediciones en este estado.</p>
    </div>`;
  } else {
    list.innerHTML = `<div style="font-family:var(--mono);font-size:10px;color:${color};letter-spacing:2px;margin-bottom:10px">${title} (${filtered.length})</div>` +
    filtered.map(m => {
      const mx = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
      return `<div class="hr" onclick="openMeasFromZone('${m.id}','${m.machine_id}','${m.component_id}')">
        <span style="font-size:18px">${m.severity==='critico'?'🔴':'🟡'}</span>
        <div style="flex:1">
          <div style="font-size:12px"><b>${m.machine_name}</b> › ${m.comp_name} — max <b style="color:var(--ac)">${mx.toFixed(2)} mm/s</b></div>
          <div style="font-size:10px;color:var(--tx2)">${m.zone_icon||'📍'} ${m.zone_name} · ${m.fault_type||'Sin clasificar'} · ${m.date}</div>
        </div>
        ${m.severity==='critico'?'<span class="badge bc">Crítico</span>':'<span class="badge ba">Alerta</span>'}
      </div>`;
    }).join('');
  }
  sec.scrollIntoView({behavior:'smooth'});
}

async function openMeasFromZone(measId, macId, compId) {
  // Find the zone for this machine
  const zones = S.zones;
  for(const z of zones) {
    const machines = await API.get('/zones/'+z.id+'/machines');
    const mac = machines.find(m=>m.id===macId);
    if(mac) {
      S.curZone = z; S.curMachine = mac; S.machines = machines;
      const ms = await API.get('/components/'+compId+'/measurements');
      S.measurements = ms; S.curComp = mac.components?.find(c=>c.id===compId);
      const m = ms.find(x=>x.id===measId);
      if(m) { S.curMeas = m; renderMeasDetail(measId); }
      return;
    }
  }
}

// ── BULK IMPORT (MULTI-FOLDER WITH VISUAL ASSIGNMENT) ────────────────────────
const COMP_OPTIONS = [
  '— Saltar —',
  'Motor libre','Motor acoplado',
  'Reductor entrada','Reductor salida',
  'Rodamiento acoplado','Rodamiento libre',
  'Rodamiento cola 01','Rodamiento cola 02',
  'Chumacera intermedia','Acoplamiento','Ventilador','Bomba','Compresor'
];

let biFolders = [];       // [{folderName, files:[]}]
let biCurrentIdx = 0;     // current machine index
let biConfirmed = [];     // [{folderName, machineName, pairs:[{valImg,specImg,compName,date}]}]
let biZoneId = '';

function openBulkImport() {
  resetBulk();
  const zSel = document.getElementById('bi-zone');
  zSel.innerHTML = '<option value="">— Seleccionar zona —</option>' +
    S.zones.map(z => `<option value="${z.id}">${z.name}</option>`).join('');
  document.getElementById('bi-step1').style.display = 'block';
  document.getElementById('bi-step2').style.display = 'none';
  document.getElementById('bi-step3').style.display = 'none';
  document.getElementById('bi-progress').style.display = 'none';
  document.getElementById('bi-start').style.display = 'none';
  openModal('mbulk');
}

function resetBulk() {
  biFolders = []; biCurrentIdx = 0; biConfirmed = []; biZoneId = '';
  const bar = document.getElementById('bi-bar');
  if(bar) bar.style.width = '0%';
}

function handleFolderSelect(evt) {
  biZoneId = document.getElementById('bi-zone').value;
  if(!biZoneId) { toast('Selecciona la zona primero','err'); evt.target.value=''; return; }

  const files = Array.from(evt.target.files);
  if(!files.length) return;

  // Group by immediate subfolder
  const folders = {};
  files.forEach(f => {
    const parts = f.webkitRelativePath.split('/');
    const key = parts.length >= 3 ? parts[1] : parts[0];
    if(!folders[key]) folders[key] = [];
    if(f.type.startsWith('image/')) folders[key].push(f);
  });

  biFolders = Object.entries(folders)
    .map(([name, fls]) => ({ folderName: name, files: fls.sort((a,b) => a.name.localeCompare(b.name)) }))
    .filter(f => f.files.length >= 1);

  if(!biFolders.length) { toast('No se encontraron imágenes en las subcarpetas','err'); return; }

  biCurrentIdx = 0;
  document.getElementById('bi-step1').style.display = 'none';
  document.getElementById('bi-step2').style.display = 'block';
  renderBiCurrentMachine();
  evt.target.value = '';
}

function renderBiCurrentMachine() {
  const fd = biFolders[biCurrentIdx];
  if(!fd) return;

  document.getElementById('bi-machine-title').innerHTML =
    `🔧 <b>${fd.folderName}</b> <span style="font-size:12px;color:var(--tx2)">(${fd.files.length} imágenes · ${Math.ceil(fd.files.length/2)} pares)</span>`;
  document.getElementById('bi-mac-counter').textContent = `${biCurrentIdx+1}/${biFolders.length}`;
  document.getElementById('bi-prev').disabled = biCurrentIdx === 0;
  document.getElementById('bi-next').disabled = biCurrentIdx === biFolders.length - 1;

  // Auto-assign components in order (skipping if already confirmed)
  const existing = biConfirmed.find(c => c.folderName === fd.folderName);
  const files = fd.files;
  const pairs = [];
  for(let i=0; i<files.length; i+=2) {
    pairs.push({ valImg: files[i], specImg: files[i+1]||null });
  }

  // Default component order
  const defaultComps = [
    'Motor libre','Motor acoplado',
    'Reductor entrada','Reductor salida',
    'Rodamiento acoplado','Rodamiento libre',
    'Rodamiento cola 01','Rodamiento cola 02'
  ];

  const container = document.getElementById('bi-pairs-container');
  container.innerHTML = pairs.map((pair, i) => {
    const previewUrl = URL.createObjectURL(pair.valImg);
    const specUrl = pair.specImg ? URL.createObjectURL(pair.specImg) : null;
    const dateMatch = pair.valImg.name.match(/(\d{4})(\d{2})(\d{2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toISOString().slice(0,10);
    const defaultComp = existing?.pairs?.[i]?.compName || defaultComps[i] || '— Saltar —';

    return `<div style="display:grid;grid-template-columns:80px 80px 1fr;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--br2);border-radius:6px;margin-bottom:4px;background:var(--s2)" id="bi-pair-row-${i}">
      <div>
        <img src="${previewUrl}" style="width:76px;height:56px;object-fit:cover;border-radius:4px;border:1px solid var(--br);cursor:pointer" onclick="openLB('${previewUrl}')"/>
        <div style="font-size:9px;color:var(--tx2);margin-top:2px;text-align:center">${date}</div>
      </div>
      <div>
        ${specUrl ? `<img src="${specUrl}" style="width:76px;height:56px;object-fit:cover;border-radius:4px;border:1px solid var(--br);cursor:pointer" onclick="openLB('${specUrl}')"/>` 
          : `<div style="width:76px;height:56px;border-radius:4px;border:1px dashed var(--br);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--tx3)">Sin espectro</div>`}
        <div style="font-size:9px;color:var(--tx2);margin-top:2px;text-align:center">Par ${i+1}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--tx2);margin-bottom:4px;font-family:var(--mono)">COMPONENTE</div>
        <select id="bi-comp-${i}" style="background:var(--bg);border:1px solid var(--br);border-radius:6px;padding:6px 8px;color:var(--tx);font-size:12px;width:100%">
          ${COMP_OPTIONS.map(c => `<option value="${c}" ${c===defaultComp?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }).join('');
}

function biPrevMachine() { if(biCurrentIdx>0){ biCurrentIdx--; renderBiCurrentMachine(); } }
function biNextMachine() { if(biCurrentIdx<biFolders.length-1){ biCurrentIdx++; renderBiCurrentMachine(); } }

function biConfirmMachine() {
  const fd = biFolders[biCurrentIdx];
  const files = fd.files;
  const pairs = [];
  for(let i=0; i<files.length; i+=2) {
    const compName = document.getElementById('bi-comp-'+Math.floor(i/2))?.value || '— Saltar —';
    if(compName === '— Saltar —') continue;
    const dateMatch = files[i].name.match(/(\d{4})(\d{2})(\d{2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toISOString().slice(0,10);
    pairs.push({ valImg: files[i], specImg: files[i+1]||null, compName, date });
  }

  // Remove existing entry and add new
  biConfirmed = biConfirmed.filter(c => c.folderName !== fd.folderName);
  if(pairs.length > 0) biConfirmed.push({ folderName: fd.folderName, pairs });

  toast(`✓ ${fd.folderName} confirmada (${pairs.length} mediciones)`, 'ok');

  // Go to next or show summary
  if(biCurrentIdx < biFolders.length-1) {
    biCurrentIdx++;
    renderBiCurrentMachine();
  } else {
    showBiSummary();
  }
}

function biSkipMachine() {
  biConfirmed = biConfirmed.filter(c => c.folderName !== biFolders[biCurrentIdx].folderName);
  if(biCurrentIdx < biFolders.length-1) { biCurrentIdx++; renderBiCurrentMachine(); }
  else showBiSummary();
}

function updateModeUI() {
  const mode = document.querySelector('input[name="bi-mode"]:checked')?.value || 'fast';
  const totalMeas = biConfirmed.reduce((a,m) => a+m.pairs.length, 0);
  const est = mode==='fast' ? Math.ceil(totalMeas*0.5) : mode==='parallel' ? Math.ceil(totalMeas*2) : Math.ceil(totalMeas*5);
  const estStr = est < 60 ? `~${est}s` : `~${Math.ceil(est/60)} min`;
  const el = document.getElementById('bi-time-estimate');
  if(el) el.textContent = `Tiempo estimado: ${estStr} para ${totalMeas} mediciones`;
  // Highlight selected
  ['fast','parallel','ai'].forEach(m => {
    const lbl = document.getElementById('mode-'+m+'-label');
    if(lbl) lbl.style.borderColor = m===mode ? 'var(--ac)' : 'var(--br)';
  });
}

function showBiSummary() {
  document.getElementById('bi-step2').style.display = 'none';
  document.getElementById('bi-step3').style.display = 'block';
  document.getElementById('bi-start').style.display = '';

  const totalMeas = biConfirmed.reduce((a,m) => a+m.pairs.length, 0);
  document.getElementById('bi-summary-count').textContent =
    `${biConfirmed.length} máquinas · ${totalMeas} mediciones totales`;
  setTimeout(updateModeUI, 50);

  document.getElementById('bi-summary').innerHTML = biConfirmed.map(m => `
    <div style="margin-bottom:10px">
      <div style="font-weight:700;color:#f1f5f9;font-size:13px">🔧 ${m.folderName}</div>
      ${m.pairs.map(p => `<div style="font-size:11px;color:var(--tx2);padding-left:16px">
        · ${p.compName} — ${p.date}
      </div>`).join('')}
    </div>`).join('');
}

async function startMultiFolderImport() {
  if(!biConfirmed.length) { toast('No hay máquinas confirmadas','err'); return; }
  const mode = document.querySelector('input[name="bi-mode"]:checked')?.value || 'fast';
  document.getElementById('bi-start').style.display = 'none';
  document.getElementById('bi-step3').style.display = 'none';
  document.getElementById('bi-progress').style.display = 'block';

  const bar = document.getElementById('bi-bar');
  const status = document.getElementById('bi-status');
  const log = document.getElementById('bi-log');
  log.innerHTML = '';
  const addLog = (msg, col='var(--tx2)') => { log.innerHTML += `<div style="color:${col}">${msg}</div>`; log.scrollTop=log.scrollHeight; };

  let zoneMachines = await API.get('/zones/'+biZoneId+'/machines');
  let totalMeas=0, totalMacCreated=0;
  const totalPairs = biConfirmed.reduce((a,m)=>a+m.pairs.length,0);
  let done=0;

  for(const macData of biConfirmed) {
    addLog(`\n📁 ${macData.folderName}`);

    // Find or create machine
    let mac = zoneMachines.find(m =>
      m.name.toLowerCase() === macData.folderName.toLowerCase() ||
      m.name.toLowerCase().replace(/[\s-]/g,'') === macData.folderName.toLowerCase().replace(/[\s-]/g,'')
    );

    if(!mac) {
      // Get unique component names from this machine's pairs
      const uniqueComps = [...new Set(macData.pairs.map(p=>p.compName))];
      // Add all standard components
      const allComps = [...new Set([...COMP_OPTIONS.slice(1), ...uniqueComps])].map(n=>({name:n}));
      try {
        mac = await API.post('/zones/'+biZoneId+'/machines', { name: macData.folderName, components: allComps });
        zoneMachines.push(mac);
        totalMacCreated++;
        addLog(`  ✅ Máquina creada`, 'var(--gr)');
      } catch(e) { addLog(`  ❌ Error: ${e.message}`, 'var(--rd)'); continue; }
    } else {
      addLog(`  🔍 Encontrada: ${mac.name}`);
    }

    // Process pairs based on mode
    const pairsToProcess = macData.pairs;

    if(mode === 'parallel') {
      // Process in batches of 3 simultaneously
      const batchSize = 3;
      for(let b=0; b<pairsToProcess.length; b+=batchSize) {
        const batch = pairsToProcess.slice(b, b+batchSize);
        status.textContent = `${macData.folderName} — lote ${Math.floor(b/batchSize)+1} (${Math.min(b+batchSize,pairsToProcess.length)}/${pairsToProcess.length})`;
        await Promise.all(batch.map(async pair => {
          try {
            const toB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(f);});
            const imgs = [await toB64(pair.valImg)];
            if(pair.specImg) imgs.push(await toB64(pair.specImg));
            let vx='',vy='',vz='',temp='',severity='normal',fault='',aiResult='';
            try {
              const aiRes = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API._token},
                body:JSON.stringify({images:imgs,machineName:mac.name,compName:pair.compName})});
              const ai = await aiRes.json();
              if(!ai.error) {
                if(ai.vxDetectado&&ai.vxDetectado!=='null') vx=parseFloat(ai.vxDetectado).toFixed(2);
                if(ai.vyDetectado&&ai.vyDetectado!=='null') vy=parseFloat(ai.vyDetectado).toFixed(2);
                if(ai.vzDetectado&&ai.vzDetectado!=='null') vz=parseFloat(ai.vzDetectado).toFixed(2);
                if(ai.temperaturaDetectada&&ai.temperaturaDetectada!=='null') temp=parseFloat(ai.temperaturaDetectada).toFixed(1);
                if(ai.severidadSugerida) severity=ai.severidadSugerida;
                if(ai.tipoFalla) fault=ai.tipoFalla;
                if(ai.diagnostico) aiResult=`Diagnóstico: ${ai.diagnostico}\nFalla: ${ai.tipoFalla}\nSeveridad: ${severity.toUpperCase()}\n\n${ai.explicacion}\n\nAcción: ${ai.accionRecomendada}`;
              }
            } catch(e) {}
            const comp = mac.components?.find(c => c.name === pair.compName);
            if(!comp) return;
            const fd2 = new FormData();
            fd2.append('machine_id',mac.id); fd2.append('date',pair.date);
            fd2.append('vx',vx); fd2.append('vy',vy); fd2.append('vz',vz);
            fd2.append('temperature',temp); fd2.append('severity',severity);
            fd2.append('fault_type',fault); fd2.append('notes','Importación masiva');
            fd2.append('ai_result',aiResult);
            fd2.append('images',pair.valImg);
            if(pair.specImg) fd2.append('images',pair.specImg);
            await API.postForm('/components/'+comp.id+'/measurements', fd2);
            totalMeas++; done++;
            bar.style.width = Math.round((done/totalPairs)*100)+'%';
            const sevIcon = severity==='critico'?'🔴':severity==='alerta'?'🟡':'🟢';
            addLog(`  ${sevIcon} ${pair.compName} ${pair.date} X:${vx||'—'} Y:${vy||'—'} Z:${vz||'—'}`, 'var(--gr)');
          } catch(e) { done++; addLog(`  ❌ ${pair.compName}: ${e.message}`, 'var(--rd)'); }
        }));
      }
      continue; // skip the sequential loop below
    }

    // Sequential mode (fast or ai)
    for(const pair of pairsToProcess) {
      done++;
      bar.style.width = Math.round((done/totalPairs)*100)+'%';
      status.textContent = `${macData.folderName} › ${pair.compName} (${done}/${totalPairs})`;

      // Find component
      const comp = mac.components?.find(c => c.name === pair.compName);
      if(!comp) { addLog(`  ⚠️ Componente no encontrado: ${pair.compName}`, 'var(--yw)'); continue; }

      try {
        // Convert to base64
        const toB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(f);});
        const imgs = [await toB64(pair.valImg)];
        if(pair.specImg) imgs.push(await toB64(pair.specImg));

        // AI analysis based on mode
        let vx='',vy='',vz='',temp='',severity='normal',fault='',aiResult='';

        const runAI = async () => {
          try {
            const aiRes = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API._token},
              body:JSON.stringify({images:imgs,machineName:mac.name,compName:pair.compName})});
            const ai = await aiRes.json();
            if(!ai.error) {
              if(ai.vxDetectado&&ai.vxDetectado!=='null') vx=parseFloat(ai.vxDetectado).toFixed(2);
              if(ai.vyDetectado&&ai.vyDetectado!=='null') vy=parseFloat(ai.vyDetectado).toFixed(2);
              if(ai.vzDetectado&&ai.vzDetectado!=='null') vz=parseFloat(ai.vzDetectado).toFixed(2);
              if(ai.temperaturaDetectada&&ai.temperaturaDetectada!=='null') temp=parseFloat(ai.temperaturaDetectada).toFixed(1);
              if(ai.severidadSugerida) severity=ai.severidadSugerida;
              if(ai.tipoFalla) fault=ai.tipoFalla;
              if(ai.diagnostico) aiResult=`Diagnóstico: ${ai.diagnostico}\nFalla: ${ai.tipoFalla}\nSeveridad: ${severity.toUpperCase()}\n\n${ai.explicacion}\n\nAcción: ${ai.accionRecomendada}`;
            }
          } catch(e) {}
        };

        if(mode === 'ai') { await runAI(); }
        // 'fast' mode: skip AI entirely
        // 'parallel' handled outside this loop

        const fd2 = new FormData();
        fd2.append('machine_id',mac.id);
        fd2.append('date',pair.date);
        fd2.append('vx',vx);fd2.append('vy',vy);fd2.append('vz',vz);
        fd2.append('temperature',temp);
        fd2.append('severity',severity);
        fd2.append('fault_type',fault);
        fd2.append('notes','Importación masiva');
        fd2.append('ai_result',aiResult);
        fd2.append('images',pair.valImg);
        if(pair.specImg) fd2.append('images',pair.specImg);

        await API.postForm('/components/'+comp.id+'/measurements', fd2);
        totalMeas++;
        const sevIcon = severity==='critico'?'🔴':severity==='alerta'?'🟡':'🟢';
        addLog(`  ${sevIcon} ${pair.compName} ${pair.date} X:${vx||'—'} Y:${vy||'—'} Z:${vz||'—'}`, 'var(--gr)');
      } catch(e) {
        addLog(`  ❌ ${pair.compName}: ${e.message}`, 'var(--rd)');
      }
    }
  }

  bar.style.width = '100%';
  // Change title to FINALIZADO
  const progTitle = document.getElementById('bi-prog-title');
  if(progTitle) { progTitle.textContent = '✅ IMPORTACIÓN FINALIZADA'; progTitle.style.color = 'var(--gr)'; }
  status.textContent = `${totalMacCreated} máquinas creadas · ${totalMeas} mediciones guardadas`;
  addLog(`\n🎉 FINALIZADO: ${totalMacCreated} máquinas nuevas · ${totalMeas} mediciones`, 'var(--ac)');
  toast(`✅ ${totalMeas} mediciones importadas`, 'ok', 6000);
  document.getElementById('bi-start').style.display = '';
  goZones();
}


// ── ANALYZE ALL MEASUREMENTS ──────────────────────────────────────────────────
async function analyzeAllMeasurements(cid) {
  const ms = S.measurements.filter(m => !m.ai_result);
  if(!ms.length) { toast('Todas las mediciones ya tienen análisis IA', 'info'); return; }
  if(!confirm(`¿Analizar ${ms.length} mediciones sin análisis IA?\nEsto puede tardar ${ms.length*4} segundos aproximadamente.`)) return;

  const prog = document.getElementById('analyze-all-prog-'+cid);
  const bar = document.getElementById('analyze-all-bar-'+cid);
  const status = document.getElementById('analyze-all-status-'+cid);
  const btn = document.getElementById('analyze-all-btn-'+cid);

  prog.style.display = 'block';
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Analizando...';

  let done=0;
  for(const m of ms) {
    bar.style.width = Math.round((done/ms.length)*100)+'%';
    status.textContent = `Analizando ${done+1}/${ms.length}...`;

    try {
      // Get images for this measurement
      const imgs = (m.images||[]).filter(i=>i);
      if(!imgs.length) { done++; continue; }

      // Fetch images and convert to base64
      const toB64fromUrl = async url => {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsDataURL(blob);
        });
      };

      const b64imgs = await Promise.all(imgs.slice(0,2).map(toB64fromUrl));
      const comp = S.curMachine?.components?.find(c=>c.id===m.component_id);

      const aiRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+API._token },
        body: JSON.stringify({
          images: b64imgs,
          machineName: S.curMachine?.name,
          compName: comp?.name
        })
      });
      const ai = await aiRes.json();
      if(ai.error) throw new Error(ai.error);

      const aiResult = `Diagnóstico: ${ai.diagnostico}\nFalla: ${ai.tipoFalla}\nSeveridad: ${(ai.severidadSugerida||'').toUpperCase()}\n\n${ai.explicacion}\n\nAcción recomendada: ${ai.accionRecomendada}`;

      // Update measurement with AI result
      await API.put('/measurements/'+m.id, {
        date: m.date, point: m.point||'',
        vx: ai.vxDetectado&&ai.vxDetectado!=='null' ? parseFloat(ai.vxDetectado).toFixed(2) : m.vx||'',
        vy: ai.vyDetectado&&ai.vyDetectado!=='null' ? parseFloat(ai.vyDetectado).toFixed(2) : m.vy||'',
        vz: ai.vzDetectado&&ai.vzDetectado!=='null' ? parseFloat(ai.vzDetectado).toFixed(2) : m.vz||'',
        temperature: m.temperature||'',
        severity: ai.severidadSugerida||m.severity,
        fault_type: ai.tipoFalla||m.fault_type||'',
        notes: m.notes||'',
        ai_result: aiResult
      });
      done++;
    } catch(e) { done++; console.error('AI error for measurement '+m.id, e); }
  }

  bar.style.width = '100%';
  status.textContent = `✅ ${done} mediciones analizadas`;
  btn.disabled = false;
  btn.innerHTML = '🤖 Analizar todas';

  // Refresh
  S.measurements = await API.get('/components/'+cid+'/measurements');
  renderHistory(cid);
  renderCompCharts(cid);
  updateMacKPIs();
  toast(`✅ ${done} mediciones analizadas con IA`, 'ok', 4000);
}

// ── EDIT MEASUREMENT ──────────────────────────────────────────────────────────
function openEditMeas() {
  const m = S.curMeas; if(!m) return;
  document.getElementById('em-date').value = m.date || '';
  document.getElementById('em-point').value = m.point || '';
  document.getElementById('em-vx').value = m.vx || '';
  document.getElementById('em-vy').value = m.vy || '';
  document.getElementById('em-vz').value = m.vz || '';
  document.getElementById('em-temp').value = m.temperature || '';
  document.getElementById('em-severity').value = m.severity || 'normal';
  document.getElementById('em-fault').value = m.fault_type || '';
  document.getElementById('em-notes').value = m.notes || '';
  openModal('medit');
}
async function saveEditMeas() {
  const m = S.curMeas; if(!m) return;
  const body = {
    date: document.getElementById('em-date').value,
    point: document.getElementById('em-point').value,
    vx: document.getElementById('em-vx').value,
    vy: document.getElementById('em-vy').value,
    vz: document.getElementById('em-vz').value,
    temperature: document.getElementById('em-temp').value,
    severity: document.getElementById('em-severity').value,
    fault_type: document.getElementById('em-fault').value,
    notes: document.getElementById('em-notes').value,
    ai_result: m.ai_result || ''  // ALWAYS preserve existing AI analysis
  };
  try {
    await API.put('/measurements/' + m.id, body);
    closeModal('medit');
    toast('✓ Medición actualizada', 'ok');
    // Refresh measurements and re-render detail
    if(S.curComp) S.measurements = await API.get('/components/' + S.curComp.id + '/measurements');
    const updated = S.measurements.find(x => x.id === m.id);
    if(updated) { S.curMeas = updated; renderMeasDetail(updated.id); }
  } catch(e) { toast(e.message, 'err'); }
}
// ── AI ANALYSIS ───────────────────────────────────────────────────────────────
async function analyzeAI(cid) {
  if(!S.newImgs.length){toast('Sube al menos una imagen','err');return;}
  const mac=S.curMachine, comp=mac?.components?.find(c=>c.id===cid);
  const btn=document.getElementById('ai-btn-'+cid);
  btn.innerHTML='<span class="spin"></span> Analizando...'; btn.disabled=true;
  document.getElementById('ai-res-'+cid).style.display='none';
  try {
    const res=await fetch('/api/analyze',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+API._token},
      body:JSON.stringify({
        images:S.newImgs.map(i=>i.dataUrl),
        machineName:mac?.name, machineType:mac?.type, machineRpm:mac?.rpm, compName:comp?.name
      })});
    const r=await res.json(); if(r.error)throw new Error(r.error);
    if(r.vxDetectado&&r.vxDetectado!=='null')document.getElementById('vx-'+cid).value=parseFloat(r.vxDetectado).toFixed(2);
    if(r.vyDetectado&&r.vyDetectado!=='null')document.getElementById('vy-'+cid).value=parseFloat(r.vyDetectado).toFixed(2);
    if(r.vzDetectado&&r.vzDetectado!=='null')document.getElementById('vz-'+cid).value=parseFloat(r.vzDetectado).toFixed(2);
    if(r.temperaturaDetectada&&r.temperaturaDetectada!=='null'){const mt=String(r.temperaturaDetectada).match(/([\d.]+)/);if(mt)document.getElementById('ft-'+cid).value=mt[1];}
    if(r.tipoFalla)document.getElementById('ff-'+cid).value=r.tipoFalla;
    if(r.severidadSugerida)document.getElementById('fs-'+cid).value=r.severidadSugerida;
    const sc=r.severidadSugerida==='critico'?'var(--rd)':r.severidadSugerida==='alerta'?'var(--yw)':'var(--gr)';
    document.getElementById('ai-res-'+cid).innerHTML=`<div class="aibox">
      <div class="ait">🤖 ANÁLISIS IA — ${(comp?.name||'').toUpperCase()}</div>
      <div style="font-family:var(--mono);font-size:12px;margin-bottom:8px">
        <span style="color:var(--vx)">X:${r.vxDetectado||'—'}</span> · <span style="color:var(--vy)">Y:${r.vyDetectado||'—'}</span> · <span style="color:var(--vz)">Z:${r.vzDetectado||'—'}</span> mm/s
      </div>
      ${r.frecuenciaDominante?`<div style="font-size:12px;margin-bottom:4px"><span style="color:var(--tx2)">Frec. dominante: </span><b style="color:var(--ac)">${r.frecuenciaDominante}</b></div>`:''}
      ${r.armonicosDetectados?.length?`<div style="font-size:12px;margin-bottom:8px"><span style="color:var(--tx2)">Armónicos: </span><b style="color:var(--ac)">${r.armonicosDetectados.join(', ')}</b></div>`:''}
      <div style="font-size:12px;margin-bottom:4px"><b>${r.diagnostico}</b></div>
      <div style="font-size:12px;margin-bottom:4px"><span style="color:var(--tx2)">Falla: </span><b style="color:var(--ac)">${r.tipoFalla}</b></div>
      <div style="font-size:12px;margin-bottom:9px"><span style="color:var(--tx2)">Severidad: </span><b style="color:${sc}">${(r.severidadSugerida||'').toUpperCase()}</b></div>
      <div style="font-size:11px;color:var(--tx2);line-height:1.6;padding:9px;background:rgba(0,0,0,.2);border-radius:6px;margin-bottom:8px">${r.explicacion}</div>
      <div style="font-size:11px;color:var(--ac);padding:8px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.15);border-radius:6px">💡 ${r.accionRecomendada}</div>
    </div>`;
    document.getElementById('ai-res-'+cid).style.display='block';
    // Store AI result text for saving with measurement
    window['_aiResult_'+cid] = `Diagnóstico: ${r.diagnostico}\nFalla: ${r.tipoFalla}\nSeveridad: ${(r.severidadSugerida||'').toUpperCase()}\nArmónicos: ${(r.armonicosDetectados||[]).join(', ')||'—'}\nFrecuencia dominante: ${r.frecuenciaDominante||'—'}\n\n${r.explicacion}\n\nAcción recomendada: ${r.accionRecomendada}`;
    toast('✓ Análisis completado');
  }catch(e){
    document.getElementById('ai-res-'+cid).innerHTML=`<div class="aibox" style="border-color:rgba(255,51,85,.3)"><div style="color:var(--rd);font-size:12px">✕ ${e.message}</div></div>`;
    document.getElementById('ai-res-'+cid).style.display='block'; toast('Error IA','err');
  }finally{btn.innerHTML='🤖 Analizar con IA';btn.disabled=false;}
}

// ── LIGHTBOX ──────────────────────────────────────────────────────────────────
function openLB(src){document.getElementById('lb-img').src=src;openModal('mlb');}

// ── INIT ──────────────────────────────────────────────────────────────────────

// ── THEME TOGGLE ──────────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('vibmon_theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('btn-theme');
  if(btn) btn.textContent = isLight ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem('vibmon_theme');
  if(saved === 'light') {
    document.body.classList.add('light');
    const btn = document.getElementById('btn-theme');
    if(btn) btn.textContent = '☀️';
  }
}

document.addEventListener('DOMContentLoaded', () => { initTheme(); APP.init(); });
