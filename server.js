const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,                      // Eyni vaxtda maksimum bağlantı sayı
  idleTimeoutMillis: 30000,     // 30 saniyə boş qalan bağlantıları bağla
  connectionTimeoutMillis: 8000, // 8 saniyə ərzində bağlantı qurulamazsa xəta ver
  keepAlive: true,              // Firewall/bulud hostinqin bağlantını kəsməməsi üçün
  keepAliveInitialDelayMillis: 10000
});

// Pool səviyyəsindəki gözlənilməz xətaları tut — serverin çöküşünün qarşısını al
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error (client idle):', err.message);
  // Serverı çökdürmürük, sadəcə loga yazırıq
});

// Test DB Connection + Auto-fix sequences on startup
pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error acquiring client', err.stack);
    return;
  }
  console.log('Connected to PostgreSQL successfully!');
  release();

  // Auto-fix sequences after CSV imports or manual DB inserts
  const tables = ['employees', 'departments', 'sectors', 'positions', 'portal_users', 'employee_edit_requests'];
  try {
    for (const t of tables) {
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 1), 1))`
      );
    }
    console.log('Sequences auto-synced with max IDs.');
  } catch (e) {
    // Silently ignore if a table doesn't have a sequence (safe to skip)
    console.warn('Sequence sync warning:', e.message);
  }
});

/* ─── DOMAIN TABLES API ─── */

// POST /api/admin/sync-sequences — manually trigger sequence sync
app.post('/api/admin/sync-sequences', async (req, res) => {
  const tables = ['employees', 'departments', 'sectors', 'positions', 'portal_users', 'employee_edit_requests'];
  const results = {};
  try {
    for (const t of tables) {
      const r = await pool.query(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 1), 1))`
      );
      results[t] = r.rows[0].setval;
    }
    console.log('Manual sequence sync done:', results);
    res.json({ success: true, sequences: results });
  } catch (err) {
    console.error('Sequence sync error:', err.message);
    res.status(500).json({ error: 'Sequence sync failed', details: err.message });
  }
});

// CLEAR DATA ENDPOINTS
app.delete('/api/admin/clear/employees', async (req, res) => {
  try {
    await pool.query('DELETE FROM employee_edit_requests');
    await pool.query('DELETE FROM employees');
    res.json({ success: true, message: 'Bütün əməkdaşlar silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear employees', details: err.message });
  }
});

app.delete('/api/admin/clear/departments', async (req, res) => {
  try {
    await pool.query('DELETE FROM departments');
    res.json({ success: true, message: 'Bütün şöbələr silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear departments', details: err.message });
  }
});

app.delete('/api/admin/clear/sectors', async (req, res) => {
  try {
    await pool.query('DELETE FROM sectors');
    res.json({ success: true, message: 'Bütün sektorlar silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear sectors', details: err.message });
  }
});

app.delete('/api/admin/clear/positions', async (req, res) => {
  try {
    await pool.query('DELETE FROM positions');
    res.json({ success: true, message: 'Bütün vəzifələr silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear positions', details: err.message });
  }
});

// GET all domains in one call (departments + sectors + positions)
app.get('/api/domains', async (req, res) => {
  try {
    const [depts, sectors, positions] = await Promise.all([
      pool.query('SELECT * FROM departments ORDER BY id ASC'),
      pool.query('SELECT * FROM sectors ORDER BY id ASC'),
      pool.query('SELECT * FROM positions ORDER BY id ASC'),
    ]);
    res.json({
      departments: depts.rows,
      sectors: sectors.rows,
      positions: positions.rows,
      system_positions: []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// ── Departments ──

app.get('/api/departments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM departments ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/departments', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO departments (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu şöbə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.patch('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'UPDATE departments SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu şöbə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if used by any employee
    const checkUse = await pool.query('SELECT COUNT(*) FROM employees WHERE dept_id = $1', [id]);
    if (parseInt(checkUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Bu şöbə əməkdaşlar tərəfindən istifadə olunur və silinə bilməz!' });
    }
    const result = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// ── Sectors ──

app.get('/api/sectors', async (req, res) => {
  const { dept_id } = req.query;
  try {
    let query = 'SELECT * FROM sectors';
    const params = [];
    if (dept_id) { query += ' WHERE dept_id = $1'; params.push(dept_id); }
    query += ' ORDER BY id ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/sectors', async (req, res) => {
  const { name, dept_id } = req.body;
  if (!name || !name.trim() || !dept_id) return res.status(400).json({ error: 'name and dept_id are required' });
  try {
    const result = await pool.query(
      'INSERT INTO sectors (name, dept_id) VALUES ($1, $2) RETURNING *',
      [name.trim(), dept_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu sektor artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.patch('/api/sectors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, dept_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'UPDATE sectors SET name = $1, dept_id = COALESCE($2, dept_id) WHERE id = $3 RETURNING *',
      [name.trim(), dept_id || null, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu sektor artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.delete('/api/sectors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if used by any employee
    const checkUse = await pool.query('SELECT COUNT(*) FROM employees WHERE sector_id = $1', [id]);
    if (parseInt(checkUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Bu sektor əməkdaşlar tərəfindən istifadə olunur və silinə bilməz!' });
    }
    const result = await pool.query('DELETE FROM sectors WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// ── Positions ──

app.get('/api/positions', async (req, res) => {
  const { sector_id, dept_id } = req.query;
  try {
    let result;
    if (sector_id) {
      result = await pool.query(
        'SELECT DISTINCT p.* FROM positions p JOIN employees e ON e.position_id = p.id WHERE e.sector_id = $1 ORDER BY p.id ASC',
        [sector_id]
      );
    } else if (dept_id) {
      result = await pool.query(
        'SELECT DISTINCT p.* FROM positions p JOIN employees e ON e.position_id = p.id WHERE e.dept_id = $1 ORDER BY p.id ASC',
        [dept_id]
      );
    } else {
      result = await pool.query('SELECT * FROM positions ORDER BY id ASC');
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/positions', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO positions (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu vəzifə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.patch('/api/positions/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    // Check if the current position is a system position
    const current = await pool.query('SELECT name FROM positions WHERE id = $1', [id]);
    if (current.rows.length > 0) {
      const systemPositions = ["DİREKTOR", "ŞÖBƏ MÜDİRİ", "ŞÖBƏ MÜDİRİ MÜAVİNİ", "SEKTOR MÜDİRİ"];
      if (systemPositions.includes(current.rows[0].name.toUpperCase())) {
        return res.status(403).json({ error: 'Sistem vəzifəsi redaktə edilə bilməz!' });
      }
    }

    const result = await pool.query(
      'UPDATE positions SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bu vəzifə artıq mövcuddur' });
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.delete('/api/positions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if the current position is a system position
    const current = await pool.query('SELECT name FROM positions WHERE id = $1', [id]);
    if (current.rows.length > 0) {
      const systemPositions = ["DİREKTOR", "ŞÖBƏ MÜDİRİ", "ŞÖBƏ MÜDİRİ MÜAVİNİ", "SEKTOR MÜDİRİ"];
      if (systemPositions.includes(current.rows[0].name.toUpperCase())) {
        return res.status(403).json({ error: 'Sistem vəzifəsi silinə bilməz!' });
      }
    }

    // Check if used by any employee
    const checkUse = await pool.query('SELECT COUNT(*) FROM employees WHERE position_id = $1', [id]);
    if (parseInt(checkUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Bu vəzifə əməkdaşlar tərəfindən istifadə olunur və silinə bilməz!' });
    }
    const result = await pool.query('DELETE FROM positions WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


/* ─── EMPLOYEES API ─── */

app.get('/api/employees', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.*,
        d.name  AS dept_name,
        s.name  AS sector_name,
        p.name  AS position_name,
        s.dept_id AS sector_parent_dept_id
      FROM employees e
      LEFT JOIN departments d ON d.id = e.dept_id
      LEFT JOIN sectors     s ON s.id = e.sector_id
      LEFT JOIN positions   p ON p.id = e.position_id
      ORDER BY e.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Add new employee (accepts dept_id, sector_id, position_id)
app.post('/api/employees', async (req, res) => {
  const { name, position_id, dept_id, sector_id, email, intphone, mobile, room, car_plate } = req.body;

  try {
    const normalizedEmail = (email && String(email).trim()) || null;
    const normalizedMobile = formatMobileNumber(mobile);
    const normalizedCarPlate = formatCarPlate(car_plate);
    const result = await pool.query(
      `INSERT INTO employees (name, position_id, dept_id, sector_id, email, intphone, mobile, room, car_plate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, position_id || null, dept_id || null, sector_id || null, normalizedEmail, intphone || null, normalizedMobile, room || null, normalizedCarPlate]
    );
    const full = await pool.query(`
      SELECT e.*, d.name AS dept_name, s.name AS sector_name, p.name AS position_name, s.dept_id AS sector_parent_dept_id
      FROM employees e
      LEFT JOIN departments d ON d.id = e.dept_id
      LEFT JOIN sectors     s ON s.id = e.sector_id
      LEFT JOIN positions   p ON p.id = e.position_id
      WHERE e.id = $1
    `, [result.rows[0].id]);
    res.status(201).json(full.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23502') {
      return res.status(400).json({ error: 'Məcburi sahələr doldurulmalıdır', details: err.message });
    }
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Update employee
app.patch('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const allowed = ['name', 'position_id', 'dept_id', 'sector_id', 'email', 'intphone', 'mobile', 'room', 'car_plate'];
  const setClauses = [];
  const values = [];
  let index = 1;

  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    let normalized = value === '' ? null : value;
    if (key === 'email') normalized = (value && String(value).trim()) || null;
    if (key === 'mobile') normalized = formatMobileNumber(value);
    if (key === 'car_plate') normalized = formatCarPlate(value);
    setClauses.push(`${key} = $${index}`);
    values.push(normalized);
    index++;
  }

  if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE employees SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${index} RETURNING *`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });

    const full = await pool.query(`
      SELECT e.*, d.name AS dept_name, s.name AS sector_name, p.name AS position_name, s.dept_id AS sector_parent_dept_id
      FROM employees e
      LEFT JOIN departments d ON d.id = e.dept_id
      LEFT JOIN sectors     s ON s.id = e.sector_id
      LEFT JOIN positions   p ON p.id = e.position_id
      WHERE e.id = $1
    `, [id]);
    res.json(full.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Delete employee
app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM employees WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


/* ─── EDIT REQUESTS API ─── */

// Get edit requests (supports filtering by status)
app.get('/api/employee_edit_requests', async (req, res) => {
  const { status } = req.query;
  try {
    let query = 'SELECT * FROM employee_edit_requests';
    const params = [];
    if (status) { query += ' WHERE status = $1'; params.push(status); }
    query += ' ORDER BY requested_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Get pending request count
app.get('/api/employee_edit_requests/count', async (req, res) => {
  const { status } = req.query;
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM employee_edit_requests WHERE status = $1',
      [status || 'pending']
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Create edit request
app.post('/api/employee_edit_requests', async (req, res) => {
  const { employee_id, employee_name, old_data, new_data, status, requested_by, request_type } = req.body;
  try {
    if (employee_id) {
      const empRes = await pool.query('SELECT dept_id FROM employees WHERE id = $1', [employee_id]);
      if (empRes.rows.length > 0 && Number(empRes.rows[0].dept_id) === 1) {
        return res.status(403).json({ error: 'Rəhbərlik şöbəsindəki əməkdaşlar üçün redaktə sorğusu göndərilə bilməz!' });
      }
    }
    const result = await pool.query(
      `INSERT INTO employee_edit_requests (employee_id, employee_name, old_data, new_data, status, requested_by, request_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [employee_id || null, employee_name, JSON.stringify(old_data), JSON.stringify(new_data), status || 'pending', requested_by, request_type || 'edit']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Update edit request status (approve/reject)
// If approving a new_employee request, the employee is automatically created.
// If approving an edit request, only the changed fields (diff) are updated on the employee record.
app.patch('/api/employee_edit_requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status, resolved_at } = req.body;
  try {
    // Fetch the request to check its type
    const reqResult = await pool.query('SELECT * FROM employee_edit_requests WHERE id = $1', [id]);
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const editReq = reqResult.rows[0];

    if (status === 'approved') {
      if (editReq.request_type === 'new_employee') {
        const d = editReq.new_data || {};
        const normalizedEmail = (d.email && String(d.email).trim()) || null;
        const normalizedMobile = formatMobileNumber(d.mobile);
        const normalizedCarPlate = formatCarPlate(d.car_plate);
        await pool.query(
          `INSERT INTO employees (name, position_id, dept_id, sector_id, email, intphone, mobile, room, car_plate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            d.name, d.position_id || null,
            d.dept_id || null, d.sector_id || null,
            normalizedEmail, d.intphone || null, normalizedMobile, d.room || null, normalizedCarPlate
          ]
        );
      } else if (editReq.employee_id) {
        // Edit request: apply ONLY changed fields (diff between old_data and new_data)
        const oldD = editReq.old_data || {};
        const newD = editReq.new_data || {};
        const allowed = ['name', 'position_id', 'dept_id', 'sector_id', 'email', 'intphone', 'mobile', 'room', 'car_plate'];
        const setClauses = [];
        const values = [];
        let index = 1;

        for (const key of allowed) {
          const oldV = oldD[key] !== undefined && oldD[key] !== null ? String(oldD[key]).trim() : '';
          const newV = newD[key] !== undefined && newD[key] !== null ? String(newD[key]).trim() : '';

          // Check if field actually changed
          const hasChanged = editReq.old_data ? (oldV !== newV) : (newD[key] !== undefined);

          if (hasChanged && newD[key] !== undefined) {
            let val = newD[key] === '' ? null : newD[key];
            if (key === 'email') val = (val && String(val).trim()) || null;
            if (key === 'mobile') val = formatMobileNumber(val);
            if (key === 'car_plate') val = formatCarPlate(val);
            setClauses.push(`${key} = $${index}`);
            values.push(val);
            index++;
          }
        }

        if (setClauses.length > 0) {
          values.push(editReq.employee_id);
          await pool.query(
            `UPDATE employees SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${index}`,
            values
          );
        }
      }
    }

    const result = await pool.query(
      `UPDATE employee_edit_requests SET status = $1, resolved_at = $2 WHERE id = $3 RETURNING *`,
      [status, resolved_at || new Date().toISOString(), id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


/* ─── PORTAL USERS API ─── */

// Get all portal users
app.get('/api/portal_users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portal_users ORDER BY username ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Update user password
app.patch('/api/portal_users/:id', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  try {
    let hashedPassword = password;
    if (password) {
      const bcrypt = require('bcrypt');
      hashedPassword = await bcrypt.hash(password, 10);
    }
    
    const result = await pool.query(
      'UPDATE portal_users SET password = $1 WHERE id = $2 RETURNING *',
      [hashedPassword, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Authenticate Admin / Portal Users
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'İstifadəçi adı və şifrə daxil edilməlidir' });
  }
  try {
    const result = await pool.query(
      'SELECT id, username, role, password FROM portal_users WHERE LOWER(username) = LOWER($1) AND is_active = true',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'İstifadəçi adı və ya şifrə yanlışdır!' });
    }
    const user = result.rows[0];
    
    // Hash müqayisəsi
    const bcrypt = require('bcrypt');
    const isMatch = await bcrypt.compare(password, user.password);
    
    // Keçmişdə yaradılan düz (plain-text) şifrələrin müvəqqəti işləməsi üçün:
    if (!isMatch && user.password !== password) {
      return res.status(401).json({ error: 'Şifrə yanlışdır!' });
    }

    res.json({
      id: user.id,
      username: user.username,
      role: user.role
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

function formatCarPlate(plate) {
  if (!plate) return null;
  let s = String(plate).trim().toUpperCase();
  if (!s) return null;
  
  // Nömrə daxilində artıq tire varsa və ya boşluqla ayrılıbsa, təmizləyib standartlaşdıraq
  // Nümunələr: "10-AB-123", "10 AB 123", "10AB123", "10 - AB - 123", "10-AB 123"
  const clean = s.replace(/[^A-Z0-9]/g, '');
  const match = clean.match(/^(\d{2})([A-Z]{2})(\d{3})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  
  // Əgər fərqli strukturdadırsa, sadəcə çoxlu boşluqları və tireləri tənzimləyib saxla
  return s.replace(/\s+/g, ' ').trim();
}

function formatMobileNumber(phone) {
  if (!phone) return null;
  const s = String(phone).trim();
  if (!s) return null;

  // Extract all digits
  const digits = s.replace(/\D/g, '');
  if (!digits) return s;

  let localDigits = '';
  if (digits.startsWith('994') && digits.length >= 12) {
    localDigits = digits.slice(3, 12);
  } else if (digits.startsWith('0') && digits.length === 10) {
    localDigits = digits.slice(1, 10);
  } else if (digits.length === 9) {
    localDigits = digits;
  } else if (digits.length > 9) {
    localDigits = digits.slice(-9);
  }

  if (localDigits.length === 9) {
    const op = localDigits.slice(0, 2);
    const p1 = localDigits.slice(2, 5);
    const p2 = localDigits.slice(5, 7);
    const p3 = localDigits.slice(7, 9);
    return `+994 ${op}-${p1}-${p2}-${p3}`;
  }

  if (s.startsWith('+994')) {
    return s.replace(/^\+994\s*/, '+994 ');
  }
  return s;
}

function validateImportRows(rows, table) {
  const errors = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isDigitsOnly = (v) => /^\d+$/.test(String(v).trim());
  const hasLetter = (v) => /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0500-\u052F\u018F\u0259\u01DD\u018F\u011F\u011E\u0131\u0130\u00F6\u00D6\u00FC\u00DC\u00E7\u00C7\u015F\u015E]/i.test(String(v));

  rows.forEach((r, idx) => {
    const rowNum = idx + 2; // +1 for 1-based, +1 for CSV header row

    if (table === 'departments') {
      const rawName = r.name || r['ŞÖBƏ'] || r['Şöbə'] || r['şöbə'];
      const rawId = r.id || r.NO || r.no;
      const name = rawName ? String(rawName).trim() : null;

      if (!name) {
        errors.push(`Sətir ${rowNum}: 'name' (Şöbə adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        errors.push(`Sətir ${rowNum}: 'id' sütununda hərf və ya simvol ola bilməz (Daxil edilən: "${rawId}"). Yalnız tam rəqəm olmalıdır.`);
      }
    } else if (table === 'sectors') {
      const rawName = r.name || r['SEKTOR'] || r['Sektor'] || r['sektor'];
      const rawId = r.id || r.NO || r.no;
      const deptId = r.dept_id ? String(r.dept_id).trim() : '';
      const name = rawName ? String(rawName).trim() : null;

      if (!name) {
        errors.push(`Sətir ${rowNum}: 'name' (Sektor adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        errors.push(`Sətir ${rowNum}: 'id' sütununda hərf ola bilməz (Daxil edilən: "${rawId}"). Yalnız rəqəm olmalıdır.`);
      }
      if (!deptId) {
        errors.push(`Sətir ${rowNum}: 'dept_id' (Şöbə ID-si) məcburidir və boş ola bilməz`);
      } else if (!isDigitsOnly(deptId)) {
        errors.push(`Sətir ${rowNum}: 'dept_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${deptId}"). Yalnız şöbənin ID nömrəsi (rəqəm) olmalıdır.`);
      }
    } else if (table === 'positions') {
      const rawName = r.name || r['VƏZİFƏ'] || r['Vəzifə'] || r['vəzifə'];
      const rawId = r.id || r.NO || r.no;
      const name = rawName ? String(rawName).trim() : null;

      if (!name) {
        errors.push(`Sətir ${rowNum}: 'name' (Vəzifə adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        errors.push(`Sətir ${rowNum}: 'id' sütununda hərf ola bilməz (Daxil edilən: "${rawId}"). Yalnız rəqəm olmalıdır.`);
      }
    } else if (table === 'employees') {
      const rawName = r.name || r['Ad'] || r['Ad Soyad'] || r['AD SOYAD'];
      const name = rawName ? String(rawName).trim() : null;
      const rawId = r.id ? String(r.id).trim() : '';
      const deptId = r.dept_id ? String(r.dept_id).trim() : '';
      const sectorId = r.sector_id ? String(r.sector_id).trim() : '';
      const positionId = r.position_id ? String(r.position_id).trim() : '';
      const email = r.email ? String(r.email).trim() : '';
      const intphone = r.intphone ? String(r.intphone).trim() : '';
      const mobile = r.mobile ? String(r.mobile).trim() : '';

      if (!name) {
        errors.push(`Sətir ${rowNum}: 'name' (Əməkdaşın adı) boş ola bilməz`);
      }
      if (rawId && !isDigitsOnly(rawId)) {
        errors.push(`Sətir ${rowNum}: 'id' sütununda hərf ola bilməz (Daxil edilən: "${rawId}"). Yalnız rəqəm olmalıdır.`);
      }
      if (deptId && !isDigitsOnly(deptId)) {
        errors.push(`Sətir ${rowNum}: 'dept_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${deptId}"). Yalnız şöbə ID-si (rəqəm) olmalıdır.`);
      }
      if (sectorId && !isDigitsOnly(sectorId)) {
        errors.push(`Sətir ${rowNum}: 'sector_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${sectorId}"). Yalnız sektor ID-si (rəqəm) olmalıdır.`);
      }
      if (positionId && !isDigitsOnly(positionId)) {
        errors.push(`Sətir ${rowNum}: 'position_id' sütununda hərf və ya mətn ola bilməz (Daxil edilən: "${positionId}"). Yalnız vəzifə ID-si (rəqəm) olmalıdır.`);
      }
      if (email && !emailRegex.test(email)) {
        errors.push(`Sətir ${rowNum}: 'email' formatı yanlışdır (Daxil edilən: "${email}"). Nümunə: ad@domen.az`);
      }
      if (intphone && hasLetter(intphone)) {
        errors.push(`Sətir ${rowNum}: 'intphone' (daxili telefon) sütununda hərf ola bilməz (Daxil edilən: "${intphone}"). Yalnız rəqəm olmalıdır.`);
      }
      if (mobile && hasLetter(mobile)) {
        errors.push(`Sətir ${rowNum}: 'mobile' (mobil nömrə) sütununda hərf ola bilməz (Daxil edilən: "${mobile}"). Nümunə: 050-123-45-67`);
      }
    }
  });

  return errors;
}

/* ─── CSV IMPORT API ─── */

// POST /api/import/:table — JSON rows import
// Accepts: { rows: [{col: val, ...}, ...] }
// Supported tables: departments, sectors, positions, employees
app.post('/api/import/:table', async (req, res) => {
  const { table } = req.params;
  const allowedTables = ['departments', 'sectors', 'positions', 'employees'];
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Yanlış cədvəl adı' });
  }

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows massivi boş və ya yanlışdır' });
  }

  // Pre-validate CSV data before DB connection/queries
  const validationErrors = validateImportRows(rows, table);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: `CSV faylında ${validationErrors.length} xəta tapıldı. Zəhmət olmasa düzəliş edib təkrar cəhd edin.`,
      details: validationErrors.slice(0, 30),
      totalErrors: validationErrors.length
    });
  }

  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const r of rows) {
      try {
        if (table === 'departments') {
          const rawId = r.id || r.NO || r.no;
          const rawName = r.name || r['ŞÖBƏ'] || r['Şöbə'] || r['şöbə'];
          const id = rawId ? parseInt(rawId) : null;
          const name = rawName ? String(rawName).trim() : null;
          if (!name) { skipped++; continue; }

          if (id) {
            await client.query(
              `INSERT INTO departments (id, name) VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
              [id, name]
            );
          } else {
            await client.query(
              `INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
              [name]
            );
          }
          imported++;

        } else if (table === 'sectors') {
          const id = r.id ? parseInt(r.id) : null;
          const name = r.name ? String(r.name).trim() : null;
          const deptId = r.dept_id ? parseInt(r.dept_id) : null;
          if (!name || !deptId) { skipped++; continue; }

          if (id) {
            await client.query(
              `INSERT INTO sectors (id, name, dept_id) VALUES ($1, $2, $3)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, dept_id = EXCLUDED.dept_id`,
              [id, name, deptId]
            );
          } else {
            await client.query(
              `INSERT INTO sectors (name, dept_id) VALUES ($1, $2)
               ON CONFLICT (name, dept_id) DO NOTHING`,
              [name, deptId]
            );
          }
          imported++;

        } else if (table === 'positions') {
          const id = r.id ? parseInt(r.id) : null;
          const name = r.name ? String(r.name).trim() : null;
          if (!name) { skipped++; continue; }

          if (id) {
            await client.query(
              `INSERT INTO positions (id, name) VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
              [id, name]
            );
          } else {
            await client.query(
              `INSERT INTO positions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
              [name]
            );
          }
          imported++;

        } else if (table === 'employees') {
          const id = r.id ? parseInt(r.id) : null;
          const name = r.name ? String(r.name).trim() : null;
          if (!name) { skipped++; continue; }

          const email = r.email && String(r.email).trim() ? String(r.email).trim() : null;
          const intphone = r.intphone && String(r.intphone).trim() ? String(r.intphone).trim() : null;
          const mobile = formatMobileNumber(r.mobile);
          const room = r.room && String(r.room).trim() ? String(r.room).trim() : null;
          const carPlate = formatCarPlate(r.car_plate);
          const deptId = r.dept_id ? parseInt(r.dept_id) : null;
          const sectorId = r.sector_id ? parseInt(r.sector_id) : null;
          const positionId = r.position_id ? parseInt(r.position_id) : null;

          if (id) {
            await client.query(
              `INSERT INTO employees (id, name, email, intphone, mobile, room, car_plate, dept_id, sector_id, position_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name, email = EXCLUDED.email,
                 intphone = EXCLUDED.intphone, mobile = EXCLUDED.mobile,
                 room = EXCLUDED.room, car_plate = EXCLUDED.car_plate,
                 dept_id = EXCLUDED.dept_id, sector_id = EXCLUDED.sector_id,
                 position_id = EXCLUDED.position_id, updated_at = now()`,
              [id, name, email, intphone, mobile, room, carPlate, deptId, sectorId, positionId]
            );
          } else {
            await client.query(
              `INSERT INTO employees (name, email, intphone, mobile, room, car_plate, dept_id, sector_id, position_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [name, email, intphone, mobile, room, carPlate, deptId, sectorId, positionId]
            );
          }
          imported++;
        }
      } catch (rowErr) {
        console.warn(`Import row skipped (${table}):`, rowErr.message);
        skipped++;
      }
    }

    // Sync sequences
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1))`
    );

    await client.query('COMMIT');
    console.log(`Import ${table}: ${imported} imported, ${skipped} skipped`);
    res.json({ success: true, imported, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Import ${table} error:`, err.message);
    res.status(500).json({ error: 'Import zamanı xəta baş verdi', details: err.message });
  } finally {
    client.release();
  }
});

/* ─── CSV EXPORT API ─── */
app.get('/api/export/:table', async (req, res) => {
  const { table } = req.params;
  const allowedTables = ['departments', 'sectors', 'positions', 'employees'];
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Yanlış cədvəl adı' });
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
    const rows = result.rows;
    
    if (rows.length === 0) {
      return res.status(200).send(''); // Empty CSV
    }

    // CSV header row
    const headers = Object.keys(rows[0]);
    let csvContent = headers.join(',') + '\n';

    // CSV data rows
    rows.forEach(row => {
      const values = headers.map(header => {
        let val = row[header];
        if (val === null || val === undefined) val = '';
        val = String(val).replace(/"/g, '""'); // escape quotes
        // wrap in quotes if contains comma, quote, or newline
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val}"`;
        }
        return val;
      });
      csvContent += values.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${table}_export.csv"`);
    // Add BOM for Excel UTF-8 support
    res.send('\uFEFF' + csvContent);
  } catch (err) {
    console.error(`Export ${table} error:`, err.message);
    res.status(500).json({ error: 'Export zamanı xəta baş verdi', details: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
