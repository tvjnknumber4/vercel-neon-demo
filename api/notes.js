import { neon } from '@neondatabase/serverless';

/**
 * Parses the incoming request body into an object when available.
 */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }
  return req.body;
}

/**
 * Extracts a positive integer id from query parameters or URL.
 */
function parseNoteId(req) {
  let raw = req.query?.id;
  if (raw === undefined && req.url) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    raw = parsedUrl.searchParams.get('id') ?? undefined;
  }
  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }
  const str = String(raw).trim();
  if (!/^\d+$/.test(str)) {
    return null;
  }
  const id = Number(str);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Vercel Serverless Function backing the demo notes board with Neon Postgres.
 */
export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL is not configured' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    await sql`
      CREATE TABLE IF NOT EXISTS demo_notes (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    if (req.method === 'GET') {
      const [timeRows, notes] = await Promise.all([
        sql`SELECT NOW() AS db_time`,
        sql`SELECT id, text, created_at FROM demo_notes ORDER BY id DESC LIMIT 20`,
      ]);
      return res.status(200).json({
        ok: true,
        dbTime: timeRows[0]?.db_time ?? null,
        notes,
      });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = parseBody(req);
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
      }

      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (text.length < 1 || text.length > 280) {
        return res.status(400).json({
          ok: false,
          error: 'Text must be between 1 and 280 characters',
        });
      }

      const inserted = await sql`
        INSERT INTO demo_notes (text)
        VALUES (${text})
        RETURNING id, text, created_at
      `;
      return res.status(201).json({ ok: true, note: inserted[0] });
    }

    if (req.method === 'DELETE') {
      const id = parseNoteId(req);
      if (!id) {
        return res.status(400).json({ ok: false, error: 'Invalid numeric id parameter' });
      }

      const deleted = await sql`
        DELETE FROM demo_notes
        WHERE id = ${id}
        RETURNING id
      `;
      if (deleted.length === 0) {
        return res.status(404).json({ ok: false, error: 'Note not found' });
      }
      return res.status(200).json({ ok: true, deletedId: deleted[0].id });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Unexpected database error',
    });
  }
}
