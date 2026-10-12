const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../utils/http");
const { validate, z, uuid } = require("../utils/validation");

const router = express.Router();
router.use(authenticate, authorize("RENTER"));

const { saveBooking } = require("../services/schedule");
const createSchema = z.object({
  courtId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  expectedAmount: z.number().int().min(0).optional(),
  note: z.string().trim().max(500).optional(),
});
router.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ booking: await saveBooking(req.body, req.user) });
  }),
);

router.get(
  "/my",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT b.id, b.booking_code, b.starts_at, b.ends_at, b.total_amount::float,
       b.status, b.note, b.owner_note, b.created_at,
       c.name AS court_name, c.sport_type, v.id AS venue_id, v.name AS venue_name, v.address
     FROM bookings b JOIN courts c ON c.id = b.court_id JOIN venues v ON v.id = c.venue_id
     WHERE b.renter_id = $1 ORDER BY b.starts_at DESC`,
      [req.user.sub],
    );
    res.json({ items: result.rows });
  }),
);

router.patch(
  "/:id/cancel",
  validate(z.object({ id: uuid }), "params"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now()
     WHERE id = $1 AND renter_id = $2 AND status IN ('PENDING', 'CONFIRMED') AND starts_at > now()
     RETURNING id, booking_code, status`,
      [req.params.id, req.user.sub],
    );
    if (!result.rows[0]) throw new ApiError(409, "Lịch đặt không thể hủy");
    res.json({ booking: result.rows[0] });
  }),
);

module.exports = router;
