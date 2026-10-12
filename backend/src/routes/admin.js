const express = require("express");
const { pool } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../utils/http");
const { validate, z, uuid } = require("../utils/validation");

const { venueDetail } = require("../services/schedule");
const router = express.Router();
router.use(authenticate, authorize("ADMIN"));

router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM venues) AS venues,
      (SELECT COUNT(*)::int FROM venues WHERE status='PENDING') AS pending_venues,
      (SELECT COUNT(*)::int FROM bookings) AS bookings,
      (SELECT COALESCE(SUM(total_amount),0)::float FROM bookings WHERE status IN ('CONFIRMED','COMPLETED') AND source <> 'BLOCK') AS gross_revenue
  `);
    res.json({ stats: result.rows[0] });
  }),
);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = `%${String(req.query.q || "")}%`;
    const result = await pool.query(
      `SELECT id, full_name, email, phone, role, status, created_at
     FROM users WHERE full_name ILIKE $1 OR email ILIKE $1 ORDER BY created_at DESC LIMIT 200`,
      [q],
    );
    res.json({ items: result.rows });
  }),
);

router.patch(
  "/users/:id/status",
  validate(z.object({ id: uuid }), "params"),
  validate(z.object({ status: z.enum(["ACTIVE", "BLOCKED"]) })),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.sub)
      throw new ApiError(400, "Không thể khóa tài khoản của chính mình");
    const result = await pool.query(
      "UPDATE users SET status=$1 WHERE id=$2 RETURNING id, full_name, email, role, status",
      [req.body.status, req.params.id],
    );
    if (!result.rows[0]) throw new ApiError(404, "Không tìm thấy người dùng");
    res.json({ user: result.rows[0] });
  }),
);

router.get(
  "/venues",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT v.id, v.name, v.address, v.district, v.city, v.status, v.created_at,
      u.full_name AS owner_name, u.email AS owner_email, COUNT(c.id)::int AS court_count
     FROM venues v JOIN users u ON u.id=v.owner_id LEFT JOIN courts c ON c.venue_id=v.id
     WHERE ($1 = '' OR v.status::text=$1) GROUP BY v.id,u.id ORDER BY v.created_at DESC`,
      [String(req.query.status || "")],
    );
    res.json({ items: result.rows });
  }),
);

router.get(
  "/venues/:id",
  validate(z.object({ id: uuid }), "params"),
  asyncHandler(async (req, res) =>
    res.json(await venueDetail(req.params.id, null, true)),
  ),
);
router.patch(
  "/venues/:id/status",
  validate(z.object({ id: uuid }), "params"),
  validate(
    z.object({
      status: z.enum(["ACTIVE", "REJECTED", "INACTIVE"]),
      reviewNote: z.string().trim().max(1000).default(""),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.status === "REJECTED" && !req.body.reviewNote)
      throw new ApiError(400, "Nhập lý do từ chối");
    const result = await pool.query(
      `UPDATE venues SET status=$1::venue_status,review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 AND
    (($1::text IN ('ACTIVE','REJECTED') AND status='PENDING') OR ($1::text='INACTIVE' AND status='ACTIVE') OR ($1::text='ACTIVE' AND status='INACTIVE')) RETURNING *`,
      [
        req.body.status,
        req.body.reviewNote || null,
        req.user.sub,
        req.params.id,
      ],
    );
    if (!result.rowCount)
      throw new ApiError(409, "Trạng thái đã thay đổi; hãy tải lại danh sách");
    res.json({ venue: result.rows[0] });
  }),
);
module.exports = router;
