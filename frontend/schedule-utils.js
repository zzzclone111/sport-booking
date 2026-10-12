/* Shared, timezone-safe schedule helpers; also exercised by Node tests. */
(function (root) {
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const localDate = (value = new Date()) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date(value))
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const addDays = (date, n) =>
    new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const iso = (date, time) => `${date}T${time}:00+07:00`;
  function selectRange(slots, anchor, index, manual = false) {
    const first = Math.min(anchor, index),
      last = Math.max(anchor, index),
      selected = slots.slice(first, last + 1);
    if (
      !selected.length ||
      selected.length > 16 ||
      selected.some(
        (s) => !["AVAILABLE", ...(manual ? ["PAST"] : [])].includes(s.status),
      )
    )
      throw new Error(
        "Chọn tối đa 8 giờ liên tục, không đi qua khung đã đặt hoặc khóa.",
      );
    return {
      first,
      last,
      startTime: selected[0].startTime,
      endTime: selected.at(-1).endTime,
      startsAt: selected[0].startsAt,
      endsAt: selected.at(-1).endsAt,
    };
  }
  const helpers = { minutes, localDate, addDays, iso, selectRange };
  if (typeof module === "object" && module.exports) module.exports = helpers;
  else root.ScheduleUtils = helpers;
})(typeof window !== "undefined" ? window : globalThis);
