const mongoose = require('mongoose');

const venueSchema = new mongoose.Schema(
  {
    name: String,
    address: String,
    city: String,
    country: String,
  },
  { _id: false }
);

const priceSchema = new mongoose.Schema(
  {
    min: Number,
    max: Number,
    currency: { type: String, default: 'USD' },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    // Identity
    externalId: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: 'ticketmaster', enum: ['ticketmaster', 'mock', 'manual'] },

    // Core fields
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    eventDate: { type: Date, index: true },
    eventDateLocal: String,
    eventTimeLocal: String,

    // Location
    venue: { type: venueSchema, default: {} },

    // Media
    imageUrl: String,       // original URL from API
    s3ImageKey: String,     // S3 object key if mirrored
    s3ImageUrl: String,     // served S3 / CloudFront URL

    // Classification
    category: { type: String, default: 'General', index: true },
    tags: [{ type: String }],

    // Ticket info
    ticketUrl: String,
    price: { type: priceSchema, default: {} },

    // Lifecycle
    status: { type: String, default: 'active', enum: ['active', 'cancelled', 'postponed'] },
    fetchedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,  // createdAt + updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Compound indexes for common queries ───────────────────────────────────────
eventSchema.index({ status: 1, eventDate: 1 });
eventSchema.index({ status: 1, category: 1 });
eventSchema.index({ title: 'text', description: 'text', tags: 'text' });

// ── Virtual: resolved image (prefer S3, fall back to original URL) ────────────
eventSchema.virtual('resolvedImageUrl').get(function () {
  return this.s3ImageUrl || this.imageUrl || null;
});

// ── Instance method: clean public representation ──────────────────────────────
eventSchema.methods.toPublic = function () {
  return {
    id: this._id,
    externalId: this.externalId,
    source: this.source,
    title: this.title,
    description: this.description,
    eventDate: this.eventDate,
    eventDateLocal: this.eventDateLocal,
    eventTimeLocal: this.eventTimeLocal,
    venue: this.venue,
    imageUrl: this.resolvedImageUrl,
    category: this.category,
    tags: this.tags,
    ticketUrl: this.ticketUrl,
    price: this.price,
    status: this.status,
    fetchedAt: this.fetchedAt,
    createdAt: this.createdAt,
  };
};

// ── Static: upsert helper ─────────────────────────────────────────────────────
eventSchema.statics.upsertFromExternal = async function (data) {
  return this.findOneAndUpdate(
    { externalId: data.externalId },
    { $set: data },
    { upsert: true, new: true, runValidators: true }
  );
};

const Event = mongoose.model('Event', eventSchema);
module.exports = Event;