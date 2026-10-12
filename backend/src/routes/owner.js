const express = require("express");
const { pool, withTransaction } = require("../db");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../utils/http");
const { validate, z, uuid, time, date } = require("../utils/validation");
const {
  minutes,
  venueDetail,
  schedule,
  lockedCourt,
  saveBooking,
} = require("../services/schedule");
const router = express.Router();
router.use(authenticate, authorize("OWNER"));
const slotTime = time.refine(
  (v) => minutes(v) % 30 === 0,
  "Giờ phải theo bước 30 phút",
);
const image = z.union([
  z.string().url()
    .refine((v) => /^https?:\/\//i.test(v), "Dùng URL HTTP/HTTPS"),
  z.string().regex(
    /^\/api\/images\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/,
    "Đường dẫn ảnh không hợp lệ",
  ),
  z.literal(""),
]).optional();
const venueSchema = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
  address: z.string().trim().min(5).max(255),
  ward: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).default(""),
  city: z.string().trim().min(2).max(100),
  imageUrl: image,
  amenities: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  openTime: slotTime,
  closeTime: slotTime,
});
const ruleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  startTime: slotTime,
  endTime: slotTime,
  pricePerHour: z.coerce.number().int().min(0).max(100000000),
});
const courtSchema = z.object({
  name: z.string().trim().min(2).max(100),
  sportType: z.string().trim().min(2).max(60),
  surface: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  imageUrl: image,
  pricePerHour: z.coerce.number().int().min(0).max(100000000),
  active: z.boolean().default(true),
  pricingRules: z.array(ruleSchema).max(50).default([]),
imageUrls: z.array(
  z.union([
    z.string().url().refine(
      (v) => /^https?:\/\//i.test(v),
      "URL ảnh phải dùng HTTP/HTTPS",
    ),
    z.string().regex(
      /^\/api\/images\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i,
      "Đường dẫn ảnh không hợp lệ",
    ),
  ]),
).max(10).optional(),
});
function courtImages(body) {
  return body.imageUrls ?? (body.imageUrl ? [body.imageUrl] : []);
}
const manualSchema = z
  .object({
    courtId: uuid,
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    source: z.enum(["WALK_IN", "BLOCK"]),
    guestName: z.string().trim().max(120).optional(),
    guestPhone: z.string().trim().max(20).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.source === "BLOCK" || Boolean(v.guestName), {
    message: "Nhập tên khách thuê trực tiếp",
    path: ["guestName"],
  });
function checkHours(body) {
  if (minutes(body.openTime) >= minutes(body.closeTime))
    throw new ApiError(400, "Giờ đóng cửa phải sau giờ mở cửa trong cùng ngày");
}
function checkRules(rules, venue) {
  for (const [i, r] of rules.entries()) {
    if (
      minutes(r.startTime) >= minutes(r.endTime) ||
      minutes(r.startTime) < minutes(venue.open_time) ||
      minutes(r.endTime) > minutes(venue.close_time)
    )
      throw new ApiError(400, "Khung giá phải nằm trong giờ mở cửa");
    if (
      rules
        .slice(0, i)
        .some(
          (p) =>
            p.dayOfWeek === r.dayOfWeek &&
            minutes(p.startTime) < minutes(r.endTime) &&
            minutes(p.endTime) > minutes(r.startTime),
        )
    )
      throw new ApiError(400, "Các khung giá cùng ngày không được chồng nhau");
  }
}
async function saveRules(client, id, rules) {
  await client.query("DELETE FROM pricing_rules WHERE court_id=$1", [id]);
  for (const r of rules)
    await client.query(
      "INSERT INTO pricing_rules(court_id,day_of_week,start_time,end_time,price_per_hour) VALUES($1,$2,$3,$4,$5)",
      [id, r.dayOfWeek, r.startTime, r.endTime, r.pricePerHour],
    );
}
async function insertCourt(client, venue, body) {
  checkRules(body.pricingRules, venue);
const urls = courtImages(body);

const c = await client.query(
  `INSERT INTO courts
   (venue_id, name, sport_type, surface, price_per_hour,
    image_url, image_urls, description, active)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
   RETURNING *`,
  [
    venue.id,
    body.name,
    body.sportType,
    body.surface || null,
    body.pricePerHour,
    urls[0] || null,
    urls,
    body.description || null,
    body.active,
  ],
);
  await saveRules(client, c.rows[0].id, body.pricingRules);
  return c.rows[0];
}
router.get(
  "/venues",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT v.*,COUNT(c.id)::int AS court_count,COALESCE(MIN(c.price_per_hour)::float,0) AS min_price FROM venues v LEFT JOIN courts c ON c.venue_id=v.id WHERE v.owner_id=$1 GROUP BY v.id ORDER BY v.created_at DESC`,
      [req.user.sub],
    );
    res.json({ items: result.rows });
  }),
);
router.get(
  "/venues/:id",
  validate(z.object({ id: uuid }), "params"),
  asyncHandler(async (req, res) =>
    res.json(await venueDetail(req.params.id, req.user.sub)),
  ),
);
router.get(
  "/venues/:id/availability",
  validate(z.object({ id: uuid }), "params"),
  validate(z.object({ date }), "query"),
  asyncHandler(async (req, res) =>
    res.json(await schedule(req.params.id, req.query.date, req.user.sub)),
  ),
);
router.post(
  "/venues",
  validate(venueSchema.extend({ courts: z.array(courtSchema).min(1).max(30) })),
  asyncHandler(async (req, res) => {
    checkHours(req.body);
    const venue = await withTransaction(async (client) => {
      const b = req.body;
      const result = await client.query(
        `INSERT INTO venues(owner_id,name,description,address,ward,district,city,image_url,amenities,open_time,close_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          req.user.sub,
          b.name,
          b.description || null,
          b.address,
          b.ward || null,
          b.district,
          b.city,
          b.imageUrl || null,
          b.amenities,
          b.openTime,
          b.closeTime,
        ],
      );
      for (const c of b.courts) await insertCourt(client, result.rows[0], c);
      return result.rows[0];
    });
    res.status(201).json({ venue });
  }),
);
// Core venue edits go back to review; existing bookings are preserved.
router.put(
  "/venues/:id",
  validate(z.object({ id: uuid }), "params"),
  validate(venueSchema),
  asyncHandler(async (req, res) => {
    checkHours(req.body);
    const venue = await withTransaction(async (client) => {
      const v = await client.query(
        "SELECT * FROM venues WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [req.params.id, req.user.sub],
      );
      if (!v.rows[0]) throw new ApiError(404, "Không tìm thấy cụm sân");
      await client.query(
        "SELECT id FROM courts WHERE venue_id=$1 ORDER BY id FOR UPDATE",
        [req.params.id],
      );
      const rules = await client.query(
        "SELECT p.* FROM pricing_rules p JOIN courts c ON c.id=p.court_id WHERE c.venue_id=$1",
        [req.params.id],
      );
      if (
        rules.rows.some(
          (r) =>
            minutes(r.start_time) < minutes(req.body.openTime) ||
            minutes(r.end_time) > minutes(req.body.closeTime),
        )
      )
        throw new ApiError(400, "Giờ mới phải bao gồm các khung giá hiện có");
      const b = req.body;
const result = await client.query(
  `UPDATE venues
   SET name=$1,
       description=$2,
       address=$3,
       ward=$4,
       city=$5,
       image_url=$6,
       amenities=$7,
       open_time=$8,
       close_time=$9,
       status='PENDING',
       review_note=NULL,
       reviewed_by=NULL,
       reviewed_at=NULL
   WHERE id=$10 AND owner_id=$11
   RETURNING *`,
  [
    b.name,
    b.description || null,
    b.address,
    b.ward || null,
    b.city,
    b.imageUrl || null,
    b.amenities,
    b.openTime,
    b.closeTime,
    req.params.id,
    req.user.sub,
  ],
);
return result.rows[0];
    });
    res.json({ venue });
  }),
);
router.post(
  "/venues/:id/resubmit",
  validate(z.object({ id: uuid }), "params"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "UPDATE venues SET status='PENDING',review_note=NULL,reviewed_at=NULL,reviewed_by=NULL WHERE id=$1 AND owner_id=$2 AND status='REJECTED' RETURNING *",
      [req.params.id, req.user.sub],
    );
    if (!result.rowCount)
      throw new ApiError(409, "Chỉ gửi lại cụm sân đã bị từ chối");
    res.json({ venue: result.rows[0] });
  }),
);
router.post(
  "/venues/:id/courts",
  validate(z.object({ id: uuid }), "params"),
  validate(courtSchema),
  asyncHandler(async (req, res) => {
    const court = await withTransaction(async (client) => {
      const v = await client.query(
        "SELECT * FROM venues WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [req.params.id, req.user.sub],
      );
      if (!v.rows[0]) throw new ApiError(404, "Không tìm thấy cụm sân");
      return insertCourt(client, v.rows[0], req.body);
    });
    res.status(201).json({ court });
  }),
);
router.put(
  "/courts/:id",
  validate(z.object({ id: uuid }), "params"),
  validate(courtSchema),
  asyncHandler(async (req, res) => {
    const court = await withTransaction(async (client) => {
      const c = await lockedCourt(client, req.params.id, req.user.sub, false);
      checkRules(req.body.pricingRules, c);
      const b = req.body;
const urls = courtImages(b);

const result = await client.query(
  `UPDATE courts
   SET name=$1,
       sport_type=$2,
       surface=$3,
       price_per_hour=$4,
       image_url=$5,
       image_urls=$6,
       description=$7,
       active=$8
   WHERE id=$9
   RETURNING *`,
  [
    b.name,
    b.sportType,
    b.surface || null,
    b.pricePerHour,
    urls[0] || null,
    urls,
    b.description || null,
    b.active,
    c.id,
  ],
);
      await saveRules(client, c.id, b.pricingRules);
      return result.rows[0];
    });
    res.json({ court });
  }),
);
router.post(
  "/manual-bookings",
  validate(manualSchema),
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json({ booking: await saveBooking(req.body, req.user, true) }),
  ),
);
router.put(
  "/manual-bookings/:id",
  validate(z.object({ id: uuid }), "params"),
  validate(manualSchema),
  asyncHandler(async (req, res) =>
    res.json({
      booking: await saveBooking(req.body, req.user, true, req.params.id),
    }),
  ),
);
router.patch(
  "/manual-bookings/:id/cancel",
  validate(z.object({ id: uuid }), "params"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE bookings b SET status='CANCELLED',cancelled_at=now() FROM courts c,venues v WHERE b.id=$1 AND b.court_id=c.id AND c.venue_id=v.id AND v.owner_id=$2 AND b.source<>'ONLINE' AND b.status='CONFIRMED' RETURNING b.*`,
      [req.params.id, req.user.sub],
    );
    if (!result.rowCount) throw new ApiError(409, "Không thể hủy lịch này");
    res.json({ booking: result.rows[0] });
  }),
);
router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT b.*,b.total_amount::float,COALESCE(u.full_name,b.guest_name,'Khóa lịch') AS renter_name,COALESCE(u.phone,b.guest_phone) AS renter_phone,c.name AS court_name,c.sport_type,v.name AS venue_name FROM bookings b LEFT JOIN users u ON u.id=b.renter_id JOIN courts c ON c.id=b.court_id JOIN venues v ON v.id=c.venue_id WHERE v.owner_id=$1 AND ($2='' OR b.status::text=$2) ORDER BY b.starts_at DESC LIMIT 200`,
      [req.user.sub, String(req.query.status || "")],
    );
    res.json({ items: result.rows });
  }),
);
router.patch(
  "/bookings/:id/status",
  validate(z.object({ id: uuid }), "params"),
  validate(
    z.object({
      status: z.enum(["CONFIRMED", "REJECTED"]),
      ownerNote: z.string().trim().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE bookings b SET status=$1,owner_note=$2 FROM courts c,venues v WHERE b.id=$3 AND b.court_id=c.id AND c.venue_id=v.id AND v.owner_id=$4 AND b.status='PENDING' RETURNING b.*`,
      [
        req.body.status,
        req.body.ownerNote || null,
        req.params.id,
        req.user.sub,
      ],
    );
    if (!result.rowCount)
      throw new ApiError(409, "Yêu cầu đã được xử lý hoặc không tồn tại");
    res.json({ booking: result.rows[0] });
  }),
);
router.get(
  "/revenue",
  asyncHandler(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
    const [summary, monthly] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(b.total_amount) FILTER(WHERE b.status IN ('CONFIRMED','COMPLETED') AND b.source<>'BLOCK'),0)::float AS revenue,COUNT(*) FILTER(WHERE b.source<>'BLOCK')::int AS bookings,COUNT(*) FILTER(WHERE b.status='PENDING')::int AS pending FROM bookings b JOIN courts c ON c.id=b.court_id JOIN venues v ON v.id=c.venue_id WHERE v.owner_id=$1`,
        [req.user.sub],
      ),
      pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('month',b.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM') AS month,SUM(b.total_amount)::float AS revenue,COUNT(*)::int AS bookings FROM bookings b JOIN courts c ON c.id=b.court_id JOIN venues v ON v.id=c.venue_id WHERE v.owner_id=$1 AND b.status IN ('CONFIRMED','COMPLETED') AND b.source<>'BLOCK' AND b.starts_at>=DATE_TRUNC('month',now())-($2-1)*INTERVAL '1 month' GROUP BY 1 ORDER BY 1`,
        [req.user.sub, months],
      ),
    ]);
    res.json({ summary: summary.rows[0], monthly: monthly.rows });
  }),
);
module.exports = router;
