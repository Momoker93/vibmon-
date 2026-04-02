const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { Q } = require('../database');
const { signToken, requireAuth, requireAdmin, optionalAuth } = require('../middleware/auth');
const { upload, deleteImage } = require('../cloudinary');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function imgUrl(f) { if (!f) return ''; return f.startsWith('http') ? f : '/uploads/' + f; }

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
    const user = await Q.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/auth/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await Q.getUserByUsername(req.user.username);
    if (!bcrypt.compareSync(currentPassword, user.password_hash))
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'Minimo 4 caracteres' });
    await Q.updateUserPassword(bcrypt.hashSync(newPassword, 12), req.user.username);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ZONES ─────────────────────────────────────────────────────────────────────
router.get('/zones', optionalAuth, async (req, res) => {
  try {
    const zones = await Q.getAllZones();
    const stats = await Q.getGlobalStats();
    res.json({ zones, stats });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/zones', requireAdmin, async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
    const id = uid();
    await Q.insertZone(id, name, description || '', icon || '🏭');
    res.json({ id, name, description, icon });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/zones/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    await Q.updateZone(name, description || '', icon || '🏭', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/zones/:id', requireAdmin, async (req, res) => {
  try {
    await Q.deleteZone(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MACHINES ──────────────────────────────────────────────────────────────────
router.get('/zones/:zoneId/machines', optionalAuth, async (req, res) => {
  try {
    const machines = await Q.getMachinesByZone(req.params.zoneId);
    const result = await Promise.all(machines.map(async function(m) {
      const components = await Q.getComponentsByMachine(m.id);
      return Object.assign({}, m, { components });
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/zones/:zoneId/machines', requireAdmin, async (req, res) => {
  try {
    const { name, type, rpm, notes, components } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
    const id = uid();
    await Q.insertMachine(id, req.params.zoneId, name, type || '', rpm || null, notes || '');
    const comps = [];
    if (components && components.length) {
      for (let i = 0; i < components.length; i++) {
        const c = components[i];
        const cid = c.id || uid();
        await Q.insertComponent(cid, id, c.name, i);
        comps.push({ id: cid, name: c.name, machine_id: id });
      }
    }
    res.json({ id, zone_id: req.params.zoneId, name, type, rpm, notes, components: comps });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/machines/:id', requireAdmin, async (req, res) => {
  try {
    const { name, type, rpm, notes, components } = req.body;
    await Q.updateMachine(name, type || '', rpm || null, notes || '', req.params.id);
    if (components) {
      // SAFE: only add NEW components, never delete existing ones with measurements
      const existing = await Q.getComponentsByMachine(req.params.id);
      const existingNames = existing.map(c => c.name.toLowerCase());
      for (let i = 0; i < components.length; i++) {
        const c = components[i];
        const alreadyExists = existing.find(e =>
          e.id === c.id || e.name.toLowerCase() === c.name.toLowerCase()
        );
        if (!alreadyExists) {
          // Only insert truly new components
          await Q.insertComponent(c.id || uid(), req.params.id, c.name, i);
        } else {
          // Update sort order only
          await require('../database').pool.query(
            'UPDATE components SET sort_order=$1 WHERE id=$2',
            [i, alreadyExists.id]
          );
        }
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/machines/:id', requireAdmin, async (req, res) => {
  try {
    await Q.deleteMachine(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MEASUREMENTS ──────────────────────────────────────────────────────────────
router.get('/components/:compId/measurements', optionalAuth, async (req, res) => {
  try {
    const ms = await Q.getMeasurementsByComponent(req.params.compId);
    res.json(ms.map(function(m) {
      return Object.assign({}, m, {
        images: m.image_files ? m.image_files.split(',').map(imgUrl) : []
      });
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/measurements/alerts', optionalAuth, async (req, res) => {
  try {
    res.json(await Q.getAllRecentAlerts());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/components/:compId/measurements', requireAdmin, upload.array('images', 10), async (req, res) => {
  try {
    const { machine_id, date, point, vx, vy, vz, temperature, severity, fault_type, notes } = req.body;
    if (!machine_id || !date) return res.status(400).json({ error: 'Faltan campos obligatorios' });
    const id = uid();
    const { ai_result } = req.body;
    await Q.insertMeasurement(
      id, machine_id, req.params.compId,
      date, point || '',
      parseFloat(vx) || null, parseFloat(vy) || null, parseFloat(vz) || null,
      parseFloat(temperature) || null,
      severity || 'normal', fault_type || '', notes || '',
      req.user ? req.user.username : 'admin',
      ai_result || ''
    );
    if (req.files && req.files.length) {
      for (const f of req.files) {
        const url = f.path || f.secure_url || f.filename || '';
        await Q.insertImage(id, url, f.originalname || 'imagen', f.mimetype || 'image/jpeg');
      }
    }
    const saved = await Q.getMeasurement(id);
    res.json(Object.assign({}, saved, {
      images: saved.image_files ? saved.image_files.split(',').map(imgUrl) : []
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});


router.put('/measurements/:id', requireAdmin, async (req, res) => {
  try {
    const { date, point, vx, vy, vz, temperature, severity, fault_type, notes, ai_result } = req.body;
    // Get existing ai_result to preserve it if not provided
    const existing = await require('../database').pool.query(
      'SELECT ai_result FROM measurements WHERE id=$1', [req.params.id]
    );
    const existingAI = existing.rows[0]?.ai_result || '';
    // Only update ai_result if explicitly provided with content, otherwise keep existing
    const finalAI = (ai_result && ai_result.trim()) ? ai_result : existingAI;
    await require('../database').pool.query(
      'UPDATE measurements SET date=$1,point=$2,vx=$3,vy=$4,vz=$5,temperature=$6,severity=$7,fault_type=$8,notes=$9,ai_result=$10 WHERE id=$11',
      [date, point||'', parseFloat(vx)||null, parseFloat(vy)||null, parseFloat(vz)||null,
       parseFloat(temperature)||null, severity||'normal', fault_type||'', notes||'', finalAI, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/measurements/:id', requireAdmin, async (req, res) => {
  try {
    const m = await Q.getMeasurement(req.params.id);
    if (!m) return res.status(404).json({ error: 'No encontrada' });
    const imgs = await Q.getImagesByMeasurement(req.params.id);
    for (const img of imgs) {
      if (img.filename && img.filename.indexOf('vibmon/') !== -1) {
        deleteImage('vibmon/' + img.filename.split('/').pop().split('.')[0]).catch(function() {});
      }
    }
    await Q.deleteMeasurement(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PDF SINGLE MEASUREMENT ────────────────────────────────────────────────────
router.get('/measurements/:id/pdf', optionalAuth, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const m = await Q.getMeasurement(req.params.id);
    if (!m) return res.status(404).json({ error: 'No encontrada' });
    const comp = await Q.getComponent(m.component_id);
    const machine = await Q.getMachine(m.machine_id);
    const zone = machine ? await Q.getZone(machine.zone_id) : null;
    const SEVCOL = { normal: '#00aa55', alerta: '#cc8800', critico: '#cc1133' };
    const SEVLBL = { normal: 'Normal', alerta: 'Alerta', critico: 'Critico' };

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="vibmon_' + m.id + '.pdf"');
    doc.pipe(res);

    doc.rect(0, 0, 595, 60).fill('#05080f');
    doc.fontSize(20).fillColor('#00d4ff').font('Helvetica-Bold').text('VIBMON', 50, 18);
    doc.fontSize(10).fillColor('#5a7a9a').font('Helvetica').text('Informe de Medicion', 50, 42);
    doc.fontSize(10).fillColor('#5a7a9a').text('Generado: ' + new Date().toLocaleString('es-ES'), 350, 42);

    var y = 80;
    doc.fontSize(11).fillColor('#888').font('Helvetica')
      .text((zone ? zone.name : '?') + ' > ' + (machine ? machine.name : '?') + ' > ' + (comp ? comp.name : '?'), 50, y);
    y += 24;

    var sev = m.severity || 'normal';
    doc.roundedRect(50, y, 90, 22, 4).fill(SEVCOL[sev] || '#00aa55');
    doc.fontSize(11).fillColor('#fff').font('Helvetica-Bold').text(SEVLBL[sev] || sev, 55, y + 5);
    doc.fontSize(11).fillColor('#333').font('Helvetica').text('Fecha: ' + m.date, 155, y + 5);
    y += 40;

    doc.fontSize(12).fillColor('#05080f').font('Helvetica-Bold').text('Valores de Vibracion (mm/s ISO)', 50, y);
    y += 18;
    var axes = [
      { label: 'X - Horizontal', val: m.vx, col: '#0088bb' },
      { label: 'Y - Vertical',   val: m.vy, col: '#7744cc' },
      { label: 'Z - Axial',      val: m.vz, col: '#00aa55' }
    ];
    axes.forEach(function(ax, i) {
      var bx = 50 + i * 165;
      doc.rect(bx, y, 155, 55).fill('#f5f8ff').stroke('#dde');
      doc.fontSize(9).fillColor(ax.col).font('Helvetica-Bold').text(ax.label, bx + 8, y + 8);
      doc.fontSize(22).fillColor(ax.col).font('Helvetica-Bold')
        .text(ax.val != null ? parseFloat(ax.val).toFixed(2) : '--', bx + 8, y + 20);
      doc.fontSize(9).fillColor('#888').font('Helvetica').text('mm/s', bx + 8, y + 43);
    });
    y += 75;

    var maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
    doc.rect(50, y, 490, 30).fill('#f0f4ff').stroke('#ccd');
    doc.fontSize(10).fillColor('#0055aa').font('Helvetica-Bold').text('Max: ' + maxV.toFixed(2) + ' mm/s', 58, y + 9);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text('ISO 10816: <2.3 Normal · 2.3-4.5 Alerta · >4.5 Critico', 195, y + 9);
    y += 45;

    if (m.fault_type) { doc.fontSize(11).fillColor('#05080f').font('Helvetica-Bold').text('Diagnostico: ' + m.fault_type, 50, y); y += 24; }
    if (m.notes) { doc.fontSize(10).fillColor('#444').font('Helvetica').text('Obs: ' + m.notes, 50, y, { width: 490 }); }
    if (m.temperature) { doc.fontSize(10).fillColor('#cc6600').text('Temperatura: ' + parseFloat(m.temperature).toFixed(1) + ' C', 50, y + 20); }

    doc.end();
  } catch(e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── PDF FULL MACHINE ──────────────────────────────────────────────────────────
router.get('/machines/:id/pdf', optionalAuth, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const machine = await Q.getMachine(req.params.id);
    if (!machine) return res.status(404).json({ error: 'Maquina no encontrada' });
    const zone = await Q.getZone(machine.zone_id);
    const components = await Q.getComponentsByMachine(machine.id);
    const SEVCOL = { normal: '#00aa55', alerta: '#cc8800', critico: '#cc1133' };

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="vibmon_machine_' + machine.id + '.pdf"');
    doc.pipe(res);

    doc.rect(0, 0, 595, 842).fill('#05080f');
    doc.fontSize(32).fillColor('#00d4ff').font('Helvetica-Bold').text('VIBMON', 50, 120);
    doc.fontSize(18).fillColor('#fff').font('Helvetica').text('Informe Completo de Maquina', 50, 165);
    doc.fontSize(24).fillColor('#fff').font('Helvetica-Bold').text(machine.name, 50, 220);
    doc.fontSize(14).fillColor('#5a7a9a').font('Helvetica').text(zone ? zone.name : '', 50, 260);
    if (machine.type) doc.fontSize(12).fillColor('#5a7a9a').text('Tipo: ' + machine.type, 50, 285);
    if (machine.rpm) doc.fontSize(12).fillColor('#5a7a9a').text('RPM: ' + machine.rpm, 50, 305);
    doc.fontSize(11).fillColor('#5a7a9a').text('Generado: ' + new Date().toLocaleString('es-ES'), 50, 340);

    for (const comp of components) {
      doc.addPage();
      const ms = await Q.getMeasurementsByComponent(comp.id);
      doc.rect(0, 0, 595, 50).fill('#0a1020');
      doc.fontSize(14).fillColor('#00d4ff').font('Helvetica-Bold').text(comp.name, 50, 16);
      doc.fontSize(10).fillColor('#5a7a9a').text(machine.name + ' · ' + ms.length + ' mediciones', 50, 35);

      var y = 65;
      if (!ms.length) { doc.fontSize(11).fillColor('#888').text('Sin mediciones.', 50, y); continue; }
      for (const m of ms) {
        if (y > 730) { doc.addPage(); y = 50; }
        var sCol = SEVCOL[m.severity] || '#00aa55';
        var maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
        doc.rect(50, y, 490, 75).fill('#f8faff').stroke('#dde');
        doc.rect(50, y, 4, 75).fill(sCol);
        doc.fontSize(10).fillColor('#333').font('Helvetica-Bold').text(m.date + (m.point ? ' · ' + m.point : ''), 62, y + 8);
        doc.fontSize(11).fillColor('#0055aa').font('Helvetica-Bold').text('X:' + (m.vx != null ? parseFloat(m.vx).toFixed(2) : '--'), 62, y + 25);
        doc.fillColor('#7744cc').text('Y:' + (m.vy != null ? parseFloat(m.vy).toFixed(2) : '--'), 175, y + 25);
        doc.fillColor('#00aa55').text('Z:' + (m.vz != null ? parseFloat(m.vz).toFixed(2) : '--'), 288, y + 25);
        doc.fontSize(9).fillColor('#888').font('Helvetica').text('mm/s  max:' + maxV.toFixed(2), 390, y + 27);
        if (m.fault_type) doc.fontSize(9).fillColor('#444').text(m.fault_type, 62, y + 48, { width: 450 });
        y += 85;
      }
    }
    doc.end();
  } catch(e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});


// ── AI ANALYSIS ───────────────────────────────────────────────────────────────
router.post('/analyze', requireAdmin, async (req, res) => {
  try {
    const { images, machineName, machineType, machineRpm, compName } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'API Key de IA no configurada en el servidor' });
    if (!images || !images.length) return res.status(400).json({ error: 'Sin imágenes para analizar' });

    const imgContents = images.map(function(img) {
      const parts = img.split(',');
      const meta = parts[0]; // data:image/jpeg;base64
      const data = parts[1];
      const mime = meta.split(':')[1].split(';')[0];
      return { type: 'image', source: { type: 'base64', media_type: mime, data: data } };
    });

        const prompt = `Eres un experto en análisis de vibraciones industriales. Tu tarea es ÚNICAMENTE leer los valores numéricos que aparecen en pantalla.

INSTRUCCIONES CRÍTICAS:
- La imagen muestra la pantalla de un analizador de vibraciones (Bearing Defender u similar)
- Los colores de fondo (verde, rojo, amarillo) son indicadores del ANALIZADOR, NO reflejan el estado físico de la máquina
- IGNORA completamente el color de fondo, el estado visual de la máquina o cualquier elemento físico
- SOLO extrae los números que ves en pantalla para X, Y, Z en mm/s ISO
- Si hay una segunda imagen con espectro FFT, analiza los picos de frecuencia

Componente: ${compName||'?'} | Máquina: ${machineName||'?'}${machineType?' ('+machineType+')':''}${machineRpm?' a '+machineRpm+' RPM':''}

Responde SOLO con JSON válido sin markdown:
{"vxDetectado":"número con 2 decimales o null","vyDetectado":"número con 2 decimales o null","vzDetectado":"número con 2 decimales o null","temperaturaDetectada":"número o null","frecuenciaDominante":"Hz o null","armonicosDetectados":[],"diagnostico":"diagnóstico basado SOLO en los valores numéricos medidos","tipoFalla":"Desbalance (dominante 1X)|Desalineación (dominante 2X)|Aflojamiento mecánico (armónicos múltiples)|Falla rodamiento (BPFO/BPFI/BSF)|Falla engranaje (GMF)|Resonancia|Rozamiento (rub, 0.5X)|Problema eléctrico (2×línea)|Normal / Sin falla|No determinado","severidadSugerida":"normal si max<2.3 | alerta si max entre 2.3-4.5 | critico si max>4.5","explicacion":"explicación técnica basada en los valores numéricos leídos y el espectro si disponible","accionRecomendada":"acción recomendada según ISO 10816"}`;

    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{ role: 'user', content: [...imgContents, { type: 'text', text: prompt }] }]
    });

    const result = await new Promise(function(resolve, reject) {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req2 = https.request(options, function(r) {
        let data = '';
        r.on('data', function(chunk) { data += chunk; });
        r.on('end', function() { resolve(JSON.parse(data)); });
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    if (result.error) return res.status(400).json({ error: result.error.message });
    const text = result.content.map(function(c) { return c.text || ''; }).join('').replace(/```json|```/g, '').trim();
    res.json(JSON.parse(text));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
