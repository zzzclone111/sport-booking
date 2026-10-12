const { pool, withTransaction } = require("../db");
const { ApiError } = require("../utils/http");
const crypto = require("node:crypto");
const TZ = "Asia/Ho_Chi_Minh";
const occupiedStatuses = ["PENDING", "CONFIRMED", "COMPLETED"];
const minutes = (time) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeString = (minute) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
function localParts(value) {
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime()))
    throw new ApiError(400, "Thời gian không hợp lệ");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(dt)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    second: Number(parts.second),
    dt,
  };
}
function validDate(date) {
  const d = new Date(`${date}T00:00:00+07:00`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(d.getTime()) &&
    localParts(d).date === date
  );
}
function rangeInfo(startsAt, endsAt, allowPast = false) {
  const start = localParts(startsAt),
    end = localParts(endsAt);
  const duration = (end.dt - start.dt) / 60000;
  if (start.date !== end.date || duration < 30 || duration > 480)
    throw new ApiError(400, "Chọn từ 30 phút đến 8 giờ trong cùng ngày");
  if (
    start.minute % 30 ||
    end.minute % 30 ||
    start.second ||
    end.second ||
    start.dt.getMilliseconds() ||
    end.dt.getMilliseconds()
  )
    throw new ApiError(400, "Khung giờ phải theo bước 30 phút");
  if (!allowPast && start.dt <= new Date())
    throw new ApiError(400, "Chỉ có thể đặt lịch trong tương lai");
  return { start, end, duration };
}
function rateAt(court, rules, day, minute) {
  const applicable = rules.filter(
    (r) =>
      (r.day_of_week === null || Number(r.day_of_week) === day) &&
      minutes(r.start_time) <= minute &&
      minutes(r.end_time) > minute,
  );
  applicable.sort(
    (a, b) =>
      (a.day_of_week === null ? 1 : 0) - (b.day_of_week === null ? 1 : 0),
  );
  return Number(applicable[0]?.price_per_hour ?? court.price_per_hour);
}
function quote(court, rules, startsAt, endsAt, allowPast = false) {
  const range = rangeInfo(startsAt, endsAt, allowPast);
  if (
    range.start.minute < minutes(court.open_time) ||
    range.end.minute > minutes(court.close_time)
  )
    throw new ApiError(400, "Khung giờ nằm ngoài giờ mở cửa");
  const day = new Date(`${range.start.date}T12:00:00+07:00`).getUTCDay();
  const segments = [];
  for (let m = range.start.minute; m < range.end.minute; m += 30) {
    const rate = rateAt(court, rules, day, m);
    segments.push({
      startTime: timeString(m),
      endTime: timeString(m + 30),
      pricePerHour: rate,
      amount: rate / 2,
    });
  }
  return {
    totalAmount: Math.round(segments.reduce((s, r) => s + r.amount, 0)),
    durationHours: range.duration / 60,
    segments,
  };
}
function buildSlots(court, rules, bookings, date) {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  const slots = [];
  for (
    let m = minutes(court.open_time);
    m + 30 <= minutes(court.close_time);
    m += 30
  ) {
    const startsAt = `${date}T${timeString(m)}:00+07:00`;
    const endsAt = `${date}T${timeString(m + 30)}:00+07:00`;
    const b = bookings.find(
      (b) =>
        new Date(b.starts_at) < new Date(endsAt) &&
        new Date(b.ends_at) > new Date(startsAt),
    );
    const past = new Date(startsAt) <= new Date();
    slots.push({
      startTime: timeString(m),
      endTime: timeString(m + 30),
      startsAt,
      endsAt,
      status: b
        ? b.source === "BLOCK"
          ? "BLOCKED"
          : b.status
        : past
          ? "PAST"
          : "AVAILABLE",
      pricePerHour: rateAt(court, rules, day, m),
      bookingId: b?.id || null,
    });
  }
  return slots;
}
async function venueDetail(id, ownerId = null, admin = false) {
  const v = await pool.query(
    `SELECT v.*,u.full_name AS owner_name,u.email AS owner_email FROM venues v JOIN users u ON u.id=v.owner_id
    WHERE v.id=$1 AND ($2::uuid IS NOT NULL AND v.owner_id=$2 OR $3::boolean OR $2::uuid IS NULL AND v.status='ACTIVE')`,
    [id, ownerId, admin],
  );
  if (!v.rows[0]) throw new ApiError(404, "Không tìm thấy cụm sân");
  const cs = await pool.query(
    `SELECT *,price_per_hour::float FROM courts WHERE venue_id=$1 ${ownerId || admin ? "" : "AND active"} ORDER BY sport_type,name`,
    [id],
  );
  const rules = await pool.query(
    `SELECT p.*,p.price_per_hour::float FROM pricing_rules p JOIN courts c ON c.id=p.court_id WHERE c.venue_id=$1 ORDER BY p.day_of_week NULLS FIRST,p.start_time`,
    [id],
  );
  if (!ownerId && !admin) delete v.rows[0].owner_email;
  return {
    ...v.rows[0],
    courts: cs.rows.map((c) => ({
      ...c,
      pricingRules: rules.rows.filter((r) => r.court_id === c.id),
    })),
  };
}
async function schedule(id, date, ownerId = null) {
  if (!validDate(date)) throw new ApiError(400, "Ngày không hợp lệ");
  const venue = await venueDetail(id, ownerId);
  const from = `${date}T00:00:00+07:00`,
    until = new Date(new Date(from).getTime() + 86400000).toISOString();
  const bs = await pool.query(
    `SELECT b.*,u.full_name AS renter_name FROM bookings b JOIN courts c ON c.id=b.court_id
    LEFT JOIN users u ON u.id=b.renter_id WHERE c.venue_id=$1 AND b.starts_at<$3 AND b.ends_at>$2
    AND b.status IN ('PENDING','CONFIRMED','COMPLETED') ORDER BY b.starts_at`,
    [id, from, until],
  );
  return {
    date,
    timeZone: TZ,
    venue: {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      status: venue.status,
      open_time: venue.open_time,
      close_time: venue.close_time,
    },
    courts: venue.courts.map((c) => {
      const records = bs.rows.filter((b) => b.court_id === c.id);
      return {
        ...c,
        slots: buildSlots(
          { ...c, open_time: venue.open_time, close_time: venue.close_time },
          c.pricingRules,
          records,
          date,
        ),
        occupied: records.map((b) =>
          ownerId
            ? { ...b, total_amount: Number(b.total_amount) }
            : {
                starts_at: b.starts_at,
                ends_at: b.ends_at,
                status: b.status,
                source: b.source,
              },
        ),
      };
    }),
  };
}
async function lockedCourt(client, id, ownerId = null, publicOnly = true) {
  const result = await client.query(
    `SELECT c.*,v.open_time,v.close_time,v.status AS venue_status,v.owner_id FROM courts c
    JOIN venues v ON v.id=c.venue_id WHERE c.id=$1 FOR UPDATE OF c`,
    [id],
  );
  const court = result.rows[0];
  if (!court || (ownerId && court.owner_id !== ownerId))
    throw new ApiError(404, "Không tìm thấy sân");
  if (publicOnly && (!court.active || court.venue_status !== "ACTIVE"))
    throw new ApiError(409, "Sân chưa hoạt động hoặc chưa được kiểm duyệt");
  return court;
}
async function priceQuote(id, startsAt, endsAt) {
  const c = await pool.query(
    `SELECT c.*,v.open_time,v.close_time FROM courts c JOIN venues v ON v.id=c.venue_id
    WHERE c.id=$1 AND c.active AND v.status='ACTIVE'`,
    [id],
  );
  if (!c.rows[0]) throw new ApiError(404, "Không tìm thấy sân");
  const rules = await pool.query(
    "SELECT * FROM pricing_rules WHERE court_id=$1",
    [id],
  );
  return quote(c.rows[0], rules.rows, startsAt, endsAt);
}
async function saveBooking(body, user, manual = false, editId = null) {
  return withTransaction(async (client) => {
    const court = await lockedCourt(
      client,
      body.courtId,
      manual ? user.sub : null,
    );
    const rules = await client.query(
      "SELECT * FROM pricing_rules WHERE court_id=$1",
      [court.id],
    );
    const pricing = quote(
      court,
      rules.rows,
      body.startsAt,
      body.endsAt,
      manual,
    );
    if (
      !manual &&
      body.expectedAmount != null &&
      body.expectedAmount !== pricing.totalAmount
    ) {
      throw new ApiError(
        409,
        "Giá vừa thay đổi, vui lòng chọn lại khung giờ và xác nhận giá mới",
      );
    }
    const source = manual ? body.source : "ONLINE";
    const amount = source === "BLOCK" ? 0 : pricing.totalAmount;
    const code = `SH${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    let result;
    if (editId) {
      result = await client.query(
        `UPDATE bookings SET starts_at=$1,ends_at=$2,total_amount=$3,guest_name=$4,guest_phone=$5,note=$6,source=$7
        WHERE id=$8 AND court_id=$9 AND source<>'ONLINE' AND status='CONFIRMED' RETURNING *`,
        [
          body.startsAt,
          body.endsAt,
          amount,
          body.guestName || null,
          body.guestPhone || null,
          body.note || null,
          source,
          editId,
          court.id,
        ],
      );
      if (!result.rowCount)
        throw new ApiError(
          409,
          "Chỉ được sửa lịch nhập thủ công đang hoạt động",
        );
    } else {
      result = await client.query(
        `INSERT INTO bookings (booking_code,renter_id,court_id,starts_at,ends_at,total_amount,status,note,source,guest_name,guest_phone,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          code,
          manual ? null : user.sub,
          court.id,
          body.startsAt,
          body.endsAt,
          amount,
          manual ? "CONFIRMED" : "PENDING",
          body.note || null,
          source,
          body.guestName || null,
          body.guestPhone || null,
          user.sub,
        ],
      );
    }
    return { ...result.rows[0], total_amount: amount, pricing };
  });
}
module.exports = {
  TZ,
  minutes,
  timeString,
  validDate,
  rangeInfo,
  rateAt,
  quote,
  buildSlots,
  venueDetail,
  schedule,
  lockedCourt,
  priceQuote,
  saveBooking,
  occupiedStatuses,
};
