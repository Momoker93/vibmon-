const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vibmon.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '🏭',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    rpm INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS components (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS measurements (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    component_id TEXT NOT NULL,
    date TEXT NOT NULL,
    point TEXT,
    vx REAL,
    vy REAL,
    vz REAL,
    temperature REAL,
    severity TEXT NOT NULL DEFAULT 'normal',
    fault_type TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
    FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS measurement_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measurement_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (measurement_id) REFERENCES measurements(id) ON DELETE CASCADE
  );
`);

// ── SEED ADMIN ───────────────────────────────────────────────────────────────
function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(process.env.ADMIN_USER || 'admin');
  if (!existing) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASS || 'vibmon2024', 12);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      process.env.ADMIN_USER || 'admin', hash, 'admin'
    );
    console.log('✓ Admin user created');
  }
}
seedAdmin();

// ── QUERY HELPERS ────────────────────────────────────────────────────────────
const Q = {
  // Users
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT id, username, role FROM users WHERE id = ?'),

  // Zones
  getAllZones: db.prepare('SELECT * FROM zones ORDER BY name'),
  getZone: db.prepare('SELECT * FROM zones WHERE id = ?'),
  insertZone: db.prepare('INSERT INTO zones (id, name, description, icon) VALUES (?, ?, ?, ?)'),
  updateZone: db.prepare('UPDATE zones SET name=?, description=?, icon=? WHERE id=?'),
  deleteZone: db.prepare('DELETE FROM zones WHERE id=?'),

  // Machines
  getMachinesByZone: db.prepare('SELECT * FROM machines WHERE zone_id=? ORDER BY name'),
  getMachine: db.prepare('SELECT * FROM machines WHERE id=?'),
  insertMachine: db.prepare('INSERT INTO machines (id, zone_id, name, type, rpm, notes) VALUES (?,?,?,?,?,?)'),
  updateMachine: db.prepare('UPDATE machines SET name=?,type=?,rpm=?,notes=? WHERE id=?'),
  deleteMachine: db.prepare('DELETE FROM machines WHERE id=?'),

  // Components
  getComponentsByMachine: db.prepare('SELECT * FROM components WHERE machine_id=? ORDER BY sort_order, name'),
  getComponent: db.prepare('SELECT * FROM components WHERE id=?'),
  insertComponent: db.prepare('INSERT INTO components (id, machine_id, name, sort_order) VALUES (?,?,?,?)'),
  deleteComponentsByMachine: db.prepare('DELETE FROM components WHERE machine_id=?'),

  // Measurements
  getMeasurementsByComponent: db.prepare(`
    SELECT m.*, GROUP_CONCAT(mi.filename) as image_files
    FROM measurements m
    LEFT JOIN measurement_images mi ON mi.measurement_id = m.id
    WHERE m.component_id=?
    GROUP BY m.id
    ORDER BY m.date ASC, m.created_at ASC
  `),
  getMeasurement: db.prepare(`
    SELECT m.*, GROUP_CONCAT(mi.filename) as image_files, GROUP_CONCAT(mi.original_name) as image_names
    FROM measurements m
    LEFT JOIN measurement_images mi ON mi.measurement_id = m.id
    WHERE m.id=?
    GROUP BY m.id
  `),
  getMeasurementsByMachine: db.prepare(`
    SELECT m.* FROM measurements m WHERE m.machine_id=? ORDER BY m.date DESC LIMIT 100
  `),
  getAllRecentAlerts: db.prepare(`
    SELECT m.*, ma.name as machine_name, z.name as zone_name, z.icon as zone_icon, c.name as comp_name
    FROM measurements m
    JOIN machines ma ON ma.id = m.machine_id
    JOIN zones z ON z.id = ma.zone_id
    JOIN components c ON c.id = m.component_id
    WHERE m.severity != 'normal'
    ORDER BY m.date DESC, m.created_at DESC
    LIMIT 20
  `),
  insertMeasurement: db.prepare('INSERT INTO measurements (id,machine_id,component_id,date,point,vx,vy,vz,temperature,severity,fault_type,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'),
  deleteMeasurement: db.prepare('DELETE FROM measurements WHERE id=?'),
  insertImage: db.prepare('INSERT INTO measurement_images (measurement_id, filename, original_name, mime_type) VALUES (?,?,?,?)'),
  getImagesByMeasurement: db.prepare('SELECT * FROM measurement_images WHERE measurement_id=?'),

  // Stats
  getZoneStats: db.prepare(`
    SELECT 
      COUNT(DISTINCT ma.id) as machine_count,
      SUM(CASE WHEN m.severity='critico' THEN 1 ELSE 0 END) as critico_count,
      SUM(CASE WHEN m.severity='alerta' THEN 1 ELSE 0 END) as alerta_count
    FROM machines ma
    LEFT JOIN measurements m ON m.machine_id = ma.id
    WHERE ma.zone_id=?
  `),
  getGlobalStats: db.prepare(`
    SELECT 
      COUNT(DISTINCT z.id) as zone_count,
      COUNT(DISTINCT ma.id) as machine_count,
      SUM(CASE WHEN m.severity='critico' THEN 1 ELSE 0 END) as critico_count,
      SUM(CASE WHEN m.severity='alerta' THEN 1 ELSE 0 END) as alerta_count
    FROM zones z
    LEFT JOIN machines ma ON ma.zone_id=z.id
    LEFT JOIN measurements m ON m.machine_id=ma.id
  `)
};

module.exports = { db, Q };
