import express from 'express';
import pg from 'pg';

const { Pool } = pg;

const app = express();
const PORT = Number(process.env.PORT) || 3000;

let pool = null;
let schemaPromise = null;

/**
 * Returns a lazily initialized PostgreSQL connection pool with SSL enabled for Render.
 */
function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }
  if (!pool) {
    const needsSsl =
      connectionString.includes('.render.com') ||
      connectionString.includes('sslmode=require');
    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

/**
 * Ensures the render_notes table exists before serving note queries.
 */
async function ensureSchema(dbPool) {
  if (!schemaPromise) {
    schemaPromise = dbPool
      .query(`
        CREATE TABLE IF NOT EXISTS render_notes (
          id SERIAL PRIMARY KEY,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .catch((err) => {
        schemaPromise = null;
        throw err;
      });
  }
  return schemaPromise;
}

/**
 * Parses a positive integer id from query or route parameter input.
 */
function parseNoteId(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }
  const str = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!/^\d+$/.test(str)) {
    return null;
  }
  const id = Number(str);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Requires an initialized database pool and schema, returning 500 if DATABASE_URL is absent.
 */
async function requireDb(res) {
  const dbPool = getPool();
  if (!dbPool) {
    res.status(500).json({ ok: false, error: 'DATABASE_URL is not configured' });
    return null;
  }
  await ensureSchema(dbPool);
  return dbPool;
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.use(express.json());

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  return next(err);
});

async function handleHealth(_req, res) {
  try {
    const dbPool = await requireDb(res);
    if (!dbPool) return;

    const { rows } = await dbPool.query('SELECT NOW() AS db_time');
    return res.status(200).json({
      ok: true,
      backend: 'Render Web Service',
      database: 'Render Postgres',
      dbTime: rows[0]?.db_time ?? null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Database error' });
  }
}

app.get('/', handleHealth);
app.get('/health', handleHealth);

app.get('/api/notes', async (_req, res) => {
  try {
    const dbPool = await requireDb(res);
    if (!dbPool) return;

    const [timeResult, notesResult] = await Promise.all([
      dbPool.query('SELECT NOW() AS db_time'),
      dbPool.query('SELECT id, text, created_at FROM render_notes ORDER BY id DESC LIMIT 20'),
    ]);

    return res.status(200).json({
      ok: true,
      backend: 'Render Web Service',
      database: 'Render Postgres',
      dbTime: timeResult.rows[0]?.db_time ?? null,
      notes: notesResult.rows,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Database error' });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (text.length < 1 || text.length > 280) {
      return res.status(400).json({
        ok: false,
        error: 'Text must be between 1 and 280 characters',
      });
    }

    const dbPool = await requireDb(res);
    if (!dbPool) return;

    const { rows } = await dbPool.query(
      'INSERT INTO render_notes (text) VALUES ($1) RETURNING id, text, created_at',
      [text]
    );
    return res.status(201).json({ ok: true, note: rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Database error' });
  }
});

async function handleDeleteNote(req, res) {
  try {
    const id = parseNoteId(req.params.id ?? req.query.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Invalid numeric id parameter' });
    }

    const dbPool = await requireDb(res);
    if (!dbPool) return;

    const { rows } = await dbPool.query(
      'DELETE FROM render_notes WHERE id = $1 RETURNING id',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }
    return res.status(200).json({ ok: true, deletedId: rows[0].id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Database error' });
  }
}

app.delete('/api/notes', handleDeleteNote);
app.delete('/api/notes/:id', handleDeleteNote);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Render backend listening on port ${PORT}`);
});
