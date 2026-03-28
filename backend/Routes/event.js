const { Router } = require('express');
const Event = require('../Models/Event');
const { fetchAndStoreEvents } = require('../services/eventFetcher');
const { requireAdmin, asyncHandler } = require('../middleware');

const router = Router();

// ── GET /api/events ───────────────────────────────────────────────────────────
// List events with optional filtering, text search, and pagination
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 12,
      category,
      city,
      search,
      upcoming = 'true',
      source,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 12, 50);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter = { status: 'active' };

    if (upcoming === 'true') {
      filter.eventDate = { $gte: new Date() };
    }

    if (category && category !== 'All') {
      filter.category = { $regex: category, $options: 'i' };
    }

    if (city) {
      filter['venue.city'] = { $regex: city, $options: 'i' };
    }

    if (source) {
      filter.source = source;
    }

    // Full-text search (uses the text index on title + description + tags)
    if (search?.trim()) {
      filter.$text = { $search: search.trim() };
    }

    const [events, total] = await Promise.all([
      Event.find(filter)
        .sort(search?.trim() ? { score: { $meta: 'textScore' } } : { eventDate: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Event.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      events: events.map(e => formatEvent(e)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    });
  })
);

// ── GET /api/events/featured ──────────────────────────────────────────────────
// Next 6 upcoming events for hero carousel
router.get(
  '/featured',
  asyncHandler(async (req, res) => {
    const events = await Event.find({
      status: 'active',
      eventDate: { $gte: new Date() },
    })
      .sort({ eventDate: 1 })
      .limit(6)
      .lean();

    res.json({ events: events.map(formatEvent) });
  })
);

// ── GET /api/events/categories ────────────────────────────────────────────────
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const categories = await Event.distinct('category', { status: 'active' });
    const sorted = ['All', ...categories.filter(Boolean).sort()];
    res.json({ categories: sorted });
  })
);

// ── GET /api/events/stats ─────────────────────────────────────────────────────
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [total, upcoming, categoryCount] = await Promise.all([
      Event.countDocuments({ status: 'active' }),
      Event.countDocuments({ status: 'active', eventDate: { $gte: new Date() } }),
      Event.distinct('category', { status: 'active' }).then(c => c.filter(Boolean).length),
    ]);
    res.json({ total, upcoming, categories: categoryCount });
  })
);

// ── POST /api/events/refresh  (admin only) ────────────────────────────────────
router.post(
  '/refresh',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await fetchAndStoreEvents();
    res.json({ message: 'Events refreshed successfully' });
  })
);

// ── GET /api/events/:id ───────────────────────────────────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(formatEvent(event));
  })
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEvent(doc) {
  return {
    id: doc._id,
    externalId: doc.externalId,
    source: doc.source,
    title: doc.title,
    description: doc.description,
    eventDate: doc.eventDate,
    eventDateLocal: doc.eventDateLocal,
    eventTimeLocal: doc.eventTimeLocal,
    venue: doc.venue || {},
    imageUrl: doc.s3ImageUrl || doc.imageUrl || null,
    category: doc.category,
    tags: doc.tags || [],
    ticketUrl: doc.ticketUrl,
    price: doc.price || {},
    status: doc.status,
    fetchedAt: doc.fetchedAt,
    createdAt: doc.createdAt,
  };
}

module.exports = router;