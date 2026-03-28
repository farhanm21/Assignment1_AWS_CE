/**
 * Event Fetcher Service
 * ---------------------
 * Periodically pulls events from the Ticketmaster Discovery API (v2) and
 * upserts them into MongoDB.  Falls back to mock data when no API key is set.
 *
 * API docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 * Free tier: 5 000 calls / day — sufficient for development and demo use.
 *
 * Scheduled with node-cron; also callable on-demand via the /api/events/refresh endpoint.
 */

const axios = require('axios');
const cron = require('node-cron');
const Event = require('../Models/Event');
const s3Service = require('./s3service');
const config = require('../Config');
const logger = require('../Config/logger');

// ── Scheduler ─────────────────────────────────────────────────────────────────

let cronJob = null;

function startScheduler() {
  const minutes = config.ticketmaster.fetchIntervalMinutes;
  // node-cron expression: every N minutes
  const expression = `*/${minutes} * * * *`;

  if (cronJob) cronJob.stop();

  cronJob = cron.schedule(expression, async () => {
    logger.info(`[Scheduler] Running scheduled event fetch (every ${minutes}m)`);
    try {
      await fetchAndStoreEvents();
    } catch (err) {
      logger.error('[Scheduler] Event fetch failed:', err.message);
    }
  });

  logger.info(`[Scheduler] Event fetch scheduled every ${minutes} minutes`);
}

function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    logger.info('[Scheduler] Stopped');
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function fetchAndStoreEvents() {
  if (!config.ticketmaster.apiKey) {
    logger.warn('TICKETMASTER_API_KEY not set — seeding mock events');
    return seedMockEvents();
  }

  let rawEvents;
  try {
    rawEvents = await fetchFromTicketmaster();
  } catch (err) {
    logger.error(`Ticketmaster API error: ${err.message}`);
    return;
  }

  let saved = 0;
  let updated = 0;

  for (const raw of rawEvents) {
    const parsed = parseEvent(raw);
    if (!parsed) continue;

    const existing = await Event.findOne({ externalId: parsed.externalId });

    if (config.storeEventsInS3 && !existing && parsed.imageUrl) {
      try {
        const { key, url } = await s3Service.uploadImageFromUrl(parsed.imageUrl, parsed.externalId);
        parsed.s3ImageKey = key;
        parsed.s3ImageUrl = url;
      } catch (imgErr) {
        logger.warn(`S3 image mirror failed for ${parsed.externalId}: ${imgErr.message}`);
      }
    }

    if (existing) {
      await Event.findOneAndUpdate(
        { externalId: parsed.externalId },
        { $set: { ...parsed, fetchedAt: new Date() } }
      );
      updated++;
    } else {
      await Event.create(parsed);
      saved++;
    }
  }

  logger.info(`Event sync complete — ${saved} new, ${updated} updated`);

  // Optional S3 snapshot
  if (config.storeEventsInS3) {
    try {
      const all = await Event.find({ status: 'active' }).lean();
      await s3Service.storeEventsSnapshot(all);
    } catch (snapErr) {
      logger.warn(`Snapshot failed: ${snapErr.message}`);
    }
  }
}

// ── Ticketmaster API helpers ──────────────────────────────────────────────────

async function fetchFromTicketmaster() {
  const { baseUrl, apiKey, keyword, city, maxEventsPerFetch } = config.ticketmaster;

  const { data } = await axios.get(`${baseUrl}/events.json`, {
    params: {
      apikey: apiKey,
      keyword,
      city,
      size: maxEventsPerFetch,
      sort: 'date,asc',
      classificationName: 'music,arts,sports,family,education',
    },
    timeout: 10000,
  });

  return data?._embedded?.events || [];
}

function parseEvent(raw) {
  try {
    const externalId = raw.id;
    if (!externalId) return null;

    // Dates
    const start = raw.dates?.start || {};
    const dateLocal = start.localDate;
    const timeLocal = start.localTime;
    let eventDate = null;
    if (dateLocal) {
      try {
        eventDate = new Date(timeLocal ? `${dateLocal}T${timeLocal}` : dateLocal);
      } catch (_) {}
    }

    // Venue
    const venues = raw._embedded?.venues || [{}];
    const v = venues[0];
    const venue = {
      name: v.name,
      address: v.address?.line1,
      city: v.city?.name,
      country: v.country?.name,
    };

    // Best image (widest 16:9)
    const images = raw.images || [];
    const imageUrl = pickBestImage(images);

    // Classification
    const cls = raw.classifications?.[0] || {};
    const category = cls.genre?.name || cls.segment?.name || 'General';
    const tags = [cls.segment?.name, cls.genre?.name].filter(Boolean);

    // Price
    const pr = raw.priceRanges?.[0] || {};
    const price = { min: pr.min, max: pr.max, currency: pr.currency };

    return {
      externalId,
      source: 'ticketmaster',
      title: raw.name || 'Untitled Event',
      description: raw.info || raw.pleaseNote || '',
      eventDate,
      eventDateLocal: dateLocal,
      eventTimeLocal: timeLocal,
      venue,
      imageUrl,
      category,
      tags,
      ticketUrl: raw.url,
      price,
      status: 'active',
      fetchedAt: new Date(),
    };
  } catch (err) {
    logger.warn(`Failed to parse event ${raw?.id}: ${err.message}`);
    return null;
  }
}

function pickBestImage(images) {
  if (!images.length) return null;
  const ratio16x9 = images.filter(i => i.ratio === '16_9');
  const pool = ratio16x9.length ? ratio16x9 : images;
  return pool.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
}

// ── Mock data (dev / no API key) ──────────────────────────────────────────────

async function seedMockEvents() {
  const now = Date.now();
  const day = 86400000;

  const mocks = [
    {
      externalId: 'mock-001',
      source: 'mock',
      title: 'Annual Science & Innovation Fair',
      description: 'Showcase your research to faculty, industry partners, and peers across all STEM disciplines.',
      eventDate: new Date(now + 5 * day),
      eventDateLocal: isoDate(now + 5 * day),
      eventTimeLocal: '10:00:00',
      venue: { name: 'University Main Hall', address: '1 Campus Drive', city: 'New York', country: 'United States' },
      imageUrl: 'https://images.unsplash.com/photo-1532094349884-543559fee673?w=800',
      category: 'Education',
      tags: ['science', 'innovation', 'research'],
      status: 'active',
    },
    {
      externalId: 'mock-002',
      source: 'mock',
      title: 'Society Recruitment Drive 2025',
      description: 'Explore over 80 student societies. Find your people, discover new passions, and sign up on the spot.',
      eventDate: new Date(now + 10 * day),
      eventDateLocal: isoDate(now + 10 * day),
      eventTimeLocal: '11:00:00',
      venue: { name: 'Student Union Plaza', city: 'New York', country: 'United States' },
      imageUrl: 'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=800',
      category: 'Social',
      tags: ['societies', 'recruitment', 'clubs'],
      status: 'active',
    },
    {
      externalId: 'mock-003',
      source: 'mock',
      title: 'Spring Music Festival',
      description: 'Live performances from student bands and guest artists across three outdoor stages.',
      eventDate: new Date(now + 20 * day),
      eventDateLocal: isoDate(now + 20 * day),
      eventTimeLocal: '14:00:00',
      venue: { name: 'Campus Amphitheatre', city: 'New York', country: 'United States' },
      imageUrl: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800',
      category: 'Music',
      tags: ['music', 'festival', 'live'],
      status: 'active',
    },
    {
      externalId: 'mock-004',
      source: 'mock',
      title: 'Career Fair – Tech & Finance',
      description: 'Meet recruiters from 120+ top companies. Bring your CV and elevator pitch.',
      eventDate: new Date(now + 3 * day),
      eventDateLocal: isoDate(now + 3 * day),
      eventTimeLocal: '09:00:00',
      venue: { name: 'Business School Atrium', city: 'New York', country: 'United States' },
      imageUrl: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800',
      category: 'Career',
      tags: ['career', 'jobs', 'networking'],
      status: 'active',
    },
    {
      externalId: 'mock-005',
      source: 'mock',
      title: 'Inter-University Hackathon',
      description: '48-hour coding marathon. Form teams, build fast, win prizes. All skill levels welcome.',
      eventDate: new Date(now + 14 * day),
      eventDateLocal: isoDate(now + 14 * day),
      eventTimeLocal: '18:00:00',
      venue: { name: 'Computer Science Building', city: 'New York', country: 'United States' },
      imageUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800',
      category: 'Technology',
      tags: ['hackathon', 'coding', 'competition'],
      status: 'active',
    },
    {
      externalId: 'mock-006',
      source: 'mock',
      title: 'International Food Festival',
      description: 'Taste dishes from 40+ countries, all prepared by international student societies.',
      eventDate: new Date(now + 7 * day),
      eventDateLocal: isoDate(now + 7 * day),
      eventTimeLocal: '12:00:00',
      venue: { name: 'Campus Quad', city: 'New York', country: 'United States' },
      imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800',
      category: 'Social',
      tags: ['food', 'culture', 'international'],
      status: 'active',
    },
  ];

  let added = 0;
  for (const mock of mocks) {
    const exists = await Event.findOne({ externalId: mock.externalId });
    if (!exists) {
      await Event.create(mock);
      added++;
    }
  }
  if (added) logger.info(`Seeded ${added} mock events`);
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

module.exports = { fetchAndStoreEvents, startScheduler, stopScheduler };