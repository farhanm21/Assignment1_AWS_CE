import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import './EventCard.css';

const CATEGORY_COLORS = {
  Music: '#a78bfa',
  Technology: '#38bdf8',
  Career: '#fbbf24',
  Education: '#6ee7b7',
  Social: '#fb7185',
  Sports: '#f97316',
  Arts: '#e879f9',
  General: '#94a3b8',
};

function formatDate(dateStr) {
  try {
    if (!dateStr) return 'TBD';
    const d =
      typeof dateStr === 'string'
        ? parseISO(dateStr)
        : new Date(dateStr);
    return format(d, 'EEE, MMM d · h:mm a');
  } catch {
    return dateStr || 'TBD';
  }
}

export default function EventCard({ event, delay = 0 }) {
  const [imgErr, setImgErr] = useState(false);

  // ✅ Guard against undefined event
  if (!event) return null;

  // ✅ Safe access
  const color =
    CATEGORY_COLORS[event?.category] || CATEGORY_COLORS.General;

  return (
    <article
      className="event-card animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link
        to={`/events/${event?.id}`}
        className="event-card__image-wrap"
      >
        {event?.image_url && !imgErr ? (
          <img
            src={event.image_url}
            alt={event?.title || 'Event'}
            className="event-card__image"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="event-card__image-placeholder">
            <span>{event?.title?.charAt(0) || '✦'}</span>
          </div>
        )}

        <span
          className="event-card__category"
          style={{ '--cat-color': color }}
        >
          {event?.category || 'General'}
        </span>
      </Link>

      <div className="event-card__body">
        <p className="event-card__date">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {formatDate(event?.event_date)}
        </p>

        <h3 className="event-card__title">
          <Link to={`/events/${event?.id}`}>
            {event?.title || 'Untitled Event'}
          </Link>
        </h3>

        {event?.venue?.name && (
          <p className="event-card__venue">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {event.venue.name}
            {event.venue.city ? `, ${event.venue.city}` : ''}
          </p>
        )}

        <div className="event-card__footer">
          {event?.price?.min ? (
            <span className="event-card__price">
              From {event?.price?.currency || '$'}
              {event?.price?.min}
            </span>
          ) : (
            <span className="event-card__price event-card__price--free">
              Free
            </span>
          )}

          <Link
            to={`/events/${event?.id}`}
            className="event-card__link"
          >
            View →
          </Link>
        </div>
      </div>
    </article>
  );
}