const { Router } = require('express');
const multer = require('multer');
const MediaUpload = require('../models/MediaUpload');
const s3Service = require('../services/s3Service');
const { asyncHandler } = require('../middleware');

const router = Router();

// ── Multer: memory storage (we stream to S3 ourselves) ────────────────────────
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('File type not allowed'), { status: 415 }));
  },
});

// ── POST /api/media/upload ────────────────────────────────────────────────────
// Direct server-side upload (suitable for files up to 10 MB)
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { originalname, mimetype, buffer } = req.file;
    const eventId = req.body.event_id || req.body.eventId || null;
    const uploader = req.body.uploader || 'anonymous';

    const meta = await s3Service.uploadFile({
      buffer,
      originalFilename: originalname,
      contentType: mimetype,
      eventId,
      uploader,
    });

    // Persist record in MongoDB
    const record = await MediaUpload.create({
      originalFilename: meta.originalFilename,
      s3Key: meta.s3Key,
      s3Url: meta.s3Url,
      contentType: meta.contentType,
      fileSize: meta.fileSize,
      uploadedBy: uploader,
      eventId: eventId || null,
    });

    res.status(201).json({ message: 'Upload successful', media: record.toPublic() });
  })
);

// ── POST /api/media/presign ───────────────────────────────────────────────────
// Return a pre-signed S3 POST URL for direct browser → S3 upload
router.post(
  '/presign',
  asyncHandler(async (req, res) => {
    const { filename, content_type: contentType, event_id: eventId } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and content_type are required' });
    }

    // Validate mime type
    if (!ALLOWED_MIME.has(contentType)) {
      return res.status(415).json({ error: 'Unsupported file type' });
    }

    const result = await s3Service.getPresignedUploadUrl({ filename, contentType, eventId });
    res.json(result);
  })
);

// ── GET /api/media/event/:eventId ─────────────────────────────────────────────
// List all media uploads attached to a specific event
router.get(
  '/event/:eventId',
  asyncHandler(async (req, res) => {
    const uploads = await MediaUpload.find({ eventId: req.params.eventId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ media: uploads.map(u => toPublic(u)) });
  })
);

// ── DELETE /api/media/:id ─────────────────────────────────────────────────────
// Remove the DB record (S3 object is handled by a lifecycle policy)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await MediaUpload.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Media not found' });
    res.json({ message: 'Deleted' });
  })
);

// ── Helper ────────────────────────────────────────────────────────────────────
function toPublic(doc) {
  return {
    id: doc._id,
    filename: doc.originalFilename,
    s3Url: doc.s3Url,
    contentType: doc.contentType,
    fileSize: doc.fileSize,
    uploadedBy: doc.uploadedBy,
    eventId: doc.eventId,
    createdAt: doc.createdAt,
  };
}

module.exports = router;