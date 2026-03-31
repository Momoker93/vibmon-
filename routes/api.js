const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, Q } = require('../database');
const { signToken, requireAuth, requireAdmin, optionalAuth } = require('../middleware/auth');
const { upload, deleteImage } = require('../cloudinary');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
  const user = Q.getUserByUsername.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/auth/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = Q.getUserByUsername.get(req.user.username);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'Minimo 4 caracteres' });
  db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync(newPassword, 12), req.user.username);
  res.json({ ok: true });
});

// ── ZONES ─────────────────────────────────────────────────────────────────────
router.get('/zones', optionalAuth, (req, res) => {
  const zones = Q.getAllZones.all();
  const stats = Q.getGlobalStats.get();
  res.json({ zones, stats });
});

router.post('/zones', requireAdmin, (req, res) => {
  const { name, description, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
  const id = uid();
  Q.insertZone.run(id, name, description || '', icon || '🏭');
  res.json({ id, name, description, icon });
});

router.put('/zones/:id', requireAdmin, (req, res) => {
  const { name, description, icon } = req.body;
  Q.updateZone.run(name, description || '', icon || '🏭', req.params.id);
  res.json({ ok: true });
});

router.delete('/zones/:id', requireAdmin, (req, res) => {
  Q.deleteZone.run(req.params.id);
  res.json({ ok: true });
});

// ── MACHINES ──────────────────────────────────────────────────────────────────
router.get('/zones/:zoneId/machines', optionalAuth, (req, res) => {
  const machines = Q.getMachinesByZone.all(req.params.zoneId);
  res.json(machines.map(function(m) {
    return Object.assign({}, m, { components: Q.getComponentsByMachine.all(m.id) });
  }));
});

router.post('/zones/:zoneId/machines', requireAdmin, (req, res) => {
  const { name, type, rpm, notes, components } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
  const id = uid();
  Q.insertMachine.run(id, req.params.zoneId, name, type || '', rpm || null, notes || '');
  const comps = [];
  if (components && components.length) {
    components.forEach(function(c, i) {
      const cid = c.id || uid();
      Q.insertComponent.run(cid, id, c.name, i);
      comps.push({ id: cid, name: c.name, machine_id: id });
    });
  }
  res.json({ id: id, zone_id: req.params.zoneId, name: name, type: type, rpm: rpm, notes: notes, components: comps });
});

router.put('/machines/:id', requireAdmin, (req, res) => {
  const { name, type, rpm, notes, components } = req.body;
  Q.updateMachine.run(name, type || '', rpm || null, notes || '', req.params.id);
  if (components) {
    Q.deleteComponentsByMachine.run(req.params.id);
    components.forEach(function(c, i) {
      Q.insertComponent.run(c.id || uid(), req.params.id, c.name, i);
    });
  }
  res.json({ ok: true });
});

router.delete('/machines/:id', requireAdmin, (req, res) => {
  Q.deleteMachine.run(req.params.id);
  res.json({ ok: true });
});

// ── MEASUREMENTS ──────────────────────────────────────────────────────────────
function imgUrl(f) {
  if (!f) return '';
  return f.startsWith('http') ? f : '/uploads/' + f;
}

router.get('/components/:compId/measurements', optionalAuth, (req, res) => {
  const ms = Q.getMeasurementsByComponent.all(req.params.compId);
  res.json(ms.map(function(m) {
    return Object.assign({}, m, {
      images: m.image_files ? m.image_files.split(',').map(imgUrl) : []
    });
  }));
});

router.get('/measurements/alerts', optionalAuth, (req, res) => {
  res.json(Q.getAllRecentAlerts.all());
});

router.post('/components/:compId/measurements', requireAdmin, upload.array('images', 10), function(req, res) {
  const { machine_id, date, point, vx, vy, vz, temperature, severity, fault_type, notes } = req.body;
  if (!machine_id || !date) return res.status(400).json({ error: 'Faltan campos obligatorios' });
  const id = uid();
  Q.insertMeasurement.run(
    id, machine_id, req.params.compId,
    date, point || '',
    parseFloat(vx) || null, parseFloat(vy) || null, parseFloat(vz) || null,
    parseFloat(temperature) || null,
    severity || 'normal', fault_type || '', notes || '',
    req.user ? req.user.username : 'admin'
  );
  if (req.files && req.files.length) {
    req.files.forEach(function(f) {
      const url = f.path || f.secure_url || f.filename || '';
      Q.insertImage.run(id, url, f.originalname || 'imagen', f.mimetype || 'image/jpeg');
    });
  }
  const saved = Q.getMeasurement.get(id);
  res.json(Object.assign({}, saved, {
    images: saved.image_files ? saved.image_files.split(',').map(imgUrl) : []
  }));
});

router.delete('/measurements/:id', requireAdmin, function(req, res) {
  const m = Q.getMeasurement.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrada' });
  const imgs = Q.getImagesByMeasurement.all(req.params.id);
  imgs.forEach(function(img) {
    if (img.filename && img.filename.indexOf('vibmon/') !== -1) {
      const publicId = 'vibmon/' + img.filename.split('/').pop().split('.')[0];
      deleteImage(publicId).catch(function() {});
    }
  });
  Q.deleteMeasurement.run(req.params.id);
  res.json({ ok: true });
});

// ── PDF SINGLE MEASUREMENT ────────────────────────────────────────────────────
router.get('/measurements/:id/pdf', optionalAuth, function(req, res) {
  try {
    const PDFDocument = require('pdfkit');
    const m = Q.getMeasurement.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'No encontrada' });
    const comp = Q.getComponent.get(m.component_id);
    const machine = Q.getMachine.get(m.machine_id);
    const zone = machine ? Q.getZone.get(machine.zone_id) : null;
    const images = Q.getImagesByMeasurement.all(m.id);
    const SEVCOL = { normal: '#00aa55', alerta: '#cc8800', critico: '#cc1133' };
    const SEVLBL = { normal: 'Normal', alerta: 'Alerta', critico: 'Critico' };

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="vibmon_' + m.id + '.pdf"');
    doc.pipe(res);

    doc.rect(0, 0, 595, 60).fill('#05080f');
    doc.fontSize(20).fillColor('#00d4ff').font('Helvetica-Bold').text('VIBMON', 50, 18);
    doc.fontSize(10).fillColor('#5a7a9a').font('Helvetica').text('Informe de Medicion de Vibraciones', 50, 42);
    doc.fontSize(10).fillColor('#5a7a9a').text('Generado: ' + new Date().toLocaleString('es-ES'), 350, 42);

    var y = 80;
    doc.fontSize(11).fillColor('#888').font('Helvetica')
      .text((zone ? zone.name : '?') + '  >  ' + (machine ? machine.name : '?') + '  >  ' + (comp ? comp.name : '?'), 50, y);
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
      doc.fontSize(22).fillColor(ax.col).font('Helvetica-Bold').text(ax.val != null ? parseFloat(ax.val).toFixed(2) : '--', bx + 8, y + 20);
      doc.fontSize(9).fillColor('#888').font('Helvetica').text('mm/s', bx + 8, y + 43);
    });
    y += 75;

    var maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
    doc.rect(50, y, 490, 30).fill('#f0f4ff').stroke('#ccd');
    doc.fontSize(10).fillColor('#0055aa').font('Helvetica-Bold').text('Max: ' + maxV.toFixed(2) + ' mm/s', 58, y + 9);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text('ISO 10816: <2.3 Normal · 2.3-4.5 Alerta · >4.5 Critico', 200, y + 9);
    y += 45;

    if (m.fault_type) {
      doc.fontSize(11).fillColor('#05080f').font('Helvetica-Bold').text('Diagnostico: ' + m.fault_type, 50, y); y += 24;
    }
    if (m.notes) {
      doc.fontSize(10).fillColor('#444').font('Helvetica').text('Obs: ' + m.notes, 50, y, { width: 490 }); y += 30;
    }

    doc.end();
  } catch(e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── PDF FULL MACHINE ──────────────────────────────────────────────────────────
router.get('/machines/:id/pdf', optionalAuth, function(req, res) {
  try {
    const PDFDocument = require('pdfkit');
    const machine = Q.getMachine.get(req.params.id);
    if (!machine) return res.status(404).json({ error: 'Maquina no encontrada' });
    const zone = Q.getZone.get(machine.zone_id);
    const components = Q.getComponentsByMachine.all(machine.id);
    const SEVCOL = { normal: '#00aa55', alerta: '#cc8800', critico: '#cc1133' };

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="vibmon_machine_' + machine.id + '.pdf"');
    doc.pipe(res);

    doc.rect(0, 0, 595, 842).fill('#05080f');
    doc.fontSize(32).fillColor('#00d4ff').font('Helvetica-Bold').text('VIBMON', 50, 120);
    doc.fontSize(18).fillColor('#fff').font('Helvetica').text('Informe Completo de Maquina', 50, 165);
    doc.fontSize(24).fillColor('#fff').font('Helvetica-Bold').text(machine.name, 50, 220);
    doc.fontSize(14).fillColor('#5a7a9a').font('Helvetica').text((zone ? zone.name : ''), 50, 260);
    if (machine.type) doc.fontSize(12).fillColor('#5a7a9a').text('Tipo: ' + machine.type, 50, 285);
    if (machine.rpm) doc.fontSize(12).fillColor('#5a7a9a').text('RPM: ' + machine.rpm, 50, 305);
    doc.fontSize(11).fillColor('#5a7a9a').text('Generado: ' + new Date().toLocaleString('es-ES'), 50, 340);

    components.forEach(function(comp) {
      doc.addPage();
      const ms = Q.getMeasurementsByComponent.all(comp.id);
      doc.rect(0, 0, 595, 50).fill('#0a1020');
      doc.fontSize(14).fillColor('#00d4ff').font('Helvetica-Bold').text(comp.name, 50, 16);
      doc.fontSize(10).fillColor('#5a7a9a').text(machine.name + ' · ' + ms.length + ' mediciones', 50, 35);

      var y = 65;
      if (!ms.length) {
        doc.fontSize(11).fillColor('#888').text('Sin mediciones registradas.', 50, y);
        return;
      }
      ms.forEach(function(m) {
        if (y > 720) { doc.addPage(); y = 50; }
        var maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
        var sCol = SEVCOL[m.severity] || '#00aa55';
        doc.rect(50, y, 490, 80).fill('#f8faff').stroke('#dde');
        doc.rect(50, y, 4, 80).fill(sCol);
        doc.fontSize(10).fillColor('#333').font('Helvetica-Bold').text(m.date + (m.point ? '  ·  ' + m.point : ''), 62, y + 8);
        doc.fontSize(12).fillColor('#0055aa').font('Helvetica-Bold').text('X:' + (m.vx != null ? parseFloat(m.vx).toFixed(2) : '--'), 62, y + 25);
        doc.fillColor('#7744cc').text('Y:' + (m.vy != null ? parseFloat(m.vy).toFixed(2) : '--'), 180, y + 25);
        doc.fillColor('#00aa55').text('Z:' + (m.vz != null ? parseFloat(m.vz).toFixed(2) : '--'), 298, y + 25);
        doc.fontSize(9).fillColor('#888').font('Helvetica').text('mm/s  max:' + maxV.toFixed(2), 390, y + 27);
        if (m.fault_type) doc.fontSize(9).fillColor('#444').text(m.fault_type, 62, y + 48, { width: 450 });
        y += 90;
      });
    });

    doc.end();
  } catch(e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
