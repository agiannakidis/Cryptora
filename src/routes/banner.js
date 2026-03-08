const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, query } = require('../pgdb');
const { authMiddleware } = require('../middleware/auth');

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

// ── File upload setup ─────────────────────────────────────────────────────────
const UPLOAD_DIR = '/var/www/casino/banners';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `banner_${Date.now()}_${uuidv4().slice(0,8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/banner — public, active slides
router.get('/', async (req, res) => {
  try {
    const slides = await queryAll('SELECT * FROM banner_slides WHERE active = true ORDER BY position ASC');
    res.json(slides.map(sanitize));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/banner/admin — all slides
router.get('/admin', authMiddleware, adminOnly, async (req, res) => {
  try {
    const slides = await queryAll('SELECT * FROM banner_slides ORDER BY position ASC');
    res.json(slides.map(sanitize));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/banner/admin/upload — upload image from PC
router.post('/admin/upload', authMiddleware, adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  const url = `/banners/${req.file.filename}`;
  res.json({ ok: true, url });
});

// POST /api/banner/admin — create slide (URL or uploaded)
router.post('/admin', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      title, subtitle, description, background_image,
      overlay_color, accent, badge, cta_text, cta_link, cta_color, active, position
    } = req.body;
    if (!title || !subtitle) return res.status(400).json({ error: 'title and subtitle required' });

    const maxRow = await queryOne('SELECT MAX(position) as m FROM banner_slides');
    const pos = position !== undefined ? parseInt(position) : (parseInt(maxRow?.m ?? -1) + 1);
    const id = uuidv4();

    await query(`
      INSERT INTO banner_slides
        (id, position, title, subtitle, description, background_image,
         overlay_color, accent, badge, cta_text, cta_link, cta_color, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      id, pos, title, subtitle, description || '',
      background_image || '',
      overlay_color || 'from-black/70 via-black/50 to-black/60',
      accent || 'text-yellow-300',
      badge || '',
      cta_text || 'Play Now',
      cta_link || 'Home',
      cta_color || 'bg-[#f0c040] text-[#0a0e1a] hover:bg-yellow-300',
      active !== false,
    ]);

    res.json({ ok: true, id });
  } catch(e) { console.error('[banner/create]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/banner/admin/:id — update slide
router.put('/admin/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const slide = await queryOne('SELECT id FROM banner_slides WHERE id = $1', [req.params.id]);
    if (!slide) return res.status(404).json({ error: 'Not found' });

    const fields = ['title','subtitle','description','background_image','overlay_color','accent','badge','cta_text','cta_link','cta_color','active','position'];
    const updates = [], vals = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f}=$${idx++}`); vals.push(req.body[f]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await query(`UPDATE banner_slides SET ${updates.join(',')} WHERE id=$${idx}`, vals);
    res.json({ ok: true });
  } catch(e) { console.error('[banner/update]', e.message); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/banner/admin/:id
router.delete('/admin/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Remove uploaded file if exists
    const slide = await queryOne('SELECT background_image FROM banner_slides WHERE id = $1', [req.params.id]);
    if (slide && slide.background_image && slide.background_image.startsWith('/banners/')) {
      const filePath = path.join(UPLOAD_DIR, path.basename(slide.background_image));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await query('DELETE FROM banner_slides WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

function sanitize(s) {
  return { ...s, active: s.active === true || s.active === 't' || s.active === 1 };
}

module.exports = router;
