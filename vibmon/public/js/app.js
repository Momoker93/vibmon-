// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const PREDEF_COMPS = [
  'Motor DE','Motor NDE',
  'Reductor entrada','Reductor salida',
  'Rodamiento tambor cabeza','Rodamiento tambor cola','Rodamiento tambor tensor',
  'Rodamiento DE','Rodamiento NDE',
  'Chumacera intermedia','Acoplamiento','Ventilador','Bomba','Compresor'
];
const SEV = {
  normal:  { l:'Normal',  c:'var(--gr)', cls:'bn' },
  alerta:  { l:'Alerta',  c:'var(--yw)', cls:'ba' },
  critico: { l:'Crítico', c:'var(--rd)', cls:'bc' }
};
const ISO_ALERT = 2.3, ISO_CRIT = 4.5;

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
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0); updateBC(id);
}
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
    document.getElementById('loading').style.display = 'flex';
    const token = localStorage.getItem('vibmon_token');
    if(token) {
      API._token = token;
      try {
        const d = await API.get('/auth/me');
        S.user = d.user; this.showApp();
      } catch { this.showLogin(); }
    } else { this.showLogin(); }
    document.getElementById('loading').style.display = 'none';
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
    ['btn-exp','btn-imp','btn-cfg'].forEach(id => {
      const e = document.getElementById(id); if(e) e.style.display = isAdmin() ? '' : 'none';
    });
    goZones();
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
async function goZones() {
  showView('v-zones');
  try {
    const d = await API.get('/zones');
    S.zones = d.zones;
    renderZones(d.zones, d.stats);
  } catch(e) { toast(e.message,'err'); }
}
function renderZones(zones, stats) {
  document.getElementById('gkpis').innerHTML = `
    <div class="card kpi"><div class="kpin">${stats?.zone_count||0}</div><div class="kpil">Zonas</div></div>
    <div class="card kpi" style="border-color:${stats?.critico_count?'rgba(255,51,85,.25)':'var(--br)'}">
      <div class="kpin" style="color:${stats?.critico_count?'var(--rd)':'var(--ac)'}">${stats?.critico_count||0}</div><div class="kpil">Críticas</div></div>
    <div class="card kpi" style="border-color:${stats?.alerta_count?'rgba(255,204,0,.25)':'var(--br)'}">
      <div class="kpin" style="color:${stats?.alerta_count?'var(--yw)':'var(--ac)'}">${stats?.alerta_count||0}</div><div class="kpil">En alerta</div></div>`;

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
}
async function loadAlerts() {
  try {
    const alerts = await API.get('/measurements/alerts');
    const sec = document.getElementById('alrt-sec');
    if(!alerts.length) { sec.style.display='none'; return; }
    sec.style.display = 'block';
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
  // Navigate to measurement detail directly
  const mac = DB_machines[macId] || await loadMachineById(macId);
  S.curMachine = mac;
  await renderMeasDetail(measId);
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

async function goZone(zoneId) {
  const zone = S.zones.find(z=>z.id===zoneId) || S.curZone;
  if(zoneId) S.curZone = S.zones.find(z=>z.id===zoneId) || { id: zoneId };
  showView('v-zone');
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
    const ms_count = mac.measurement_count||0;
    return `<div class="mcard" onclick="goMachineById('${mac.id}')">
      <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:5px">${mac.name}</div>
      <div class="row" style="margin-bottom:7px">
        ${mac.type?`<span class="tag">${mac.type}</span>`:''}
        ${mac.rpm?`<span class="tag">⚙ ${mac.rpm} RPM</span>`:''}
      </div>
      <div style="font-size:10px;color:var(--tx3);margin-bottom:6px">${mac.components?.length||0} componente${(mac.components?.length||0)!==1?'s':''}</div>
    </div>`;
  }).join('');
}

// Machine CRUD
function openAddMachine() {
  S.editMac = null; S.selPredef = []; S.customComps = [];
  document.getElementById('mmac-title').childNodes[0].textContent = '+ NUEVA MÁQUINA ';
  ['mn','mr','mno'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('mt').value='';
  document.getElementById('mc-inp').value=''; document.getElementById('mc-tags').innerHTML='';
  document.getElementById('mdel').style.display='none';
  renderPredefChips(); openModal('mmac');
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
  renderPredefChips(); renderCustomTags(); openModal('mmac');
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
  const body = { name, type: document.getElementById('mt').value, rpm: document.getElementById('mr').value||null, notes: document.getElementById('mno').value.trim(), components: comps };
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
async function goMachineById(id) {
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
  renderCompTabs();
  showView('v-machine');
  if(S.curMachine.components?.length) activateComp(S.curMachine.components[0].id);
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
  document.getElementById('comp-tabs').innerHTML = mac.components.map(c =>
    `<div class="ctab" id="tab-${c.id}" onclick="activateComp('${c.id}')">${c.name}</div>`).join('');
  document.getElementById('comp-panels').innerHTML = mac.components.map(c => buildPanel(c, mac)).join('');
}
function buildPanel(c, mac) {
  return `<div class="cpanel" id="panel-${c.id}">
    <div style="font-family:var(--mono);font-size:11px;color:var(--ac);letter-spacing:1px;margin-bottom:12px">🔩 ${c.name.toUpperCase()}</div>
    <div class="card">
      <div class="card-title">📈 Vibración X/Y/Z — Tendencia (mm/s ISO)</div>
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
      <div class="card-title">🌡 Temperatura — Tendencia</div>
      <canvas id="tc-${c.id}" height="80" style="display:none"></canvas>
      <div id="te-${c.id}" style="text-align:center;color:var(--tx2);font-size:11px;padding:18px">Sin datos de temperatura suficientes (≥2)</div>
    </div>
    ${isAdmin() ? `
    <div class="card" id="addm-${c.id}" style="display:none">
      <div class="card-title">+ Nueva medición — ${c.name}</div>
      <div class="g2">
        <div><label class="lbl">Fecha *</label><input type="date" id="fd-${c.id}"/></div>
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
      <div class="card-title">📋 Historial <span id="hcount-${c.id}" style="font-weight:400;color:var(--tx2)"></span></div>
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
    renderCompCharts(cid);
    renderHistory(cid);
    updateMacKPIs();
  } catch(e) { toast(e.message,'err'); }
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
  fd.append('date', document.getElementById('fd-'+cid).value);
  fd.append('point', document.getElementById('fp-'+cid).value);
  fd.append('vx', vx||''); fd.append('vy', vy||''); fd.append('vz', vz||'');
  fd.append('temperature', document.getElementById('ft-'+cid).value||'');
  fd.append('severity', document.getElementById('fs-'+cid).value);
  fd.append('fault_type', document.getElementById('ff-'+cid).value);
  fd.append('notes', document.getElementById('fn-'+cid).value);
  S.newImgs.forEach(img => fd.append('images', img.file));
  try {
    const saved = await API.postForm('/components/'+cid+'/measurements', fd);
    S.measurements = await API.get('/components/'+cid+'/measurements');
    S.newImgs=[]; cancelMeas(cid);
    renderCompCharts(cid); renderHistory(cid); updateMacKPIs();
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
  const s=ms[ms.length-1].severity;
  const tab=document.getElementById('tab-'+cid);
  if(tab)tab.className='ctab active'+(s==='critico'?' tc':s==='alerta'?' ta':'');
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function renderHistory(cid) {
  const ms=[...S.measurements].reverse();
  const el=document.getElementById('hist-'+cid);
  const cnt=document.getElementById('hcount-'+cid);
  if(cnt)cnt.textContent=ms.length?`(${ms.length})`:'';
  if(!ms.length){el.innerHTML='<p style="color:var(--tx2);font-size:12px;padding:8px 0">Sin mediciones aún.</p>';return;}
  el.innerHTML=ms.map(m=>{
    const imgs=m.images||[];
    const thumb=imgs.length?`<img class="hth" src="${imgs[0]}" onclick="event.stopPropagation();openLB('${imgs[0]}')">`:`<div class="hni">📊</div>`;
    return`<div class="hr" onclick="renderMeasDetail('${m.id}')">
      ${thumb}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px">${m.date}${m.point?` · <span style="color:var(--tx2)">${m.point}</span>`:''}</div>
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
  document.getElementById('md-title').textContent = `${S.curMachine?.name||'?'} › ${comp?.name||'?'} — ${m.date}`;
  document.getElementById('back-meas').onclick = () => goMachineById(S.curMachine.id);
  document.getElementById('btn-del-meas').style.display = isAdmin() ? '' : 'none';
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
      ${m.fault_type?`<div style="margin-top:12px"><div style="font-size:10px;color:var(--tx2)">TIPO DE FALLA</div><div style="font-size:14px;margin-top:4px">${m.fault_type}</div></div>`:''}
      ${m.notes?`<div style="margin-top:10px"><div style="font-size:10px;color:var(--tx2)">OBSERVACIONES</div><p style="font-size:13px;color:var(--tx2);margin-top:4px;line-height:1.6">${m.notes}</p></div>`:''}
      ${m.created_by?`<div style="margin-top:10px;font-size:10px;color:var(--tx3)">Registrado por: ${m.created_by} · ${new Date(m.created_at).toLocaleString('es-ES')}</div>`:''}
    </div>${imgHtml}`;
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

// ── AI ANALYSIS ───────────────────────────────────────────────────────────────
async function analyzeAI(cid) {
  const claudeKey = prompt('Introduce tu Anthropic API Key (sk-ant-...):\n\nPuedes configurarla permanentemente en ⚙ Config del servidor.');
  if(!claudeKey) return;
  if(!S.newImgs.length){toast('Sube al menos una imagen','err');return;}
  const mac=S.curMachine, comp=mac?.components?.find(c=>c.id===cid);
  const btn=document.getElementById('ai-btn-'+cid);
  btn.innerHTML='<span class="spin"></span> Analizando...'; btn.disabled=true;
  document.getElementById('ai-res-'+cid).style.display='none';
  try {
    const imgC=S.newImgs.map(img=>({type:'image',source:{type:'base64',media_type:img.dataUrl.split(';')[0].split(':')[1],data:img.dataUrl.split(',')[1]}}));
    const prompt=`Eres experto en análisis de vibraciones industrial. Analiza las imágenes del componente "${comp?.name||'?'}" de la máquina "${mac?.name||'?'}"${mac?.type?' ('+mac.type+')':''}${mac?.rpm?' a '+mac.rpm+' RPM':''}.
Si hay valores numéricos X/Y/Z en mm/s extráelos. Si hay espectro FFT analiza los picos.
Responde SOLO con JSON sin markdown:
{"vxDetectado":"número o null","vyDetectado":"número o null","vzDetectado":"número o null","temperaturaDetectada":"número °C o null","frecuenciaDominante":"Hz o null","armonicosDetectados":[],"diagnostico":"1 frase","tipoFalla":"Desbalance (dominante 1X)|Desalineación (dominante 2X)|Aflojamiento mecánico (armónicos múltiples)|Falla rodamiento (BPFO/BPFI/BSF)|Falla engranaje (GMF)|Resonancia|Rozamiento (rub, 0.5X)|Problema eléctrico (2×línea)|Normal / Sin falla|No determinado","severidadSugerida":"normal|alerta|critico","explicacion":"2-3 frases","accionRecomendada":"acción concreta"}`;
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':claudeKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:900,messages:[{role:'user',content:[...imgC,{type:'text',text:prompt}]}]})});
    const data=await res.json(); if(data.error)throw new Error(data.error.message);
    const r=JSON.parse(data.content.map(c=>c.text||'').join('').replace(/```json|```/g,'').trim());
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
    document.getElementById('ai-res-'+cid).style.display='block'; toast('✓ Análisis completado');
  }catch(e){
    document.getElementById('ai-res-'+cid).innerHTML=`<div class="aibox" style="border-color:rgba(255,51,85,.3)"><div style="color:var(--rd);font-size:12px">✕ ${e.message}</div></div>`;
    document.getElementById('ai-res-'+cid).style.display='block'; toast('Error IA','err');
  }finally{btn.innerHTML='🤖 Analizar con IA';btn.disabled=false;}
}

// ── LIGHTBOX ──────────────────────────────────────────────────────────────────
function openLB(src){document.getElementById('lb-img').src=src;openModal('mlb');}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => APP.init());
