const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
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
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
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
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(hash, req.user.username);
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
  const result = machines.map(m => ({
    ...m,
    components: Q.getComponentsByMachine.all(m.id)
  }));
  res.json(result);
});

router.post('/zones/:zoneId/machines', requireAdmin, (req, res) => {
  const { name, type, rpm, notes, components } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
  const id = uid();
  Q.insertMachine.run(id, req.params.zoneId, name, type || '', rpm || null, notes || '');
  const comps = [];
  if (components && components.length) {
    components.forEach((c, i) => {
      const cid = uid();
      Q.insertComponent.run(cid, id, c.name, i);
      comps.push({ id: cid, name: c.name, machine_id: id });
    });
  }
  res.json({ id, zone_id: req.params.zoneId, name, type, rpm, notes, components: comps });
});

router.put('/machines/:id', requireAdmin, (req, res) => {
  const { name, type, rpm, notes, components } = req.body;
  Q.updateMachine.run(name, type || '', rpm || null, notes || '', req.params.id);
  if (components) {
    Q.deleteComponentsByMachine.run(req.params.id);
    components.forEach((c, i) => {
      const cid = c.id || uid();
      Q.insertComponent.run(cid, req.params.id, c.name, i);
    });
  }
  res.json({ ok: true });
});

router.delete('/machines/:id', requireAdmin, (req, res) => {
  Q.deleteMachine.run(req.params.id);
  res.json({ ok: true });
});

// ── MEASUREMENTS ──────────────────────────────────────────────────────────────
router.get('/components/:compId/measurements', optionalAuth, (req, res) => {
  const ms = Q.getMeasurementsByComponent.all(req.params.compId);
  res.json(ms.map(m => ({
    ...m,
    images: m.image_files ? m.image_files.split(',').map(f => f.startsWith('http') ? f : `/uploads/${f}`) : []
  })));
});

router.get('/measurements/alerts', optionalAuth, (req, res) => {
  res.json(Q.getAllRecentAlerts.all());
});

router.post('/components/:compId/measurements', requireAdmin, upload.array('images', 10), (req, res) => {
  const { machine_id, date, point, vx, vy, vz, temperature, severity, fault_type, notes } = req.body;
  if (!machine_id || !date) return res.status(400).json({ error: 'Faltan campos obligatorios' });
  const id = uid();
  Q.insertMeasurement.run(
    id, machine_id, req.params.compId,
    date, point || '', parseFloat(vx)||null, parseFloat(vy)||null, parseFloat(vz)||null,
    parseFloat(temperature)||null, severity || 'normal', fault_type || '', notes || '',
    req.user.username
  );
  if (req.files && req.files.length) {
    req.files.forEach(f => {
      // Cloudinary stores public_id and secure_url
      const filename = f.public_id || f.filename;
      const url = f.path || f.secure_url || f.filename;
      Q.insertImage.run(id, url, f.originalname || filename, f.mimetype || 'image/jpeg');
    });
  }
  const saved = Q.getMeasurement.get(id);
  res.json({
    ...saved,
    images: saved.image_files ? saved.image_files.split(',').map(f => `/uploads/${f}`) : []
  });
});

router.delete('/measurements/:id', requireAdmin, async (req, res) => {
  const m = Q.getMeasurement.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrada' });
  // Delete images from Cloudinary
  const imgs = Q.getImagesByMeasurement.all(req.params.id);
  for (const img of imgs) {
    if (img.filename && img.filename.includes('vibmon/')) {
      await deleteImage(img.filename.split('/').pop().split('.')[0]);
    }
  }
  Q.deleteMeasurement.run(req.params.id);
  res.json({ ok: true });
});

// ── PDF REPORT ────────────────────────────────────────────────────────────────
router.get('/measurements/:id/pdf', optionalAuth, (req, res) => {
  const PDFDocument = require('pdfkit');
  const m = Q.getMeasurement.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrada' });

  const comp = Q.getComponent.get(m.component_id);
  const machine = Q.getMachine.get(m.machine_id);
  const zone = Q.getZone.get(machine?.zone_id);
  const images = Q.getImagesByMeasurement.all(m.id);

  const SEV = { normal: 'Normal', alerta: 'Alerta', critico: 'Crítico' };
  const SEVCOL = { normal: '#00aa55', alerta: '#cc8800', critico: '#cc1133' };

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="vibmon_${m.id}.pdf"`);
  doc.pipe(res);

  // Header bar
  doc.rect(0, 0, 595, 60).fill('#05080f');
  doc.fontSize(20).fillColor('#00d4ff').font('Helvetica-Bold').text('⚡ VIBMON', 50, 18);
  doc.fontSize(10).fillColor('#5a7a9a').font('Helvetica').text('Informe de Medición de Vibraciones', 50, 42);
  doc.fontSize(10).fillColor('#5a7a9a').text(`Generado: ${new Date().toLocaleString('es-ES')}`, 350, 42);

  let y = 80;

  // Location breadcrumb
  doc.fontSize(11).fillColor('#888').font('Helvetica')
    .text(`${zone?.icon || '📍'} ${zone?.name || '?'}  ›  🔧 ${machine?.name || '?'}  ›  🔩 ${comp?.name || '?'}`, 50, y);
  y += 20;

  // Severity badge
  const sev = m.severity || 'normal';
  const sevCol = SEVCOL[sev] || '#00aa55';
  doc.roundedRect(50, y, 100, 22, 4).fill(sevCol);
  doc.fontSize(11).fillColor('#fff').font('Helvetica-Bold').text(SEV[sev] || sev, 55, y + 5);
  doc.fontSize(11).fillColor('#333').font('Helvetica').text(`Fecha: ${m.date}`, 165, y + 5);
  if (m.point) doc.text(`Punto: ${m.point}`, 300, y + 5);
  y += 40;

  // XYZ Values
  doc.fontSize(12).fillColor('#05080f').font('Helvetica-Bold').text('Valores de Vibración (mm/s ISO)', 50, y);
  y += 18;
  const axes = [
    { label: 'X — Horizontal', val: m.vx, col: '#0088bb' },
    { label: 'Y — Vertical', val: m.vy, col: '#7744cc' },
    { label: 'Z — Axial', val: m.vz, col: '#00aa55' }
  ];
  axes.forEach((ax, i) => {
    const bx = 50 + i * 165;
    doc.rect(bx, y, 155, 55).fill('#f5f8ff').stroke('#dde');
    doc.fontSize(9).fillColor(ax.col).font('Helvetica-Bold').text(ax.label, bx + 8, y + 8);
    doc.fontSize(22).fillColor(ax.col).font('Helvetica-Bold').text(ax.val != null ? parseFloat(ax.val).toFixed(2) : '—', bx + 8, y + 20);
    doc.fontSize(9).fillColor('#888').font('Helvetica').text('mm/s', bx + 8, y + 43);
  });
  y += 70;

  // Temperature
  if (m.temperature != null) {
    doc.rect(50, y, 155, 45).fill('#fff8f0').stroke('#eec');
    doc.fontSize(9).fillColor('#cc6600').font('Helvetica-Bold').text('🌡 Temperatura', 58, y + 8);
    doc.fontSize(20).fillColor('#cc6600').font('Helvetica-Bold').text(`${parseFloat(m.temperature).toFixed(1)}°C`, 58, y + 20);
    y += 60;
  }

  // Max value & ISO classification
  const maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
  doc.rect(50, y, 490, 35).fill('#f0f4ff').stroke('#ccd');
  doc.fontSize(10).fillColor('#333').font('Helvetica').text(`Valor máximo: `, 58, y + 11);
  doc.fontSize(10).fillColor('#0055aa').font('Helvetica-Bold').text(`${maxV.toFixed(2)} mm/s`, 140, y + 11);
  doc.fontSize(10).fillColor('#555').font('Helvetica').text(`│  ISO 10816: <2.3 Normal  │  2.3-4.5 Alerta  │  >4.5 Crítico`, 220, y + 11);
  y += 50;

  // Fault type
  if (m.fault_type) {
    doc.fontSize(12).fillColor('#05080f').font('Helvetica-Bold').text('Diagnóstico', 50, y); y += 16;
    doc.rect(50, y, 490, 28).fill('#fff').stroke('#ccc');
    doc.fontSize(11).fillColor('#222').font('Helvetica').text(m.fault_type, 58, y + 8); y += 40;
  }

  // Notes
  if (m.notes) {
    doc.fontSize(12).fillColor('#05080f').font('Helvetica-Bold').text('Observaciones', 50, y); y += 16;
    doc.rect(50, y, 490, 50).fill('#fafafa').stroke('#ccc');
    doc.fontSize(10).fillColor('#444').font('Helvetica').text(m.notes, 58, y + 8, { width: 474 }); y += 65;
  }

  // Images
  if (images.length > 0) {
    doc.addPage();
    doc.fontSize(14).fillColor('#05080f').font('Helvetica-Bold').text('Imágenes del Espectro / Forma de Onda', 50, 50);
    let iy = 80; let ix = 50;
    images.forEach((img, idx) => {
      const fp = img.filename.startsWith('http') ? img.filename : path.join(UPLOAD_DIR, img.filename);
      try {
          if (ix + 240 > 545) { ix = 50; iy += 200; }
          if (iy + 180 > 780) { doc.addPage(); iy = 50; ix = 50; }
          doc.image(fp, ix, iy, { width: 230, height: 170, fit: [230, 170] });
          doc.fontSize(8).fillColor('#888').text(img.original_name || `Imagen ${idx + 1}`, ix, iy + 175, { width: 230 });
          ix += 250;
        } catch(e) { /* skip unreadable image */ }
      }
    });
  }

  // Footer
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < doc._pageBuffer.length; i++) {
    doc.switchToPage(i);
    doc.rect(0, 800, 595, 42).fill('#05080f');
    doc.fontSize(8).fillColor('#5a7a9a').text('VIBMON — Monitor de Vibraciones Industrial', 50, 812);
    doc.text(`Página ${i + 1}`, 500, 812);
  }

  doc.end();
});

// ── MACHINE FULL PDF (all components) ────────────────────────────────────────
router.get('/machines/:id/pdf', optionalAuth, (req, res) => {
  const PDFDocument = require('pdfkit');
  const machine = Q.getMachine.get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina no encontrada' });
  const zone = Q.getZone.get(machine.zone_id);
  const components = Q.getComponentsByMachine.all(machine.id);
  const SEVCOL = { normal: '#00aa55', alerta: '#cc8800', critico: '#cc1133' };

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="vibmon_${machine.id}.pdf"`);
  doc.pipe(res);

  // Cover
  doc.rect(0, 0, 595, 842).fill('#05080f');
  doc.fontSize(32).fillColor('#00d4ff').font('Helvetica-Bold').text('⚡ VIBMON', 50, 120);
  doc.fontSize(18).fillColor('#fff').font('Helvetica').text('Informe Completo de Máquina', 50, 165);
  doc.fontSize(24).fillColor('#fff').font('Helvetica-Bold').text(machine.name, 50, 220);
  doc.fontSize(14).fillColor('#5a7a9a').font('Helvetica').text(`${zone?.icon || '📍'} ${zone?.name || '?'}`, 50, 260);
  if (machine.type) doc.fontSize(12).fillColor('#5a7a9a').text(`Tipo: ${machine.type}`, 50, 285);
  if (machine.rpm) doc.fontSize(12).fillColor('#5a7a9a').text(`RPM: ${machine.rpm}`, 50, 305);
  doc.fontSize(11).fillColor('#5a7a9a').text(`Generado: ${new Date().toLocaleString('es-ES')}`, 50, 340);
  doc.fontSize(11).fillColor('#5a7a9a').text(`Componentes monitoreados: ${components.length}`, 50, 360);

  components.forEach(comp => {
    doc.addPage();
    const ms = Q.getMeasurementsByComponent.all(comp.id).map(m => ({
      ...m,
      images: m.image_files ? m.image_files.split(',') : []
    }));

    doc.rect(0, 0, 595, 50).fill('#0a1020');
    doc.fontSize(14).fillColor('#00d4ff').font('Helvetica-Bold').text(`🔩 ${comp.name}`, 50, 16);
    doc.fontSize(10).fillColor('#5a7a9a').text(`${machine.name}  ›  ${ms.length} medición${ms.length !== 1 ? 'es' : ''}`, 50, 35);

    let y = 65;
    if (!ms.length) {
      doc.fontSize(11).fillColor('#888').text('Sin mediciones registradas.', 50, y);
      return;
    }

    ms.forEach((m, idx) => {
      if (y > 720) { doc.addPage(); y = 50; }
      const maxV = Math.max(parseFloat(m.vx)||0, parseFloat(m.vy)||0, parseFloat(m.vz)||0);
      const sCol = SEVCOL[m.severity] || '#00aa55';
      doc.rect(50, y, 490, 90).fill('#f8faff').stroke('#dde');
      doc.rect(50, y, 4, 90).fill(sCol);
      doc.fontSize(10).fillColor('#333').font('Helvetica-Bold').text(`${m.date}${m.point ? '  ·  ' + m.point : ''}`, 62, y + 8);
      doc.fontSize(9).fillColor(sCol).text(m.severity?.toUpperCase(), 450, y + 8);
      doc.fontSize(12).fillColor('#0055aa').font('Helvetica-Bold')
        .text(`X: ${m.vx != null ? parseFloat(m.vx).toFixed(2) : '—'}`, 62, y + 25)
      doc.fillColor('#7744cc').text(`Y: ${m.vy != null ? parseFloat(m.vy).toFixed(2) : '—'}`, 170, y + 25);
      doc.fillColor('#00aa55').text(`Z: ${m.vz != null ? parseFloat(m.vz).toFixed(2) : '—'}`, 278, y + 25);
      doc.fontSize(9).fillColor('#888').font('Helvetica').text('mm/s', 380, y + 27);
      if (m.temperature != null) doc.fillColor('#cc6600').text(`🌡 ${parseFloat(m.temperature).toFixed(1)}°C`, 430, y + 27);
      if (m.fault_type) doc.fontSize(9).fillColor('#444').font('Helvetica').text(m.fault_type, 62, y + 50, { width: 450 });
      if (m.notes) doc.fontSize(8).fillColor('#777').text(m.notes, 62, y + 65, { width: 450, ellipsis: true });
      y += 100;
    });
  });

  doc.end();
});

module.exports = router;
