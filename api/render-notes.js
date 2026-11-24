/**
 * Proxies /api/render-notes requests on Vercel to the Render Web Service backend.
 */
export default async function handler(req, res) {
  const baseUrl = (process.env.RENDER_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return res.status(500).json({ ok: false, error: 'RENDER_API_URL is not configured' });
  }

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const targetUrl = new URL(`${baseUrl}/api/notes`);
    if (req.method === 'DELETE') {
      let id = req.query?.id;
      if (id === undefined && req.url) {
        const parsed = new URL(req.url, 'http://localhost');
        id = parsed.searchParams.get('id') ?? undefined;
      }
      if (Array.isArray(id)) {
        id = id[0];
      }
      if (id !== undefined) {
        targetUrl.searchParams.set('id', String(id));
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(45000),
    };

    if (req.method === 'POST') {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    }

    const upstream = await fetch(targetUrl.toString(), fetchOptions);
    const rawText = await upstream.text();
    let payload;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      return res.status(502).json({
        ok: false,
        error: `Render backend returned non-JSON response (HTTP ${upstream.status})`,
        renderUrl: baseUrl,
      });
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payload.renderUrl = baseUrl;
    }

    return res.status(upstream.status).json(payload);
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err?.message || 'Failed to reach Render backend',
      renderUrl: baseUrl,
    });
  }
}
