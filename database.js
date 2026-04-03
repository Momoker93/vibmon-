const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ── SCHEMA ────────────────────────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS zones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        icon TEXT DEFAULT '🏭',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT DEFAULT '',
        rpm INTEGER,
        notes TEXT DEFAULT '',
        icon TEXT DEFAULT '⚙',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS measurements (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        point TEXT DEFAULT '',
        vx REAL,
        vy REAL,
        vz REAL,
        temperature REAL,
        severity TEXT DEFAULT 'normal',
        fault_type TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        ai_result TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        created_by TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS measurement_images (
        id SERIAL PRIMARY KEY,
        measurement_id TEXT NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT DEFAULT '',
        mime_type TEXT DEFAULT 'image/jpeg',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS maintenance_notes (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        type TEXT DEFAULT 'revision',
        technician TEXT DEFAULT '',
        description TEXT NOT NULL,
        created_by TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Safe migrations
    try {
      await client.query("ALTER TABLE measurements ADD COLUMN IF NOT EXISTS ai_result TEXT DEFAULT ''");
    } catch(e) {}
    try {
      // measurement_date = date the measurement was actually taken (user-specified)
      // date field keeps the same value for backwards compatibility
      await client.query("ALTER TABLE measurements ADD COLUMN IF NOT EXISTS measurement_date TEXT DEFAULT ''");
    } catch(e) {}
    try {
      await client.query("ALTER TABLE machines ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '⚙'");
    } catch(e) {}

    // Seed admin
    const existing = await client.query('SELECT id FROM users WHERE username=$1', [process.env.ADMIN_USER || 'admin']);
    if (existing.rows.length === 0) {
      const hash = bcrypt.hashSync(process.env.ADMIN_PASS || 'vibmon2024', 12);
      await client.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)',
        [process.env.ADMIN_USER || 'admin', hash, 'admin']);
      console.log('✓ Admin user created');
    }
  } finally {
    client.release();
  }
}

// ── QUERY HELPERS ─────────────────────────────────────────────────────────────
const Q = {
  // Users
  getUserByUsername: async (username) => {
    const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    return r.rows[0] || null;
  },
  updateUserPassword: async (hash, username) => {
    await pool.query('UPDATE users SET password_hash=$1 WHERE username=$2', [hash, username]);
  },

  // Zones
  getAllZones: async () => {
    const r = await pool.query(`
      WITH latest_per_comp AS (
        SELECT DISTINCT ON (component_id) component_id, machine_id, severity
        FROM measurements
        ORDER BY component_id, date DESC, created_at DESC
      ),
      machine_severity AS (
        SELECT ma.id as machine_id, ma.zone_id,
          MAX(CASE WHEN l.severity='critico' THEN 2 WHEN l.severity='alerta' THEN 1 ELSE 0 END) as worst
        FROM machines ma
        LEFT JOIN latest_per_comp l ON l.machine_id = ma.id
        GROUP BY ma.id, ma.zone_id
      )
      SELECT z.*,
        COUNT(DISTINCT ma.id) as machine_count,
        COUNT(DISTINCT CASE WHEN ms.worst=2 THEN ma.id END) as critico_count,
        COUNT(DISTINCT CASE WHEN ms.worst=1 THEN ma.id END) as alerta_count,
        COUNT(DISTINCT CASE WHEN ms.worst=0 AND ma.id IS NOT NULL THEN ma.id END) as normal_count
      FROM zones z
      LEFT JOIN machines ma ON ma.zone_id = z.id
      LEFT JOIN machine_severity ms ON ms.machine_id = ma.id
      GROUP BY z.id
      ORDER BY z.name
    `);
    return r.rows;
  },
  getZone: async (id) => {
    const r = await pool.query('SELECT * FROM zones WHERE id=$1', [id]);
    return r.rows[0] || null;
  },
  insertZone: async (id, name, desc, icon) => {
    await pool.query('INSERT INTO zones (id,name,description,icon) VALUES ($1,$2,$3,$4)', [id, name, desc, icon]);
  },
  updateZone: async (name, desc, icon, id) => {
    await pool.query('UPDATE zones SET name=$1,description=$2,icon=$3 WHERE id=$4', [name, desc, icon, id]);
  },
  deleteZone: async (id) => {
    await pool.query('DELETE FROM zones WHERE id=$1', [id]);
  },

  // Machines
  getMachinesByZone: async (zoneId) => {
    const r = await pool.query(`
      SELECT ma.*,
        m.vx as last_vx, m.vy as last_vy, m.vz as last_vz,
        m.date as last_date, m.severity as worst_severity
      FROM machines ma
      LEFT JOIN LATERAL (
        SELECT vx,vy,vz,date,severity FROM measurements
        WHERE machine_id=ma.id
        ORDER BY date DESC, created_at DESC LIMIT 1
      ) m ON true
      WHERE ma.zone_id=$1
      ORDER BY ma.name
    `, [zoneId]);
    return r.rows;
  },
  getMachine: async (id) => {
    const r = await pool.query('SELECT * FROM machines WHERE id=$1', [id]);
    return r.rows[0] || null;
  },
  insertMachine: async (id, zoneId, name, type, rpm, notes, icon) => {
    await pool.query('INSERT INTO machines (id,zone_id,name,type,rpm,notes,icon) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, zoneId, name, type, rpm, notes, icon||'⚙']);
  },
  updateMachine: async (name, type, rpm, notes, id, icon) => {
    await pool.query('UPDATE machines SET name=$1,type=$2,rpm=$3,notes=$4,icon=$5 WHERE id=$6', [name, type, rpm, notes, icon||'⚙', id]);
  },
  deleteMachine: async (id) => {
    await pool.query('DELETE FROM machines WHERE id=$1', [id]);
  },

  // Components
  getComponentsByMachine: async (machineId) => {
    const r = await pool.query('SELECT * FROM components WHERE machine_id=$1 ORDER BY sort_order,name', [machineId]);
    return r.rows;
  },
  getComponent: async (id) => {
    const r = await pool.query('SELECT * FROM components WHERE id=$1', [id]);
    return r.rows[0] || null;
  },
  insertComponent: async (id, machineId, name, order) => {
    await pool.query('INSERT INTO components (id,machine_id,name,sort_order) VALUES ($1,$2,$3,$4)', [id, machineId, name, order]);
  },
  deleteComponentsByMachine: async (machineId) => {
    await pool.query('DELETE FROM components WHERE machine_id=$1', [machineId]);
  },

  // Measurements
  getMeasurementsByComponent: async (compId) => {
    const r = await pool.query(`
      SELECT m.*, STRING_AGG(mi.filename, ',') as image_files
      FROM measurements m
      LEFT JOIN measurement_images mi ON mi.measurement_id = m.id
      WHERE m.component_id=$1
      GROUP BY m.id ORDER BY m.date ASC, m.created_at ASC
    `, [compId]);
    return r.rows;
  },
  getMeasurement: async (id) => {
    const r = await pool.query(`
      SELECT m.*, STRING_AGG(mi.filename, ',') as image_files,
             STRING_AGG(mi.original_name, ',') as image_names
      FROM measurements m
      LEFT JOIN measurement_images mi ON mi.measurement_id = m.id
      WHERE m.id=$1 GROUP BY m.id
    `, [id]);
    return r.rows[0] || null;
  },
  getMeasurementsByMachine: async (machineId) => {
    const r = await pool.query('SELECT * FROM measurements WHERE machine_id=$1 ORDER BY date DESC LIMIT 100', [machineId]);
    return r.rows;
  },
  getAllRecentAlerts: async () => {
    const r = await pool.query(`
      SELECT m.*, ma.name as machine_name, z.name as zone_name, z.icon as zone_icon, c.name as comp_name
      FROM measurements m
      JOIN machines ma ON ma.id = m.machine_id
      JOIN zones z ON z.id = ma.zone_id
      JOIN components c ON c.id = m.component_id
      WHERE m.severity != 'normal'
      ORDER BY m.date DESC, m.created_at DESC LIMIT 20
    `);
    return r.rows;
  },
  insertMeasurement: async (id, machineId, compId, date, point, vx, vy, vz, temp, severity, fault, notes, createdBy, aiResult, measurementDate) => {
    await pool.query(
      'INSERT INTO measurements (id,machine_id,component_id,date,point,vx,vy,vz,temperature,severity,fault_type,notes,created_by,ai_result,measurement_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [id, machineId, compId, date, point, vx, vy, vz, temp, severity, fault, notes, createdBy, aiResult||'', measurementDate||date]
    );
  },
  deleteMeasurement: async (id) => {
    await pool.query('DELETE FROM measurements WHERE id=$1', [id]);
  },
  insertImage: async (measId, filename, originalName, mimeType) => {
    await pool.query('INSERT INTO measurement_images (measurement_id,filename,original_name,mime_type) VALUES ($1,$2,$3,$4)',
      [measId, filename, originalName, mimeType]);
  },
  getImagesByMeasurement: async (measId) => {
    const r = await pool.query('SELECT * FROM measurement_images WHERE measurement_id=$1', [measId]);
    return r.rows;
  },

  // Stats
  getGlobalStats: async () => {
    const r = await pool.query(`
      WITH latest_per_comp AS (
        SELECT DISTINCT ON (component_id) component_id, machine_id, severity
        FROM measurements
        ORDER BY component_id, date DESC, created_at DESC
      ),
      machine_severity AS (
        SELECT ma.id as machine_id,
          MAX(CASE WHEN l.severity='critico' THEN 2 WHEN l.severity='alerta' THEN 1 ELSE 0 END) as worst
        FROM machines ma
        LEFT JOIN latest_per_comp l ON l.machine_id = ma.id
        GROUP BY ma.id
      )
      SELECT
        COUNT(DISTINCT z.id) as zone_count,
        COUNT(DISTINCT ma.id) as machine_count,
        COUNT(DISTINCT CASE WHEN ms.worst=2 THEN ma.id END) as critico_count,
        COUNT(DISTINCT CASE WHEN ms.worst=1 THEN ma.id END) as alerta_count,
        COUNT(DISTINCT CASE WHEN ms.worst=0 AND ma.id IS NOT NULL THEN ma.id END) as normal_count
      FROM zones z
      LEFT JOIN machines ma ON ma.zone_id=z.id
      LEFT JOIN machine_severity ms ON ms.machine_id=ma.id
    `);
    return r.rows[0];
  }
};

  // Maintenance notes
  getMaintenanceByMachine: async (machineId) => {
    const r = await pool.query(
      'SELECT * FROM maintenance_notes WHERE machine_id=$1 ORDER BY date DESC, created_at DESC',
      [machineId]
    );
    return r.rows;
  },
  insertMaintenance: async (id, machineId, date, type, technician, description, createdBy) => {
    await pool.query(
      'INSERT INTO maintenance_notes (id,machine_id,date,type,technician,description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, machineId, date, type, technician, description, createdBy]
    );
  },
  updateMaintenance: async (date, type, technician, description, id) => {
    await pool.query(
      'UPDATE maintenance_notes SET date=$1,type=$2,technician=$3,description=$4 WHERE id=$5',
      [date, type, technician, description, id]
    );
  },
  deleteMaintenance: async (id) => {
    await pool.query('DELETE FROM maintenance_notes WHERE id=$1', [id]);
  }
};

module.exports = { pool, Q, initDB };
