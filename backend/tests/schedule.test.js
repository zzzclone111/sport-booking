const test = require("node:test");
const assert = require("node:assert/strict");
const { quote, buildSlots, validDate } = require("../src/services/schedule");
const {
  localDate,
  addDays,
  selectRange,
} = require("../../frontend/schedule-utils");
const court = {
  price_per_hour: 100000,
  open_time: "06:00:00",
  close_time: "23:00:00",
};
const rules = [
  {
    day_of_week: null,
    start_time: "17:00",
    end_time: "21:00",
    price_per_hour: 180000,
  },
  {
    day_of_week: 0,
    start_time: "18:00",
    end_time: "20:00",
    price_per_hour: 220000,
  },
];
test("pricing spans basic, daily and Sunday override rates", () => {
  const p = quote(
    court,
    rules,
    "2030-01-06T16:30:00+07:00",
    "2030-01-06T18:30:00+07:00",
  );
  assert.equal(p.totalAmount, 340000);
  assert.equal(p.segments.length, 4);
});
test("dates, timezone and slot boundaries are validated", () => {
  assert.equal(validDate("2027-02-29"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.throws(
    () =>
      quote(
        court,
        [],
        "2030-01-06T16:15:00+07:00",
        "2030-01-06T18:00:00+07:00",
      ),
    /30 phút/,
  );
  assert.throws(
    () =>
      quote(
        court,
        [],
        "2030-01-06T22:30:00+07:00",
        "2030-01-07T00:30:00+07:00",
      ),
    /cùng ngày/,
  );
  assert.throws(
    () =>
      quote(
        court,
        [],
        "2030-01-06T05:30:00+07:00",
        "2030-01-06T07:00:00+07:00",
      ),
    /mở cửa/,
  );
  assert.equal(localDate("2030-01-06T18:00:00Z"), "2030-01-07");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});
test("timeline uses exclusive endpoints and selection cannot cross occupied slots", () => {
  const s = buildSlots(
    court,
    [],
    [
      {
        id: "b",
        source: "BLOCK",
        status: "CONFIRMED",
        starts_at: "2030-01-06T18:00:00+07:00",
        ends_at: "2030-01-06T19:00:00+07:00",
      },
    ],
    "2030-01-06",
  );
  assert.equal(s.find((s) => s.startTime === "17:30").status, "AVAILABLE");
  assert.equal(s.find((s) => s.startTime === "18:00").status, "BLOCKED");
  assert.equal(s.find((s) => s.startTime === "19:00").status, "AVAILABLE");
  assert.throws(() => selectRange(s, 22, 26), /khung đã đặt/);
  assert.equal(selectRange(s, 3, 1).startTime, "06:30");
  assert.equal(selectRange(s, 3, 1).endTime, "08:00");
});
