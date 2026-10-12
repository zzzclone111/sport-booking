const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { PGlite } = require("@electric-sql/pglite"),
  { btree_gist } = require("@electric-sql/pglite/contrib/btree_gist"),
  { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const { JSDOM } = require("jsdom"),
  jwt = require("jsonwebtoken");
process.env.LOG_LEVEL = "error";
const db = require("../src/db"),
  config = require("../src/config");
let pg,
  server,
  url,
  owner,
  renter,
  admin,
  other,
  venue,
  court,
  court2,
  legacyBooking;
async function adapted(target, sql, params) {
  const r = await target.query(sql, params);
  return { ...r, rowCount: r.affectedRows || r.rows.length };
}
async function request(route, method = "GET", body, session) {
  const r = await fetch(url + route, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (r.status >= 500) console.error(route, data);
  return { status: r.status, body: data };
}
async function account(email, role) {
  const r = await request("/api/auth/register", "POST", {
    fullName: role + " Test",
    email,
    password: "TestPassword123",
    role,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const venueBody = {
  name: "Cụm sân Lab",
  address: "12 Đường Test",
  district: "Thủ Đức",
  city: "Hồ Chí Minh",
  openTime: "06:00",
  closeTime: "23:00",
  courts: [
    {
      name: "Sân A1",
      sportType: "Cầu lông",
      pricePerHour: 100000,
      pricingRules: [
        {
          dayOfWeek: null,
          startTime: "17:00",
          endTime: "21:00",
          pricePerHour: 180000,
        },
        {
          dayOfWeek: 0,
          startTime: "18:00",
          endTime: "20:00",
          pricePerHour: 220000,
        },
      ],
    },
    { name: "Sân A2", sportType: "Cầu lông", pricePerHour: 120000 },
  ],
};
const interval = (s = "18:00", e = "19:00") => ({
  courtId: court,
  startsAt: `2030-01-06T${s}:00+07:00`,
  endsAt: `2030-01-06T${e}:00+07:00`,
});
test.before(async () => {
  pg = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await pg.exec(
    fs.readFileSync(path.join(__dirname, "../migrations/001_init.sql"), "utf8"),
  );
  // Populate the original schema before upgrading, like an existing lab database.
  const legacy = await pg.query(`WITH u AS (
    INSERT INTO users(full_name,email,password_hash,role) VALUES('Legacy','legacy@example.com','unused','OWNER') RETURNING id
  ), v AS (
    INSERT INTO venues(owner_id,name,address,district,city,status) SELECT id,'Legacy venue','Old address','Old district','Old city','INACTIVE' FROM u RETURNING id,owner_id
  ), c AS (
    INSERT INTO courts(venue_id,name,sport_type,price_per_hour) SELECT id,'Legacy court','Tennis',100000 FROM v RETURNING id
  ) INSERT INTO bookings(booking_code,renter_id,court_id,starts_at,ends_at,total_amount,status)
    SELECT 'LEGACY01',v.owner_id,c.id,'2025-01-01T08:00:00+07:00','2025-01-01T09:00:00+07:00',100000,'CONFIRMED' FROM c,v RETURNING id`);
  legacyBooking = legacy.rows[0].id;
  await pg.exec(
    fs.readFileSync(
      path.join(__dirname, "../migrations/002_court_schedules.sql"),
      "utf8",
    ),
  );
  await pg.exec(
  fs.readFileSync(
    path.join(__dirname, "../migrations/003_court_images.sql"),
    "utf8",
  ),
);
  db.pool.query = (sql, params) => adapted(pg, sql, params);
  db.withTransaction = (fn) =>
    pg.transaction((tx) =>
      fn({ query: (sql, params) => adapted(tx, sql, params) }),
    );
  const app = require("../src/app");
  await new Promise((r) => {
    server = app.listen(0, "127.0.0.1", r);
  });
  url = `http://127.0.0.1:${server.address().port}`;
  owner = await account("owner-test@example.com", "OWNER");
  renter = await account("renter-test@example.com", "RENTER");
  other = await account("other@example.com", "OWNER");
  const r = await pg.query(
    "INSERT INTO users(full_name,email,password_hash,role) VALUES('Admin','admin-test@example.com','unused','ADMIN') RETURNING id",
  );
  admin = {
    token: jwt.sign({ sub: r.rows[0].id, role: "ADMIN" }, config.jwtSecret),
  };
});
test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (pg) await pg.close();
  await db.pool.end();
});
test("multi-court registration, private pending venues, rejection, resubmission and approval", async () => {
  assert.equal(
    (
      await request("/api/auth/register", "POST", {
        fullName: "Admin attempt",
        email: "bad@example.com",
        password: "TestPassword123",
        role: "ADMIN",
      })
    ).status,
    400,
  );
  const r = await request("/api/owner/venues", "POST", venueBody, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  venue = r.body.venue.id;
  assert.equal(r.body.venue.status, "PENDING");
  assert.equal((await request(`/api/venues/${venue}`)).status, 404);
  assert.equal((await request("/api/venues/courts")).body.pagination.total, 0);
  assert.equal(
    (
      await request(
        `/api/admin/venues/${venue}/status`,
        "PATCH",
        { status: "ACTIVE" },
        owner,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/admin/venues?status=PENDING", "GET", null, admin)).body
      .items.length,
    1,
  );
  assert.equal(
    (
      await request(
        `/api/admin/venues/${venue}/status`,
        "PATCH",
        { status: "REJECTED" },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/api/admin/venues/${venue}/status`,
        "PATCH",
        { status: "REJECTED", reviewNote: "Bổ sung ảnh sân" },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/owner/venues/${venue}`, "GET", null, owner)).body
      .review_note,
    "Bổ sung ảnh sân",
  );
  assert.equal(
    (await request(`/api/owner/venues/${venue}/resubmit`, "POST", null, owner))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/admin/venues/${venue}/status`,
        "PATCH",
        { status: "ACTIVE" },
        admin,
      )
    ).status,
    200,
  );
  const detail = (await request(`/api/venues/${venue}`)).body;
  assert.equal(detail.courts.length, 2);
  assert.equal(detail.owner_email, undefined);
  court = detail.courts.find((c) => c.name === "Sân A1").id;
  court2 = detail.courts.find((c) => c.name === "Sân A2").id;
});
test("search filters individual courts and quotes day-specific rates; invalid slots return 400", async () => {
  const r = await request(
    "/api/venues/courts?date=2030-01-06&startTime=18:00&endTime=19:00",
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 2);
  assert.equal(
    r.body.items.find((c) => c.id === court).quote.totalAmount,
    220000,
  );
  for (const q of [
    "date=2030-02-30",
    "startTime=18:00&endTime=19:00",
    "date=2030-01-06&startTime=18:15&endTime=19:00",
  ])
    assert.equal((await request("/api/venues/courts?" + q)).status, 400);
});
test("online, walk-ins and blocks share exclusion protection; cancellation releases slots", async () => {
  const r = await request("/api/bookings", "POST", interval(), renter);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.total_amount, 220000);
  const booking = r.body.booking;
  assert.equal(
    (
      await request(
        "/api/owner/manual-bookings",
        "POST",
        { ...interval(), source: "WALK_IN", guestName: "Khách" },
        owner,
      )
    ).status,
    409,
  );
  const search = await request(
    "/api/venues/courts?date=2030-01-06&startTime=18:00&endTime=19:00",
  );
  assert.equal(search.body.items.length, 1);
  assert.equal(search.body.items[0].id, court2);
  const sched = (
    await request(`/api/venues/${venue}/availability?date=2030-01-06`)
  ).body;
  assert.equal(
    sched.courts
      .find((c) => c.id === court)
      .slots.find((s) => s.startTime === "18:00").status,
    "PENDING",
  );
  assert.equal(
    (
      await request(
        `/api/owner/bookings/${booking.id}/status`,
        "PATCH",
        { status: "CONFIRMED" },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/owner/revenue", "GET", null, owner)).body.summary
      .revenue,
    220000,
  );
  assert.equal(
    (await request(`/api/bookings/${booking.id}/cancel`, "PATCH", null, renter))
      .status,
    200,
  );
  const manual = await request(
    "/api/owner/manual-bookings",
    "POST",
    {
      ...interval(),
      source: "WALK_IN",
      guestName: "Khách trực tiếp",
      guestPhone: "0901000000",
    },
    owner,
  );
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  const block = await request(
    "/api/owner/manual-bookings",
    "POST",
    { ...interval("19:00", "20:00"), source: "BLOCK", note: "Bảo trì" },
    owner,
  );
  assert.equal(block.status, 201);
  assert.equal(block.body.booking.total_amount, 0);
  assert.equal(
    (await request("/api/bookings", "POST", interval("19:00", "19:30"), renter))
      .status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/owner/manual-bookings/${manual.body.booking.id}`,
        "PUT",
        {
          ...interval("18:30", "19:30"),
          source: "WALK_IN",
          guestName: "Khách",
        },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/owner/manual-bookings/${block.body.booking.id}/cancel`,
        "PATCH",
        null,
        other,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/owner/manual-bookings/${block.body.booking.id}/cancel`,
        "PATCH",
        null,
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/owner/manual-bookings/${manual.body.booking.id}`,
        "PUT",
        {
          ...interval("18:30", "19:30"),
          source: "WALK_IN",
          guestName: "Khách",
        },
        owner,
      )
    ).status,
    200,
  );
  const publicSchedule = (
    await request(`/api/venues/${venue}/availability?date=2030-01-06`)
  ).body;
  assert.equal(
    publicSchedule.courts.find((c) => c.id === court).occupied[0].guest_name,
    undefined,
  );
  assert.ok(
    (await request("/api/owner/bookings", "GET", null, owner)).body.items.some(
      (b) => b.source === "WALK_IN" && b.renter_name === "Khách",
    ),
  );
  assert.equal(
    (await request("/api/owner/revenue", "GET", null, owner)).body.summary
      .revenue,
    220000,
  );
});
test("court price edits enforce ownership and nonoverlapping rules; inactive courts cannot be booked", async () => {
  const body = {
    name: "Sân A2",
    sportType: "Cầu lông",
    pricePerHour: 150000,
    active: false,
    pricingRules: [],
  };
  assert.equal(
    (await request(`/api/owner/courts/${court2}`, "PUT", body, other)).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/owner/courts/${court2}`,
        "PUT",
        {
          ...body,
          pricingRules: [
            {
              dayOfWeek: null,
              startTime: "17:00",
              endTime: "20:00",
              pricePerHour: 100000,
            },
            {
              dayOfWeek: null,
              startTime: "19:00",
              endTime: "21:00",
              pricePerHour: 120000,
            },
          ],
        },
        owner,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(`/api/owner/courts/${court2}`, "PUT", body, owner)).status,
    200,
  );
  assert.equal((await request("/api/venues/courts")).body.items.length, 1);
  assert.equal(
    (
      await request(
        "/api/bookings",
        "POST",
        { ...interval("20:00", "21:00"), courtId: court2 },
        renter,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/owner/venues/${venue}/courts`,
        "POST",
        { name: "Sân A3", sportType: "Tennis", pricePerHour: 200000 },
        owner,
      )
    ).status,
    201,
  );
});
async function waitFor(condition) {
  for (let i = 0; i < 120; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("UI did not reach expected state");
}
async function browser(session) {
  const frontend = path.join(__dirname, "../../frontend");
  const dom = new JSDOM(
      fs.readFileSync(path.join(frontend, "index.html"), "utf8"),
      {
        url: "http://localhost:8080",
        runScripts: "outside-only",
        pretendToBeVisual: true,
      },
    ),
    w = dom.window;
  w.scrollTo = () => {};
  w.confirm = () => true;
  w.fetch = (route, options) => fetch(url + route, options);
  if (session) {
    w.localStorage.setItem("sporthub_token", session.token);
    w.localStorage.setItem("sporthub_user", JSON.stringify(session.user));
  }
  for (const f of ["schedule-utils.js", "app.js"])
    w.eval(fs.readFileSync(path.join(frontend, f), "utf8"));
  await waitFor(() => w.document.querySelector('[data-action="schedule"]'));
  return dom;
}
test("renter UI opens timeline, selects server-priced interval and submits a booking", async () => {
  const dom = await browser(renter),
    w = dom.window,
    doc = w.document;
  try {
    doc.querySelector('[data-action="schedule"]').click();
    await waitFor(() => doc.querySelector("#scheduleDate"));
    const date = doc.querySelector("#scheduleDate");
    date.value = "2030-01-06";
    date.dispatchEvent(new w.Event("change", { bubbles: true }));
    await waitFor(() =>
      doc.querySelector('[data-action="slot"][data-date="2030-01-06"]'),
    );
    const find = (time) =>
      [
        ...doc.querySelectorAll(`[data-action="slot"][data-court="${court}"]`),
      ].find((s) => s.textContent.includes(time));
    find("20:00").click();
    await waitFor(
      () =>
        doc.querySelector('[data-action="book-selected"]') &&
        !doc.querySelector('[data-action="book-selected"]').disabled,
    );
    find("20:30").click();
    await waitFor(
      () =>
        doc
          .querySelector("#selectionPanel")
          .textContent.includes("20:00–21:00") &&
        !doc.querySelector('[data-action="book-selected"]').disabled,
    );
    doc.querySelector('[data-action="book-selected"]').click();
    await waitFor(
      () =>
        doc.querySelector("#bookingsView.active") &&
        doc.querySelector("#myBookingList").textContent.includes("Sân A1"),
    );
    assert.match(doc.querySelector("#myBookingList").textContent, /Sân A1/);
  } finally {
    w.close();
  }
});
test("owner UI displays role navigation, pricing editor and saves a manual block", async () => {
  const dom = await browser(owner),
    w = dom.window,
    doc = w.document;
  try {
    assert.equal(doc.querySelector(".owner-only").style.display, "inline-flex");
    doc.querySelector('[data-route="owner"]').click();
    await waitFor(() => doc.querySelector('[data-action="owner-schedule"]'));
    doc.querySelector('[data-action="owner-schedule"]').click();
    await waitFor(() => doc.querySelector('[data-action="edit-court"]'));
    doc
      .querySelector(`[data-action="edit-court"][data-court="${court}"]`)
      .click();
    await waitFor(() => doc.querySelector("#courtEditor"));
    assert.equal(doc.querySelectorAll(".rule-row").length, 2);
    doc.querySelector("[data-close-editor]").click();
    doc
      .querySelector(`[data-action="new-manual"][data-court="${court}"]`)
      .click();
    await waitFor(() => doc.querySelector("#manualEditor"));
    const f = doc.querySelector("#manualEditor");
    f.elements.date.value = "2030-01-06";
    f.elements.startTime.value = "21:00";
    f.elements.endTime.value = "22:00";
    f.elements.source.value = "BLOCK";
    f.querySelector("button").click();
    await waitFor(() => !doc.querySelector("#editorModal.open"));
    await waitFor(() =>
      doc.querySelector(
        '[data-action="slot"][data-date="2030-01-06"].slot-BLOCKED',
      ),
    );
    assert.match(doc.querySelector("#detailContent").textContent, /Khóa lịch/);
  } finally {
    w.close();
  }
});
test("admin UI displays pending queue, reviews court details and approves the venue", async () => {
  await request(
    "/api/owner/venues",
    "POST",
    { ...venueBody, name: "Cụm chờ kiểm duyệt" },
    owner,
  );
  admin.user = (await request("/api/auth/me", "GET", null, admin)).body.user;
  const dom = await browser(admin),
    doc = dom.window.document;
  try {
    doc.querySelector('[data-route="admin"]').click();
    await waitFor(() =>
      doc.querySelector('#adminQueue [data-action="review"]'),
    );
    doc.querySelector('#adminQueue [data-action="review"]').click();
    await waitFor(() => doc.querySelector("#reviewEditor"));
    assert.match(doc.querySelector("#editorContent").textContent, /Sân A1/);
    doc.querySelector('#reviewEditor button[value="ACTIVE"]').click();
    await waitFor(() => !doc.querySelector("#editorModal.open"));
    await waitFor(
      () => !doc.querySelector('#adminQueue [data-action="review"]'),
    );
  } finally {
    dom.window.close();
  }
});
test("simultaneous online requests produce one reservation and one conflict", async () => {
  const results = await Promise.all([
    request("/api/bookings", "POST", interval("08:00", "09:00"), renter),
    request("/api/bookings", "POST", interval("08:00", "09:00"), renter),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});
test("editing an approved venue resubmits it and keeps its existing bookings", async () => {
  const before = (
    await pg.query(
      "SELECT COUNT(*)::int AS n FROM bookings b JOIN courts c ON c.id=b.court_id WHERE c.venue_id=$1",
      [venue],
    )
  ).rows[0].n;
  const { courts, ...body } = venueBody;
  const edited = await request(
    `/api/owner/venues/${venue}`,
    "PUT",
    { ...body, name: "Cụm sân đã cập nhật" },
    owner,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.venue.status, "PENDING");
  assert.equal((await request(`/api/venues/${venue}`)).status, 404);
  const after = (
    await pg.query(
      "SELECT COUNT(*)::int AS n FROM bookings b JOIN courts c ON c.id=b.court_id WHERE c.venue_id=$1",
      [venue],
    )
  ).rows[0].n;
  assert.equal(before, after);
});

test("migration 002 preserves existing bookings and adds ONLINE defaults", async () => {
  const record = (
    await pg.query("SELECT * FROM bookings WHERE id=$1", [legacyBooking])
  ).rows[0];
  assert.equal(record.booking_code, "LEGACY01");
  assert.equal(record.status, "CONFIRMED");
  assert.equal(record.source, "ONLINE");
  assert.equal(Number(record.total_amount), 100000);
  assert.ok(record.renter_id);
});
test("booking rejects a stale price estimate before storing a reservation", async () => {
  assert.equal(
    (
      await request(
        "/api/bookings",
        "POST",
        {
          ...interval("07:00", "08:00"),
          courtId: (
            await pg.query(
              "SELECT id FROM courts WHERE venue_id <> $1 AND name=$2",
              [venue, "Sân A1"],
            )
          ).rows[0].id,
          expectedAmount: 1,
        },
        renter,
      )
    ).status,
    409,
  );
});
