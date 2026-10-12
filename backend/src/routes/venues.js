const express = require("express");
const { pool } = require("../db");
const { asyncHandler, ApiError } = require("../utils/http");
const { validate, z, uuid, time, date } = require("../utils/validation");
const {
  venueDetail,
  schedule,
  validDate,
  rangeInfo,
  priceQuote,
} = require("../services/schedule");

const router = express.Router();

const querySchema = z.object({
  q: z.string().trim().max(100).default(""),
  city: z.string().trim().max(100).default(""),
  ward: z.string().trim().max(100).default(""),
  sport: z.string().trim().max(60).default(""),
  date: date.optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

// Tìm từng sân thay vì gộp kết quả theo cụm sân.
router.get(
  "/courts",
  validate(querySchema, "query"),
  asyncHandler(async (req, res) => {
    const {
      q,
      city,
      ward,
      sport,
      date: d,
      startTime,
      endTime,
      page,
      limit,
    } = req.query;

    if (d && !validDate(d)) {
      throw new ApiError(400, "Ngày không hợp lệ");
    }

    if (Boolean(startTime) !== Boolean(endTime) || (startTime && !d)) {
      throw new ApiError(
        400,
        "Chọn ngày, giờ bắt đầu và kết thúc cùng nhau",
      );
    }

    const from = startTime ? `${d}T${startTime}:00+07:00` : null;
    const to = endTime ? `${d}T${endTime}:00+07:00` : null;

    if (from) rangeInfo(from, to);

    const params = [
      `%${q}%`,
      `%${city}%`,
      `%${ward}%`,
      `%${sport}%`,
      from,
      to,
      startTime || null,
      endTime || null,
    ];

    const where = `
      v.status='ACTIVE'
      AND c.active
      AND (
        v.name ILIKE $1
        OR c.name ILIKE $1
        OR v.address ILIKE $1
      )
      AND v.city ILIKE $2
      AND COALESCE(v.ward, '') ILIKE $3
      AND c.sport_type ILIKE $4
      AND (
        $5::timestamptz IS NULL
        OR (
          v.open_time <= $7::time
          AND v.close_time >= $8::time
          AND NOT EXISTS (
            SELECT 1
            FROM bookings b
            WHERE b.court_id = c.id
              AND b.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
              AND b.starts_at < $6::timestamptz
              AND b.ends_at > $5::timestamptz
          )
        )
      )
    `;

    const result = await pool.query(
      `
        SELECT
          c.*,
          c.price_per_hour::float,
          v.id AS venue_id,
          v.name AS venue_name,
          v.address,
          v.ward,
          v.city,
          v.amenities,
          v.open_time,
          v.close_time,
          COALESCE(c.image_url, v.image_url) AS image_url
        FROM courts c
        JOIN venues v ON v.id = c.venue_id
        WHERE ${where}
        ORDER BY v.name, c.name
        LIMIT $9 OFFSET $10
      `,
      [...params, limit, (page - 1) * limit],
    );

    const count = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM courts c
        JOIN venues v ON v.id = c.venue_id
        WHERE ${where}
      `,
      params,
    );

    const items = await Promise.all(
      result.rows.map(async (court) => ({
        ...court,
        ...(from
          ? { quote: await priceQuote(court.id, from, to) }
          : {}),
      })),
    );

    res.json({
      items,
      pagination: {
        page,
        limit,
        total: count.rows[0].total,
      },
      requestedRange: from
        ? { startsAt: from, endsAt: to }
        : null,
    });
  }),
);

// Giữ API danh sách cụm sân cũ để tương thích.
router.get(
  "/",
  validate(querySchema, "query"),
  asyncHandler(async (req, res) => {
    const { q, city, ward, sport, page, limit } = req.query;

    const params = [
      `%${q}%`,
      `%${city}%`,
      `%${ward}%`,
      `%${sport}%`,
    ];

    const where = `
      v.status='ACTIVE'
      AND (v.name ILIKE $1 OR v.address ILIKE $1)
      AND v.city ILIKE $2
      AND COALESCE(v.ward, '') ILIKE $3
      AND EXISTS (
        SELECT 1
        FROM courts sc
        WHERE sc.venue_id = v.id
          AND sc.active
          AND sc.sport_type ILIKE $4
      )
    `;

    const result = await pool.query(
      `
        SELECT
          v.*,
          MIN(c.price_per_hour)::float AS min_price,
          ARRAY_AGG(DISTINCT c.sport_type) AS sports,
          COUNT(c.id)::int AS court_count
        FROM venues v
        JOIN courts c ON c.venue_id = v.id AND c.active
        WHERE ${where}
        GROUP BY v.id
        ORDER BY v.created_at DESC
        LIMIT $5 OFFSET $6
      `,
      [...params, limit, (page - 1) * limit],
    );

    const count = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM venues v
        WHERE ${where}
      `,
      params,
    );

    res.json({
      items: result.rows,
      pagination: {
        page,
        limit,
        total: count.rows[0].total,
      },
    });
  }),
);

router.get(
  "/courts/:id/quote",
  validate(z.object({ id: uuid }), "params"),
  validate(
    z.object({
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
    }),
    "query",
  ),
  asyncHandler(async (req, res) =>
    res.json(
      await priceQuote(
        req.params.id,
        req.query.startsAt,
        req.query.endsAt,
      ),
    ),
  ),
);

router.get(
  "/:id",
  validate(z.object({ id: uuid }), "params"),
  asyncHandler(async (req, res) =>
    res.json(await venueDetail(req.params.id)),
  ),
);

router.get(
  "/:id/availability",
  validate(z.object({ id: uuid }), "params"),
  validate(z.object({ date }), "query"),
  asyncHandler(async (req, res) =>
    res.json(await schedule(req.params.id, req.query.date)),
  ),
);

module.exports = router;
