import { put, list, del } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const PREFIX = 'ardoise/';
const MAX_BYTES = 4 * 1024 * 1024;

const sha = s => createHash('sha256').update(String(s)).digest();

function authorized(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== 'string' || !password) return false;
  return timingSafeEqual(sha(password), sha(expected));
}

async function allBlobs() {
  const { blobs } = await list({ prefix: PREFIX });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [latest] = await allBlobs();
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120');
      return res.status(200).json(
        latest ? { imageUrl: latest.url, uploadedAt: latest.uploadedAt } : null
      );
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    res.setHeader('Cache-Control', 'no-store');
    let body;
    try { body = req.body; } catch { body = null; }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Requête invalide' });

    if (!authorized(body.password)) return res.status(401).json({ error: 'Mot de passe incorrect' });

    if (body.action === 'login') return res.status(200).json({ ok: true });

    if (body.action === 'delete') {
      const old = await allBlobs();
      if (old.length) await del(old.map(b => b.url));
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'upload') {
      const m = typeof body.image === 'string' && body.image.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return res.status(400).json({ error: 'Image invalide' });
      const buf = Buffer.from(m[1], 'base64');
      const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      if (!isJpeg || buf.length > MAX_BYTES) return res.status(400).json({ error: 'Image invalide ou trop lourde' });

      const old = await allBlobs();
      const blob = await put(`${PREFIX}${Date.now()}.jpg`, buf, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: true,
      });
      if (old.length) await del(old.map(b => b.url));
      return res.status(200).json({ imageUrl: blob.url, uploadedAt: new Date().toISOString() });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error(err);
    // Le détail n'est renvoyé qu'à un admin authentifié, pour diagnostiquer.
    const isAdmin = req.method === 'POST' && req.body && authorized(req.body.password);
    const detail = isAdmin && err && err.message ? ` (${err.message})` : '';
    return res.status(500).json({ error: 'Erreur serveur' + detail });
  }
}
