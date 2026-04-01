const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure the /data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE SETUP ---
const dbPath = path.join(dataDir, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error(err.message);
  else console.log("Connected to SQLite at " + dbPath);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    department TEXT,
    password TEXT,
    trust_score INTEGER DEFAULT 100,
    total_lent INTEGER DEFAULT 0,
    total_borrowed INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS resources (
    resource_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    category TEXT,
    owner_id INTEGER,
    location TEXT,
    max_duration INTEGER,
    description TEXT,
    status TEXT DEFAULT 'available'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS borrow_requests (
    request_id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER,
    borrower_id INTEGER,
    owner_id INTEGER,
    duration_days INTEGER,
    note TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  console.log("Database initialized");
});

// --- ROUTES ---

app.get('/', (req, res) => {
  const rootPath = path.join(__dirname, 'index.html');
  const publicPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(publicPath)) res.sendFile(publicPath);
  else if (fs.existsSync(rootPath)) res.sendFile(rootPath);
  else res.status(404).send("index.html not found.");
});

// REGISTRATION
app.post('/api/register', (req, res) => {
  const { name, email, department, password } = req.body;
  if (!name || !email || !department || !password) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (user) return res.status(400).json({ ok: false, error: "User already exists" });
    db.run(
      `INSERT INTO users (name, email, department, password) VALUES (?, ?, ?, ?)`,
      [name, email, department, password],
      function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        db.get("SELECT * FROM users WHERE user_id = ?", [this.lastID], (err, newUser) => {
          res.json({ ok: true, data: newUser });
        });
      }
    );
  });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, user) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    if (!user) return res.status(401).json({ ok: false, error: "Invalid email or password" });
    res.json({ ok: true, data: user });
  });
});

// GET ALL USERS
app.get('/api/users', (req, res) => {
  db.all("SELECT * FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, data: rows });
  });
});

// GET ONE USER
app.get('/api/users/:id', (req, res) => {
  db.get("SELECT * FROM users WHERE user_id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    if (!row) return res.status(404).json({ ok: false, error: "User not found" });
    res.json({ ok: true, data: row });
  });
});

// GET ALL RESOURCES (supports ?category=&status=&q=)
app.get('/api/resources', (req, res) => {
  let query = "SELECT * FROM resources WHERE 1=1";
  const params = [];
  if (req.query.category) { query += " AND category = ?"; params.push(req.query.category); }
  if (req.query.status)   { query += " AND status = ?";   params.push(req.query.status); }
  if (req.query.q)        { query += " AND name LIKE ?";  params.push(`%${req.query.q}%`); }
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, data: rows });
  });
});

// ADD A RESOURCE
app.post('/api/resources', (req, res) => {
  const { name, category, owner_id, location, max_duration, description } = req.body;
  if (!name || !owner_id) return res.status(400).json({ ok: false, error: "Missing fields" });
  db.run(
    `INSERT INTO resources (name, category, owner_id, location, max_duration, description) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, category || 'other', owner_id, location, max_duration || 7, description || ''],
    function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      db.get("SELECT * FROM resources WHERE resource_id = ?", [this.lastID], (err, row) => {
        res.json({ ok: true, data: row });
      });
    }
  );
});

// DELETE A RESOURCE
app.delete('/api/resources/:id', (req, res) => {
  db.run("DELETE FROM resources WHERE resource_id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, data: { deleted: this.changes > 0 } });
  });
});

// GET ALL BORROW REQUESTS (supports ?borrower_id=&owner_id=&status=)
app.get('/api/requests', (req, res) => {
  let query = "SELECT * FROM borrow_requests WHERE 1=1";
  const params = [];
  if (req.query.borrower_id) { query += " AND borrower_id = ?"; params.push(req.query.borrower_id); }
  if (req.query.owner_id)    { query += " AND owner_id = ?";    params.push(req.query.owner_id); }
  if (req.query.status)      { query += " AND status = ?";      params.push(req.query.status); }
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, data: rows });
  });
});

// SUBMIT A BORROW REQUEST
app.post('/api/requests', (req, res) => {
  const { resource_id, borrower_id, duration_days, note } = req.body;
  if (!resource_id || !borrower_id) return res.status(400).json({ ok: false, error: "Missing fields" });

  db.get("SELECT * FROM resources WHERE resource_id = ?", [resource_id], (err, resource) => {
    if (!resource) return res.status(404).json({ ok: false, error: "Resource not found" });
    db.run(
      `INSERT INTO borrow_requests (resource_id, borrower_id, owner_id, duration_days, note) VALUES (?, ?, ?, ?, ?)`,
      [resource_id, borrower_id, resource.owner_id, duration_days || 1, note || ''],
      function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        db.get("SELECT * FROM borrow_requests WHERE request_id = ?", [this.lastID], (err, row) => {
          // Also mark resource as pending
          db.run("UPDATE resources SET status = 'pending' WHERE resource_id = ?", [resource_id]);
          res.json({ ok: true, data: row });
        });
      }
    );
  });
});

// UPDATE REQUEST STATUS (approved / rejected / returned)
app.patch('/api/requests/:id', (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'returned'].includes(status)) {
    return res.status(400).json({ ok: false, error: "Invalid status" });
  }

  db.get("SELECT * FROM borrow_requests WHERE request_id = ?", [req.params.id], (err, request) => {
    if (!request) return res.status(404).json({ ok: false, error: "Request not found" });

    db.run("UPDATE borrow_requests SET status = ? WHERE request_id = ?", [status, req.params.id], (err) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });

      // Update resource status accordingly
      let resStatus = null;
      if (status === 'approved')  resStatus = 'borrowed';
      if (status === 'rejected')  resStatus = 'available';
      if (status === 'returned')  resStatus = 'available';

      if (resStatus) {
        db.run("UPDATE resources SET status = ? WHERE resource_id = ?", [resStatus, request.resource_id]);
      }

      // On return, bump trust score +5
      if (status === 'returned') {
        db.run("UPDATE users SET trust_score = MIN(100, trust_score + 5) WHERE user_id = ?", [request.borrower_id]);
      }

      db.get("SELECT * FROM borrow_requests WHERE request_id = ?", [req.params.id], (err, updated) => {
        res.json({ ok: true, data: updated });
      });
    });
  });
});

// GET NOTIFICATIONS FOR A USER
app.get('/api/notifications/:userId', (req, res) => {
  db.all(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC",
    [req.params.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, data: rows });
    }
  );
});

// MARK NOTIFICATION AS READ
app.patch('/api/notifications/:id/read', (req, res) => {
  db.run("UPDATE notifications SET is_read = 1 WHERE notification_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, data: { updated: true } });
  });
});

// GET TRUST SCORE LOG (stub — returns trust_score from user)
app.get('/api/trust-log/:userId', (req, res) => {
  db.get("SELECT trust_score FROM users WHERE user_id = ?", [req.params.userId], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, data: row ? [{ score: row.trust_score, note: 'Current score' }] : [] });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});