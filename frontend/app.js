const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
const { localDate, addDays, iso, selectRange } = ScheduleUtils;
const state = {
  token: localStorage.getItem("sporthub_token") || "",
  user: null,
  page: 1,
  search: null,
  detail: null,
  selection: null,
  view: "home",
  calendarMode: "day",
  editor: null,
};
try {
  state.user = JSON.parse(localStorage.getItem("sporthub_user") || "null");
} catch {
  localStorage.removeItem("sporthub_user");
}
const esc = (v = "") =>
  String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const formatAddress = (...parts) =>
  parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");
const money = (v) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(v || 0);
const dt = (v) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
const hh = (v) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(v));
const roles = {
  RENTER: "Người thuê",
  OWNER: "Chủ sân",
  ADMIN: "Quản trị viên",
};
const statuses = {
  AVAILABLE: "Trống",
  PAST: "Đã qua",
  PENDING: "Chờ duyệt",
  CONFIRMED: "Đã đặt",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
  REJECTED: "Từ chối",
  ACTIVE: "Hoạt động",
  INACTIVE: "Tạm dừng",
  BLOCKED: "Đã khóa",
};
const sourceNames = {
  ONLINE: "Online",
  WALK_IN: "Thuê trực tiếp",
  BLOCK: "Khóa lịch",
};
const dayNames = [
  "Chủ nhật",
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
];
const badge = (s) =>
  `<span class="status status-${esc(s)}">${esc(statuses[s] || s)}</span>`;
const empty = (text) => `<p class="empty-inline">${esc(text)}</p>`;
const photo = (url, cls = "card-photo") =>
  url && /^(https?:\/\/|\/api\/images\/)/i.test(url)
    ? `<img class="${cls}" src="${esc(url)}" loading="lazy" alt="Ảnh sân">`
    : "";
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) {
      logout(false);
    }
    const error = new Error(data.message || "Không thể kết nối máy chủ");
    error.status = response.status;
    error.details = data.details;
    throw error;
  }
  return data;
}
async function uploadChosenImage(fileInput, urlInput) {
  const file = fileInput?.files?.[0];
  if (!file) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Chỉ nhận ảnh JPEG, PNG hoặc WebP");
  }
  if (!file.size || file.size > 5 * 1024 * 1024) {
    throw new Error("Ảnh phải có dung lượng từ 1 byte đến 5 MB");
  }

  const result = await api("/api/images", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });

  urlInput.value = result.imageUrl;
}
async function uploadCourtPhotos(root) {
  const input = $("[name=courtPhotos]", root);
  const stored = $("[name=courtImages]", root);
  const urls = JSON.parse(stored.value || "[]");
  const files = [...(input?.files || [])];

  if (urls.length + files.length > 10) {
    throw new Error("Mỗi sân được lưu tối đa 10 ảnh");
  }

  // Kiểm tra tất cả tệp trước khi bắt đầu upload.
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("Chỉ nhận ảnh JPEG, PNG hoặc WebP");
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      throw new Error("Mỗi ảnh phải có dung lượng từ 1 byte đến 5 MB");
    }
  }

  for (const file of files) {
    const result = await api("/api/images", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    urls.push(result.imageUrl);
  }

  stored.value = JSON.stringify(urls);
}
function imagesOfCourt(c = {}, venue = null) {
  if (Array.isArray(c.image_urls) && c.image_urls.length) {
    return c.image_urls;
  }
  if (c.image_url) return [c.image_url];
  return venue?.image_url ? [venue.image_url] : [];
}

function courtImageList(urls) {
  return urls.map((url, index) => `
    <div class="court-image-item">
      ${photo(url, "court-gallery-photo")}
      <div class="action-row">
        ${index === 0
          ? "<small>Ảnh bìa</small>"
          : `<button type="button" class="button button-ghost button-small"
                     data-action="cover-court-image" data-index="${index}">
               Đặt làm ảnh bìa
             </button>`}
        <button type="button" class="button button-danger button-small"
                data-action="remove-court-image" data-index="${index}">
          Xóa ảnh
        </button>
      </div>
    </div>
  `).join("");
}

function courtImageEditor(c = {}) {
  // Ở form chỉnh sửa, chỉ lưu ảnh thuộc chính sân này.
  // Không chép ảnh cụm vào image_urls của sân.
  const urls = imagesOfCourt(c);

  return `
    <div class="court-images">
      <input type="hidden" name="courtImages"
             value="${esc(JSON.stringify(urls))}">
      <div class="court-image-list">${courtImageList(urls)}</div>
      <label>
        Thêm ảnh riêng cho sân (tối đa 10 ảnh, mỗi ảnh tối đa 5 MB)
        <input name="courtPhotos" type="file" multiple
               accept="image/jpeg,image/png,image/webp">
      </label>
      <p class="muted">Nếu sân không có ảnh riêng, trang sẽ hiện ảnh cụm sân.</p>
    </div>`;
}

function courtGallery(c, venue) {
  const urls = imagesOfCourt(c, venue);
  return urls.length
    ? `<div class="court-gallery">
         ${urls.map((url) => photo(url, "court-gallery-photo")).join("")}
       </div>`
    : "";
}

const send = (path, method, body) =>
  api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.style.background = error ? "#a83d3d" : "#14231d";
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 5000);
}
function openModal(id) {
  $(`#${id}`).classList.add("open");
  document.body.style.overflow = "hidden";
  $(`#${id} input, #${id} button`)?.focus();
}
function closeEditor() {
  $("#editorModal").classList.remove("open");
  state.editor = null;
  document.body.style.overflow = $(".modal.open") ? "hidden" : "";
}
function closeModals() {
  $$(".modal").forEach((m) => m.classList.remove("open"));
  state.detail = null;
  state.selection = null;
  state.editor = null;
  document.body.style.overflow = "";
}
function errorMessage(error) {
  return (
    error.message +
    (error.details?.fieldErrors
      ? "\n" + Object.values(error.details.fieldErrors).flat().join("\n")
      : "")
  );
}
function useHalfHourSelects(root = document) {
  root.querySelectorAll('input[type="time"]').forEach((input) => {
    const select = document.createElement("select");
    if (input.id) select.id = input.id;
    if (input.name) select.name = input.name;
    select.required = input.required;

    const currentValue = input.value;
    select.add(new Option("Chọn giờ", ""));

    const isStart = input.id === "startFilter" ||
      ["startTime", "ruleStart", "openTime"].includes(input.name);
    const isEnd = input.id === "endFilter" ||
      ["endTime", "ruleEnd", "closeTime"].includes(input.name);

    const first = isEnd ? 30 : 0;
    const last = isStart ? 23 * 60 : 23 * 60 + 30;

    for (let minutes = first; minutes <= last; minutes += 30) {
      const value =
        `${String(Math.floor(minutes / 60)).padStart(2, "0")}:` +
        `${String(minutes % 60).padStart(2, "0")}`;
      select.add(new Option(value, value));
    }

    input.replaceWith(select);
    select.value = currentValue || "";
  });
}
async function guard(fn, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    const root = $("#editorModal.open") || $("#authModal.open");
    if (root) $(".form-error", root).textContent = errorMessage(e);
    toast(errorMessage(e), true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
function updateAuth() {
  $$(".auth-only").forEach(
    (el) =>
      (el.style.display =
        state.user &&
        el.classList.contains(`${state.user.role.toLowerCase()}-only`)
          ? "inline-flex"
          : "none"),
  );
  $("#loginButton").classList.toggle("hidden", !!state.user);
  $("#userMenu").classList.toggle("hidden", !state.user);
  if (state.user) {
    $("#userName").textContent = state.user.fullName;
    $("#userRole").textContent = roles[state.user.role];
    $("#userAvatar").textContent = state.user.fullName[0];
  }
}
async function route(name) {
  const role = { bookings: "RENTER", owner: "OWNER", admin: "ADMIN" }[name];
  if (role && state.user?.role !== role) {
    openModal("authModal");
    return;
  }
  state.view = name;
  $$(".view").forEach((el) =>
    el.classList.toggle("active", el.id === `${name}View`),
  );
  $$(".nav-link").forEach((el) =>
    el.classList.toggle("active", el.dataset.route === name),
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "bookings") await loadMyBookings();
  if (name === "owner") await loadOwner();
  if (name === "admin") await loadAdmin();
}
function setSession(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("sporthub_token", data.token);
  localStorage.setItem("sporthub_user", JSON.stringify(data.user));
  updateAuth();
}
function logout(show = true) {
  state.token = "";
  state.user = null;
  localStorage.removeItem("sporthub_token");
  localStorage.removeItem("sporthub_user");
  closeModals();
  updateAuth();
  guard(() => route("home"));
  if (show) toast("Đã đăng xuất");
}
async function finishAuth(data) {
  setSession(data);
  $("#authModal").classList.remove("open");
  document.body.style.overflow = $(".modal.open") ? "hidden" : "";
  toast(`Xin chào, ${data.user.fullName}`);
  if (state.detail && data.user.role === "RENTER") {
    renderSchedule();
    return;
  }
  closeModals();
  await route(
    data.user.role === "OWNER"
      ? "owner"
      : data.user.role === "ADMIN"
        ? "admin"
        : "home",
  );
}
function readSearch() {
  return {
    sport: $("#sportFilter").value,
    ward: $("#wardFilter").value,
    q: $("#keywordFilter").value,
    date: $("#dateFilter").value,
    startTime: $("#startFilter").value,
    endTime: $("#endFilter").value,
  };
}
async function loadCourts(reset = false) {
  if (reset || !state.search) {
    state.page = 1;
    state.search = readSearch();
  }
  const params = new URLSearchParams({
    page: state.page,
    limit: 12,
    ...Object.fromEntries(Object.entries(state.search).filter(([, v]) => v)),
  });
  $("#venueGrid").innerHTML = empty("Đang tìm sân…");
  $("#venueEmpty").classList.add("hidden");
  try {
    const data = await api(`/api/venues/courts?${params}`);
    $("#resultCount").textContent =
      `${data.pagination.total} sân phù hợp${data.requestedRange ? " · Trống trong khung giờ đã chọn" : ""}`;
    $("#venueEmpty").classList.toggle("hidden", !!data.items.length);
    $("#venueGrid").innerHTML = data.items
      .map(
        (c) =>
          `<article class="venue-card"><div class="venue-image">${photo(c.image_url)}<div class="sport-tags"><span>${esc(c.sport_type)}</span></div></div><div class="venue-body"><h3>${esc(c.name)}</h3><strong>${esc(c.venue_name)}</strong><p class="venue-location">⌖ ${esc(formatAddress(c.address, c.district, c.city))}</p><div class="venue-meta"><span>${esc(c.surface || "Sân thể thao")}</span><span>${esc(c.open_time.slice(0, 5))}–${esc(c.close_time.slice(0, 5))}</span></div><div class="venue-bottom"><div class="price"><strong>${money(c.quote?.totalAmount ?? c.price_per_hour)}</strong><br><span>${c.quote ? "tổng khung giờ chọn" : "giá cơ bản / giờ"}</span></div><button class="button button-primary button-small" data-action="schedule" data-venue="${c.venue_id}" data-court="${c.id}">Xem lịch →</button></div></div></article>`,
      )
      .join("");
    const pages = Math.ceil(data.pagination.total / data.pagination.limit);
    $("#pagination").innerHTML =
      pages > 1
        ? `<button class="button button-ghost" data-action="page" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>← Trước</button><span>Trang ${state.page}/${pages}</span><button class="button button-ghost" data-action="page" data-page="${state.page + 1}" ${state.page === pages ? "disabled" : ""}>Sau →</button>`
        : "";
  } catch (e) {
    $("#venueGrid").innerHTML = empty(errorMessage(e));
    $("#pagination").innerHTML = "";
    throw e;
  }
}
async function openSchedule(
  venueId,
  courtId = null,
  owner = false,
  date = state.search?.date || localDate(),
) {
  state.selection = null;
  state.calendarMode = "day";

  const base = owner ? "/api/owner/venues" : "/api/venues";
  const [venue, schedule] = await Promise.all([
    api(`${base}/${venueId}`),
    api(`${base}/${venueId}/availability?date=${date}`),
  ]);

  const detail = (state.detail = {
    venue,
    owner,
    date,
    schedule,
    courtId: courtId || venue.courts[0]?.id,
    week: null,
  });

  let focusIndex = -1;
  const search = state.search;
  const court = schedule.courts.find((c) => c.id === detail.courtId);

  if (
    !owner &&
    court &&
    search?.date === date &&
    search.startTime &&
    search.endTime
  ) {
    const first = court.slots.findIndex(
      (slot) => slot.startTime === search.startTime,
    );
    const last = court.slots.findIndex(
      (slot) => slot.endTime === search.endTime,
    );

    if (
      first >= 0 &&
      last >= first &&
      court.slots
        .slice(first, last + 1)
        .every((slot) => isSelectableSlot(slot, date))
    ) {
      focusIndex = first;

      try {
        const range = selectRange(court.slots, first, last);
        state.selection = {
          ...range,
          courtId: court.id,
          date,
          anchor: first,
          complete: true,
          price: null,
        };
      } catch {
        toast("Khung giờ đã thay đổi, vui lòng chọn lại trên lịch.", true);
      }
    }
  }

  renderSchedule();
  openModal("detailModal");

  if (focusIndex >= 0) {
    requestAnimationFrame(() => {
      if (state.detail !== detail) return;

      const timeline = $("#detailContent .timeline-scroll");
      const strip = timeline?.querySelector(".slot-strip");
      const slot = timeline?.querySelector(
        `.slot[data-index="${focusIndex}"]`,
      );

      if (timeline && strip && slot) {
        timeline.scrollLeft =
          slot.getBoundingClientRect().left -
          strip.getBoundingClientRect().left -
          12;
      }
    });
  }

  const selection = state.selection;
  if (!selection) return;

  try {
    const price = await api(
      `/api/venues/courts/${court.id}/quote?${new URLSearchParams({
        startsAt: selection.startsAt,
        endsAt: selection.endsAt,
      })}`,
    );

    if (state.detail === detail && state.selection === selection) {
      selection.price = price;
      renderSelection();
    }
  } catch (error) {
    if (state.detail === detail && state.selection === selection) {
      selection.error = error.message;
      renderSelection();
    }
  }
}
async function refreshSchedule(clear = true) {
  const d = state.detail;
  if (!d) return;
  if (clear) state.selection = null;
  const base = d.owner ? "/api/owner/venues" : "/api/venues";
  const [venue, schedule] = await Promise.all([
    api(`${base}/${d.venue.id}`),
    api(`${base}/${d.venue.id}/availability?date=${d.date}`),
  ]);
  if (state.detail !== d) return;
  d.venue = venue;
  d.schedule = schedule;
  d.week = null;
  reconcileSelection(schedule);
  if (state.calendarMode === "week") await loadWeek();
  else renderSchedule();
}
function reconcileSelection(day) {
  const s = state.selection;
  if (!s || !day || s.date !== day.date) return;
  const c = day.courts.find(c => c.id === s.courtId);
  if (!c || !c.active || c.slots.slice(s.first, s.last + 1).some(slot =>
    !isSelectableSlot(slot, day.date, state.detail.owner))) {
    state.selection = null;
  }
}
async function loadWeek() {
  const d = state.detail,
    base = d.owner ? "/api/owner/venues" : "/api/venues";
  const days = await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      api(`${base}/${d.venue.id}/availability?date=${addDays(d.date, i)}`),
    ),
  );
  if (state.detail !== d) return;
  d.week = days;
  reconcileSelection(days.find(day => day.date === state.selection?.date));
  renderSchedule();
}
function isPastSlot(slot, date) {
  if (slot.status === "PAST") return true;
  const startsAt = slot.startsAt || (date && iso(date, slot.startTime));
  return startsAt ? new Date(startsAt).getTime() <= Date.now() : false;
}
function isSelectableSlot(slot, date, owner = false) {
  return (
    (slot.status === "AVAILABLE" || (owner && slot.status === "PAST")) &&
    (owner || !isPastSlot(slot, date))
  );
}
function slotButton(slot, index, court, date) {
  const d = state.detail,
    s = state.selection,
    selected =
      s &&
      s.courtId === court.id &&
      s.date === date &&
      index >= s.first &&
      index <= s.last;
  const canSelect = isSelectableSlot(slot, date, d.owner);
  const canEdit = d.owner && slot.bookingId;
  return `<button class="slot slot-${slot.status}${selected ? " selected" : ""}" data-action="slot" data-court="${court.id}" data-date="${date}" data-index="${index}" ${!canSelect && !canEdit ? "disabled" : ""} title="${esc(`${slot.startTime}–${slot.endTime} · ${statuses[slot.status]} · ${money(slot.pricePerHour)}/giờ`)}" aria-pressed="${!!selected}"><strong>${slot.startTime}</strong><span>${statuses[slot.status]}</span><small>${money(slot.pricePerHour / 2)}</small></button>`;
}
function rulesMarkup(c) {
  return `<p class="muted">Giá cơ bản: <strong>${money(c.price_per_hour)}/giờ</strong>. Giá riêng theo ngày ưu tiên hơn giá áp dụng mỗi ngày.</p>${c.pricingRules.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Khung giờ</th><th>Giá / giờ</th></tr></thead><tbody>${c.pricingRules.map((r) => `<tr><td>${r.day_of_week === null ? "Mỗi ngày" : dayNames[r.day_of_week]}</td><td>${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}</td><td>${money(r.price_per_hour)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}
function renderSchedule() {
  const d = state.detail;
  if (!d) return;
  const v = d.venue;
  const visibleCourts = d.owner
    ? d.schedule.courts
    : d.schedule.courts.filter((c) => c.id === d.courtId);
  const selected =
    d.schedule.courts.find((c) => c.id === d.courtId) || d.schedule.courts[0];
  $("#detailContent").innerHTML =
    `<span class="eyebrow dark">${d.owner ? "QUẢN LÝ CỤM SÂN" : "LỊCH SÂN"}</span><h2 id="detailTitle">${esc(v.name)} ${badge(v.status)}</h2><p>${esc(formatAddress(v.address, v.district, v.city))}</p><p class="muted">${esc(v.description || "")} · ${esc(v.amenities.join(" · "))}</p>
  ${d.owner ? `<div class="action-row"><button class="button button-ghost" data-action="edit-venue">Sửa thông tin cụm sân</button><button class="button button-primary" data-action="new-court">+ Thêm sân</button>${v.status === "REJECTED" ? '<button class="button button-primary" data-action="resubmit">Gửi lại kiểm duyệt</button>' : ""}</div>${v.review_note ? `<p class="form-error">Phản hồi kiểm duyệt: ${esc(v.review_note)}</p>` : ""}` : ""}
  <div class="schedule-tools"><div class="action-row"><button class="button button-ghost button-small" data-action="prev-day">←</button><label>Ngày chơi<input id="scheduleDate" type="date" value="${d.date}" ${d.owner ? "" : `min="${localDate()}"`}></label><button class="button button-ghost button-small" data-action="next-day">→</button><button class="button button-ghost button-small" data-action="refresh-schedule">Làm mới</button></div><div class="tabs"><button class="button ${state.calendarMode === "day" ? "button-primary" : "button-ghost"}" data-action="calendar-day">Timeline ngày</button><button class="button ${state.calendarMode === "week" ? "button-primary" : "button-ghost"}" data-action="calendar-week">Lịch 7 ngày</button></div></div>
  <div class="legend">${["AVAILABLE", "PENDING", "CONFIRMED", "BLOCKED", "PAST"].map((s) => `<span><i class="slot-${s}"></i>${s === "BLOCKED" ? "Chủ sân khóa" : statuses[s]}</span>`).join("")}</div><p class="muted">Mỗi ô 30 phút; số tiền trên ô là giá 30 phút. Nhấn ô bắt đầu rồi ô cuối để chọn một khoảng liên tục.</p>
  ${
    state.calendarMode === "week"
      ? `<label>Sân xem lịch<select id="weekCourt">${d.schedule.courts.map((c) => `<option value="${c.id}" ${c.id === d.courtId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><div class="week-scroll"><div class="week-grid">${
          d.week
            ? d.week
                .map((day) => {
                  const c = day.courts.find((c) => c.id === d.courtId);
                  return `<div class="week-column"><h4>${esc(new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(`${day.date}T12:00:00+07:00`)))}</h4>${c ? c.slots.map((s, i) => slotButton(s, i, c, day.date)).join("") : empty("Sân tạm dừng")}</div>`;
                })
                .join("")
            : empty("Đang tải lịch tuần…")
        }</div></div>`
      : visibleCourts
          .map(
            (c) =>
              `<article class="timeline-row ${c.id === d.courtId ? "focused-court" : ""}"><div class="timeline-heading"><div>${photo(c.image_url || v.image_url, "court-thumb")}<h3><button class="court-name" data-action="select-court" data-court="${c.id}">${esc(c.name)}</button> ${!c.active ? badge("INACTIVE") : ""}</h3><p>${esc(c.sport_type)} · ${esc(c.surface || "")} · ${money(c.price_per_hour)}/giờ cơ bản</p></div><div class="action-row"><button class="button button-ghost button-small" data-action="court-info" data-court="${c.id}">Thông tin & bảng giá</button>${d.owner ? `<button class="button button-ghost button-small" data-action="edit-court" data-court="${c.id}">Sửa sân / giá</button><button class="button button-primary button-small" data-action="new-manual" data-court="${c.id}" ${v.status !== "ACTIVE" || !c.active ? "disabled" : ""}>+ Lịch thủ công</button>` : ""}</div></div><div class="timeline-scroll"><div class="slot-strip">${c.slots.map((s, i) => slotButton(s, i, c, d.date)).join("")}</div></div></article>`,
          )
          .join("") || empty("Cụm sân chưa có sân đang hoạt động")
  }
  <div id="selectionPanel" class="schedule-summary"></div>
  ${d.owner && selected ? `<div class="occupied-list"><h3>Lịch đã ghi nhận · ${esc(selected.name)}</h3>${selected.occupied.length ? selected.occupied.map((b) => `<div class="stack-item"><div><strong>${hh(b.starts_at)}–${hh(b.ends_at)} · ${esc(b.renter_name || b.guest_name || "Khóa lịch")}</strong><p>${esc(sourceNames[b.source])} · ${badge(b.source === "BLOCK" ? "BLOCKED" : b.status)} · ${money(b.total_amount)} · ${esc(b.guest_phone || "")}</p><small>${esc(b.note || "")}</small></div>${b.source !== "ONLINE" && b.status === "CONFIRMED" ? `<div class="action-row"><button class="button button-ghost button-small" data-action="edit-manual" data-id="${b.id}" data-court="${selected.id}">Sửa</button><button class="button button-danger button-small" data-action="cancel-manual" data-id="${b.id}">Hủy lịch</button></div>` : ""}</div>`).join("") : empty("Chưa có lịch trong ngày này")}</div>` : ""}`;
  renderSelection();
}
function renderSelection() {
  const el = $("#selectionPanel");
  if (!el) return;
  const s = state.selection,
    d = state.detail;
  if (!s) {
    el.innerHTML =
      '<p class="muted">Chọn khung giờ trống trên timeline để đặt sân hoặc cập nhật lịch.</p>';
    return;
  }
  const c = d.venue.courts.find((c) => c.id === s.courtId);
  el.innerHTML = `<h3>${esc(c.name)} · ${esc(s.date)} · ${s.startTime}–${s.endTime}</h3><div class="price-preview"><span>${d.owner ? "Giá tham khảo" : "Tổng tiền"}</span><strong>${s.price ? money(s.price.totalAmount) : "Đang tính…"}</strong></div>${s.price?.segments ? `<details><summary>Chi tiết giá từng khung</summary><p class="muted">${s.price.segments.map((x) => `${x.startTime}–${x.endTime}: ${money(x.amount)}`).join(" · ")}</p></details>` : ""}
  <div class="action-row">${d.owner ? `<button class="button button-primary" data-action="selected-manual">Nhập thuê trực tiếp / khóa lịch</button>` : state.user && state.user.role !== "RENTER" ? '<p class="muted">Dùng tài khoản người thuê để đặt sân.</p>' : `<input id="bookingNote" maxlength="500" placeholder="Ghi chú cho chủ sân"><button class="button button-primary" data-action="book-selected" ${!s.price ? "disabled" : ""}>${state.user ? "Gửi yêu cầu đặt sân" : "Đăng nhập để đặt sân"}</button>`}<button class="button button-ghost" data-action="clear-selection">Bỏ chọn</button></div>${s.error ? `<p class="form-error">${esc(s.error)}</p>` : ""}`;
}
async function chooseSlot(button) {
  const d = state.detail,
    date = button.dataset.date,
    index = Number(button.dataset.index),
    id = button.dataset.court;
  const day =
    date === d.date ? d.schedule : d.week?.find((x) => x.date === date);
  const c = day?.courts.find((c) => c.id === id);
  if (!c) return;
  const slot = c.slots[index];
  d.courtId = id;
  if (d.owner && slot.bookingId) {
    const booking = c.occupied.find((b) => b.id === slot.bookingId);
    if (booking?.source !== "ONLINE" && booking?.status === "CONFIRMED")
      return openManual(id, booking, date);
    renderSchedule();
    toast("Lịch online được xử lý trong danh sách yêu cầu đặt sân.");
    return;
  }
  if (!c.active || d.venue.status !== "ACTIVE") {
    toast("Sân chưa hoạt động hoặc chưa được kiểm duyệt.", true);
    return;
  }
  if (!d.owner && !isSelectableSlot(slot, date)) {
    toast("Khung giờ này đã bắt đầu hoặc không còn trống.", true);
    return;
  }
  const previous = state.selection,
    extend =
      previous &&
      previous.courtId === id &&
      previous.date === date &&
      !previous.complete;
  const anchor = extend ? previous.anchor : index;
  const range = selectRange(c.slots, anchor, index, d.owner);
  const s = (state.selection = {
    ...range,
    courtId: id,
    date,
    anchor,
    complete: !!extend,
    price: null,
  });
  renderSchedule();
  if (d.owner) {
    s.price = {
      totalAmount: Math.round(
        c.slots
          .slice(s.first, s.last + 1)
          .reduce((sum, x) => sum + x.pricePerHour / 2, 0),
      ),
    };
    renderSelection();
    return;
  }
  try {
    const price = await api(
      `/api/venues/courts/${id}/quote?${new URLSearchParams({ startsAt: s.startsAt, endsAt: s.endsAt })}`,
    );
    if (state.selection === s) {
      s.price = price;
      renderSelection();
    }
  } catch (e) {
    if (state.selection === s) {
      s.error = e.message;
      renderSelection();
    }
    throw e;
  }
}
function showEditor(title, content, context) {
  state.editor = context;
  $("#editorContent").innerHTML =
    `<h2 id="editorTitle">${esc(title)}</h2>${content}`;
  useHalfHourSelects($("#editorContent"));
  $("#editorModal .form-error").textContent = "";
  openModal("editorModal");
}
function courtInfo(id) {
  const c = state.detail.venue.courts.find((c) => c.id === id);
  showEditor(
    c.name,
    `${courtGallery(c, state.detail.venue)}<div class="court-info"><p>${esc(c.sport_type)} · ${esc(c.surface || "")}</p><p>${c.active ? "Đang cho thuê" : "Tạm dừng"}</p></div><p>${esc(c.description || "Chưa có mô tả thêm.")}</p>${rulesMarkup(c)}`,
    { kind: "info" },
  );
}
function field(name, label, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function courtDraft(c = {}) {
  return `
    <div class="court-draft">
      <div class="form-row">
        ${field("courtName", "Tên sân", c.name || "", "text", 'required minlength="2" maxlength="100"')}
        ${field("sportType", "Môn thể thao", c.sport_type || "Cầu lông", "text", 'required maxlength="60"')}
        ${field("surface", "Mặt sân", c.surface || "", "text", 'maxlength="80"')}
        ${field("pricePerHour", "Giá cơ bản / giờ (VNĐ)", c.price_per_hour ?? 120000, "number", 'required min="0" max="100000000" step="1"')}
      </div>

      ${courtImageEditor(c)}

      <label>
        Mô tả sân
        <textarea name="courtDescription" maxlength="2000">${esc(c.description || "")}</textarea>
      </label>

      <label>
        Hoạt động
        <select name="active">
          <option value="true" ${c.active !== false ? "selected" : ""}>Cho thuê</option>
          <option value="false" ${c.active === false ? "selected" : ""}>Tạm dừng</option>
        </select>
      </label>
    </div>`;
}

function openVenue(edit = false) {
  const v = edit ? state.detail.venue : {};

  showEditor(
    edit ? "Cập nhật & gửi kiểm duyệt lại" : "Đăng ký cụm sân",
    `<form id="venueEditor">
      <p class="muted">
        ${edit
          ? "Cập nhật thông tin cụm sân sẽ gửi hồ sơ về trạng thái chờ kiểm duyệt; lịch đã đặt vẫn được giữ."
          : "Thêm ít nhất một sân. Cụm sân sẽ hiển thị sau khi admin kiểm duyệt."}
      </p>

      ${field("name", "Tên cụm sân", v.name || "", "text", 'required minlength="3" maxlength="160"')}
      ${field("address", "Địa chỉ", v.address || "", "text", 'required minlength="5" maxlength="255"')}

      <div class="form-row">
        ${field("ward", "Phường / xã", v.ward || "")}
        ${field("city", "Tỉnh / thành phố", v.city || "Hồ Chí Minh", "text", 'required minlength="2"')}
        ${field("imageUrl", "URL ảnh cụm sân", v.image_url || "", "text")}
      </div>

      <label>
        Upload ảnh cụm sân
        <input name="venuePhoto" type="file" accept="image/jpeg,image/png,image/webp">
      </label>

      <div class="form-row">
        ${field("openTime", "Mở cửa", v.open_time?.slice(0, 5) || "06:00", "time", 'required step="1800"')}
        ${field("closeTime", "Đóng cửa", v.close_time?.slice(0, 5) || "23:00", "time", 'required step="1800"')}
      </div>

      <label>
        Mô tả
        <textarea name="description" maxlength="2000">${esc(v.description || "")}</textarea>
      </label>

      ${field(
        "amenities",
        "Tiện ích (ngăn cách dấu phẩy)",
        v.amenities?.join(", ") || "Bãi xe, Nước uống",
      )}

      ${!edit
        ? `<h3>Các sân trong cụm</h3>
           <div id="draftCourts">${courtDraft()}</div>
           <button type="button" class="button button-ghost" data-action="add-draft">+ Thêm sân</button>`
        : ""}

      <button class="button button-primary">
        ${edit ? "Lưu & gửi kiểm duyệt lại" : "Gửi đăng ký cụm sân"}
      </button>
    </form>`,
    { kind: "venue", id: v.id || null },
  );
}
function ruleRow(
  rule = {
    day_of_week: null,
    start_time: "17:00",
    end_time: "21:00",
    price_per_hour: 180000,
  },
) {
  return `<div class="rule-row"><label>Ngày<select name="ruleDay"><option value="" ${rule.day_of_week === null ? "selected" : ""}>Mỗi ngày</option>${dayNames.map((name, i) => `<option value="${i}" ${rule.day_of_week === i ? "selected" : ""}>${name}</option>`).join("")}</select></label>${field("ruleStart", "Từ", rule.start_time.slice(0, 5), "time", 'required step="1800"')}${field("ruleEnd", "Đến", rule.end_time.slice(0, 5), "time", 'required step="1800"')}${field("rulePrice", "VNĐ / giờ", rule.price_per_hour, "number", 'required min="0" step="1" max="100000000"')}<button type="button" class="icon-button" data-action="remove-rule" aria-label="Xóa khung giá">×</button></div>`;
}
function readCourt(root) {
  return {
    name: $("[name=courtName]", root).value,
    sportType: $("[name=sportType]", root).value,
    surface: $("[name=surface]", root).value,
    pricePerHour: Number($("[name=pricePerHour]", root).value),
    imageUrls: JSON.parse($("[name=courtImages]", root).value || "[]"),
    description: $("[name=courtDescription]", root).value,
    active: $("[name=active]", root).value === "true",
    pricingRules: $$(".rule-row", root).map((r) => ({
      dayOfWeek:
        $("[name=ruleDay]", r).value === ""
          ? null
          : Number($("[name=ruleDay]", r).value),
      startTime: $("[name=ruleStart]", r).value,
      endTime: $("[name=ruleEnd]", r).value,
      pricePerHour: Number($("[name=rulePrice]", r).value),
    })),
  };
}
function openCourt(id = null) {
  const c = id ? state.detail.venue.courts.find((c) => c.id === id) : null;
  showEditor(
    c ? "Cập nhật sân & bảng giá" : "Thêm sân vào cụm",
    `<form id="courtEditor">${courtDraft(c || {})}<h3>Giá theo khung giờ</h3><p class="muted">Giờ mở cửa ${state.detail.venue.open_time.slice(0, 5)}–${state.detail.venue.close_time.slice(0, 5)}. Phần không có giá riêng dùng giá cơ bản. Giá theo thứ ưu tiên hơn “Mỗi ngày”. Các khung cùng thứ không được chồng nhau.</p><div id="ruleList">${(c?.pricingRules || []).map(ruleRow).join("")}</div><button class="button button-ghost" type="button" data-action="add-rule">+ Khung giá</button><button class="button button-primary">Lưu sân</button></form>`,
    { kind: "court", id },
  );
}
function openManual(courtId, booking = null, date = state.detail.date) {
  const s = state.selection?.courtId === courtId ? state.selection : null,
    c = state.detail.venue.courts.find((c) => c.id === courtId),
    v = state.detail.venue;
  showEditor(
    booking ? "Sửa lịch nhập thủ công" : "Nhập thuê trực tiếp / khóa lịch",
    `<form id="manualEditor"><p><strong>${esc(c.name)}</strong> · ${esc(v.name)}</p><label>Loại lịch<select name="source"><option value="WALK_IN" ${booking?.source !== "BLOCK" ? "selected" : ""}>Khách thuê trực tiếp</option><option value="BLOCK" ${booking?.source === "BLOCK" ? "selected" : ""}>Khóa lịch / bảo trì</option></select></label><div class="form-row">${field("date", "Ngày", booking ? localDate(booking.starts_at) : s?.date || date, "date", "required")}${field("startTime", "Bắt đầu", booking ? hh(booking.starts_at) : s?.startTime || v.open_time.slice(0, 5), "time", 'required step="1800"')}${field("endTime", "Kết thúc", booking ? hh(booking.ends_at) : s?.endTime || "07:00", "time", 'required step="1800"')}${field("guestName", "Tên khách (bắt buộc nếu thuê trực tiếp)", booking?.guest_name || "", "text", 'maxlength="120"')}${field("guestPhone", "Số điện thoại", booking?.guest_phone || "", "tel", 'maxlength="20"')}</div><label>Ghi chú<textarea name="note" maxlength="500">${esc(booking?.note || "")}</textarea></label><p class="muted">Giá được tính trên server theo bảng giá của sân. Lịch khóa có giá 0đ. Cả hai loại đều chặn đặt online trong khoảng đã chọn.</p><button class="button button-primary">Lưu lịch</button></form>`,
    { kind: "manual", id: booking?.id || null, courtId },
  );
}
async function loadMyBookings() {
  const data = await api("/api/bookings/my");
  $("#myBookingList").innerHTML = data.items.length
    ? data.items
        .map(
          (b) =>
            `<article class="booking-item"><div><h3>${esc(b.venue_name)}</h3><p>${esc(b.court_name)} · ${esc(b.sport_type)}</p><small>${dt(b.starts_at)} → ${hh(b.ends_at)}</small></div><div>${badge(b.status)}<p>Mã: ${esc(b.booking_code)}</p><small>${esc(b.owner_note || "")}</small></div><div class="booking-amount"><strong>${money(b.total_amount)}</strong>${["PENDING", "CONFIRMED"].includes(b.status) && new Date(b.starts_at) > new Date() ? `<br><button class="button button-danger button-small" data-action="cancel-booking" data-id="${b.id}">Hủy lịch</button>` : ""}</div></article>`,
        )
        .join("")
    : empty("Bạn chưa có lịch đặt nào.");
}
const statCards = (pairs) =>
  pairs
    .map(
      ([name, value]) =>
        `<article class="stat-card"><span>${esc(name)}</span><strong>${esc(value)}</strong></article>`,
    )
    .join("");
async function loadOwner() {
  const [venues, bookings, revenue] = await Promise.all([
    api("/api/owner/venues"),
    api(`/api/owner/bookings?status=${$("#ownerStatusFilter").value}`),
    api("/api/owner/revenue"),
  ]);
  const s = revenue.summary;
  $("#ownerStats").innerHTML = statCards([
    ["Doanh thu đã xác nhận", money(s.revenue)],
    ["Lượt đặt", s.bookings],
    ["Chờ xác nhận", s.pending],
    ["Cụm sân", venues.items.length],
  ]);
  $("#revenueList").innerHTML = revenue.monthly.length
    ? `<table><thead><tr><th>Tháng</th><th>Lượt đặt</th><th>Doanh thu</th></tr></thead><tbody>${revenue.monthly.map((m) => `<tr><td>${m.month}</td><td>${m.bookings}</td><td>${money(m.revenue)}</td></tr>`).join("")}</tbody></table>`
    : empty("Chưa có doanh thu đã xác nhận.");
  $("#ownerVenueList").innerHTML = venues.items.length
    ? venues.items
        .map(
          (v) =>
            `<div class="stack-item"><div><h4>${esc(v.name)} ${badge(v.status)}</h4><p>${esc(formatAddress(v.address, v.district))} · ${v.court_count} sân</p>${v.review_note ? `<small class="form-error">${esc(v.review_note)}</small>` : ""}</div><button class="button button-primary button-small" data-action="owner-schedule" data-venue="${v.id}">Quản lý & xem lịch</button></div>`,
        )
        .join("")
    : empty("Chưa có cụm sân. Nhấn “Đăng ký cụm sân” để bắt đầu.");
  $("#ownerBookingList").innerHTML = bookings.items.length
    ? `<table><thead><tr><th>Người thuê / nguồn</th><th>Sân & lịch</th><th>Giá</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${bookings.items.map((b) => `<tr><td><strong>${esc(b.renter_name)}</strong><small>${esc(b.renter_phone || "")} · ${sourceNames[b.source]}</small></td><td><strong>${esc(b.court_name)} · ${esc(b.venue_name)}</strong><small>${dt(b.starts_at)} → ${hh(b.ends_at)}</small></td><td>${money(b.total_amount)}</td><td>${badge(b.status)}</td><td>${b.status === "PENDING" ? `<div class="action-row"><button class="button button-primary button-small" data-action="booking-status" data-id="${b.id}" data-status="CONFIRMED">Duyệt</button><button class="button button-danger button-small" data-action="booking-status" data-id="${b.id}" data-status="REJECTED">Từ chối</button></div>` : "—"}</td></tr>`).join("")}</tbody></table>`
    : empty("Không có lịch phù hợp.");
}
function adminVenueRow(v) {
  return `<div class="stack-item"><div><h4>${esc(v.name)} ${badge(v.status)}</h4><p>${esc(v.owner_name)} · ${esc(formatAddress(v.district, v.city))} · ${v.court_count} sân</p></div><button class="button button-ghost button-small" data-action="review" data-id="${v.id}">Xem hồ sơ</button></div>`;
}
async function loadAdmin() {
  const [stats, venues, users] = await Promise.all([
    api("/api/admin/stats"),
    api("/api/admin/venues"),
    api("/api/admin/users"),
  ]);
  const s = stats.stats;
  $("#adminStats").innerHTML = statCards([
    ["Người dùng", s.users],
    ["Cụm sân", s.venues],
    ["Chờ kiểm duyệt", s.pending_venues],
    ["Doanh thu đã xác nhận", money(s.gross_revenue)],
  ]);
  $("#adminQueue").innerHTML =
    venues.items
      .filter((v) => v.status === "PENDING")
      .map(adminVenueRow)
      .join("") || empty("Không có cụm sân đang chờ kiểm duyệt.");
  $("#adminVenueList").innerHTML =
    venues.items.map(adminVenueRow).join("") || empty("Chưa có cụm sân.");
  $("#adminUserList").innerHTML = users.items
    .map(
      (u) =>
        `<div class="stack-item"><div><h4>${esc(u.full_name)} ${badge(u.status)}</h4><p>${esc(u.email)} · ${roles[u.role]}</p></div>${u.id === state.user.id ? "Bạn" : `<button class="button ${u.status === "ACTIVE" ? "button-danger" : "button-ghost"} button-small" data-action="user-status" data-id="${u.id}" data-status="${u.status === "ACTIVE" ? "BLOCKED" : "ACTIVE"}">${u.status === "ACTIVE" ? "Khóa" : "Mở khóa"}</button>`}</div>`,
    )
    .join("");
}
async function openReview(id) {
  const v = await api(`/api/admin/venues/${id}`);
  showEditor(
    `Hồ sơ · ${v.name}`,
    `${photo(v.image_url, "review-image")}<div class="review-details"><h3>${esc(v.name)} ${badge(v.status)}</h3><p>Chủ sân: ${esc(v.owner_name)} · ${esc(v.owner_email)}</p><p>${esc(formatAddress(v.address, v.ward, v.district, v.city))}</p><p>${esc(v.description || "")}</p><p>Giờ mở cửa: ${v.open_time.slice(0, 5)}–${v.close_time.slice(0, 5)}</p><p>Tiện ích: ${esc(v.amenities.join(", "))}</p>${v.review_note ? `<p>Phản hồi: ${esc(v.review_note)}</p>` : ""}</div><h3>Các sân đăng ký (${v.courts.length})</h3>${v.courts.map((c) => `<div class="court-draft">${courtGallery(c, v)}<h3>${esc(c.name)}</h3><p>${esc(c.sport_type)} · ${esc(c.surface || "")} · ${esc(c.description || "")}</p>${rulesMarkup(c)}</div>`).join("")}<form id="reviewEditor"><label>Nhận xét / lý do từ chối<textarea name="reviewNote" maxlength="1000"></textarea></label><div class="action-row">${v.status === "PENDING" ? '<button name="decision" value="ACTIVE" class="button button-primary">Duyệt cụm sân</button><button name="decision" value="REJECTED" class="button button-danger">Từ chối</button>' : v.status === "ACTIVE" ? '<button name="decision" value="INACTIVE" class="button button-danger">Tạm dừng</button>' : v.status === "INACTIVE" ? '<button name="decision" value="ACTIVE" class="button button-primary">Kích hoạt lại</button>' : '<p class="muted">Chủ sân cần sửa hồ sơ và gửi lại để kiểm duyệt.</p>'}</div></form>`,
    { kind: "review", id },
  );
}
async function action(button) {
  const a = button.dataset.action,
    d = state.detail;
if (a === "remove-court-image" || a === "cover-court-image") {
  const editor = button.closest(".court-images");
  const stored = $("[name=courtImages]", editor);
  const urls = JSON.parse(stored.value || "[]");
  const index = Number(button.dataset.index);

  if (!Number.isInteger(index) || index < 0 || index >= urls.length) {
    return;
  }

  const [url] = urls.splice(index, 1);
  if (a === "cover-court-image") urls.unshift(url);

  stored.value = JSON.stringify(urls);
  $(".court-image-list", editor).innerHTML = courtImageList(urls);
  return;
}
  if (a === "page") {
    state.page = Number(button.dataset.page);
    return loadCourts();
  }
  if (a === "schedule")
    return openSchedule(button.dataset.venue, button.dataset.court);
  if (a === "owner-schedule")
    return openSchedule(button.dataset.venue, null, true, localDate());
  if (a === "new-venue") return openVenue();
  if (a === "edit-venue") return openVenue(true);
  if (a === "new-court") return openCourt();
  if (a === "edit-court") return openCourt(button.dataset.court);
  if (a === "court-info") return courtInfo(button.dataset.court);
  if (a === "select-court") {
    d.courtId = button.dataset.court;
    state.selection = null;
    return renderSchedule();
  }
  if (a === "refresh-admin") return loadAdmin();
  if (a === "calendar-day") {
    state.calendarMode = "day";
    state.selection = null;
    return renderSchedule();
  }
  if (a === "calendar-week") {
    state.calendarMode = "week";
    state.selection = null;
    renderSchedule();
    return loadWeek();
  }
  if (a === "refresh-schedule") return refreshSchedule();
  if (a === "prev-day" || a === "next-day") {
    const date = addDays(d.date, a === "prev-day" ? -1 : 1);
    if (!d.owner && date < localDate()) return;
    d.date = date;
    return refreshSchedule();
  }
  if (a === "slot") return chooseSlot(button);
  if (a === "clear-selection") {
    state.selection = null;
    return renderSchedule();
  }
  if (a === "new-manual") return openManual(button.dataset.court);
  if (a === "selected-manual") return openManual(state.selection.courtId);
  if (a === "edit-manual") {
    const c = d.schedule.courts.find((c) => c.id === button.dataset.court);
    return openManual(
      c.id,
      c.occupied.find((b) => b.id === button.dataset.id),
    );
  }
  if (a === "cancel-manual") {
    if (!confirm("Hủy lịch nhập thủ công này và mở lại khung giờ?")) return;
    await send(
      `/api/owner/manual-bookings/${button.dataset.id}/cancel`,
      "PATCH",
    );
    toast("Đã hủy lịch");
    await refreshSchedule();
    return loadOwner();
  }
  if (a === "resubmit") {
    await send(`/api/owner/venues/${d.venue.id}/resubmit`, "POST");
    toast("Đã gửi lại kiểm duyệt");
    await refreshSchedule();
    return loadOwner();
  }
  if (a === "add-rule") {
    const v = d.venue;
    $("#ruleList").insertAdjacentHTML(
      "beforeend",
      ruleRow({
        day_of_week: null,
        start_time: v.open_time,
        end_time: v.close_time,
        price_per_hour: 180000,
      }),
    );
    return;
  }
  if (a === "remove-rule") {
    button.closest(".rule-row").remove();
    return;
  }
  if (a === "add-draft") {
    if ($$(".court-draft", $("#draftCourts")).length >= 30)
      throw new Error("Tối đa 30 sân khi đăng ký");
    $("#draftCourts").insertAdjacentHTML(
      "beforeend",
      courtDraft() +
        '<button type="button" class="button button-danger button-small" data-action="remove-draft">Xóa sân vừa thêm</button>',
    );
    return;
  }
  if (a === "remove-draft") {
    button.previousElementSibling.remove();
    button.remove();
    return;
  }
  if (a === "book-selected") {
    if (!state.user) {
      openModal("authModal");
      return;
    }
    if (state.user.role !== "RENTER")
      throw new Error("Dùng tài khoản người thuê để đặt sân");
    const s = state.selection;
    if (!s?.price) throw new Error("Chọn khoảng giờ trước khi đặt sân");
    try {
      await send("/api/bookings", "POST", {
        courtId: s.courtId,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        note: $("#bookingNote").value,
        expectedAmount: s.price.totalAmount,
      });
      closeModals();
      toast("Đã gửi yêu cầu. Khung giờ được giữ trong khi chủ sân duyệt.");
      await route("bookings");
    } catch (e) {
      if (e.status === 409) await refreshSchedule();
      throw e;
    }
    return;
  }
  if (a === "cancel-booking") {
    if (!confirm("Hủy lịch đặt này?")) return;
    await send(`/api/bookings/${button.dataset.id}/cancel`, "PATCH");
    toast("Đã hủy lịch");
    return loadMyBookings();
  }
  if (a === "booking-status") {
    await send(`/api/owner/bookings/${button.dataset.id}/status`, "PATCH", {
      status: button.dataset.status,
    });
    toast("Đã xử lý yêu cầu");
    return loadOwner();
  }
  if (a === "review") return openReview(button.dataset.id);
  if (a === "user-status") {
    await send(`/api/admin/users/${button.dataset.id}/status`, "PATCH", {
      status: button.dataset.status,
    });
    toast("Đã cập nhật tài khoản");
    return loadAdmin();
  }
}
document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-modal],[data-close-editor]");
  if (close) {
    if (close.closest("#editorModal")) closeEditor();
    else if (close.closest("#authModal") && state.detail) {
      $("#authModal").classList.remove("open");
      document.body.style.overflow = "hidden";
    } else closeModals();
    return;
  }
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    event.preventDefault();
    guard(() => route(routeButton.dataset.route), routeButton);
    return;
  }
  const authButton = event.target.closest("[data-auth]");
  if (authButton) {
    const login = authButton.dataset.auth === "login";
    $("#loginForm").classList.toggle("hidden", !login);
    $("#registerForm").classList.toggle("hidden", login);
    $("#authTitle").textContent = login ? "Đăng nhập" : "Tạo tài khoản";
    $("#authModal .form-error").textContent = "";
    $$("[data-auth]").forEach((b) => {
      b.classList.toggle("button-primary", b === authButton);
      b.classList.toggle("button-ghost", b !== authButton);
    });
    return;
  }
  const button = event.target.closest("[data-action]");
  if (button) {
    event.preventDefault();
    guard(() => action(button), button);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "scheduleDate") {
    if (!event.target.value) return;
    state.detail.date = event.target.value;
    guard(() => refreshSchedule());
  }
  if (event.target.id === "weekCourt") {
    state.detail.courtId = event.target.value;
    state.selection = null;
    renderSchedule();
  }
  if (event.target.id === "ownerStatusFilter") guard(() => loadOwner());
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if ($("#editorModal.open")) closeEditor();
    else closeModals();
  }
});
$("#loginButton").addEventListener("click", () => openModal("authModal"));
$("#logoutButton").addEventListener("click", () => logout());
$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  guard(() => loadCourts(true), $("button[type=submit]", event.target));
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.id === "searchForm") return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form)),
    button = event.submitter;
  const context = state.editor;
  guard(async () => {
    const error = $(".form-error", form.closest(".modal"));
    if (error) error.textContent = "";
    if (form.id === "loginForm")
      return finishAuth(await send("/api/auth/login", "POST", data));
    if (form.id === "registerForm") {
      if (!data.phone) delete data.phone;
      return finishAuth(await send("/api/auth/register", "POST", data));
    }
    if (form.id === "venueEditor") {
	await uploadChosenImage(
	  $('[name=venuePhoto]', form),
	  $('[name=imageUrl]', form),
	);

        for (const draft of $$(".court-draft", form)) {
	  await uploadCourtPhotos(draft);
	}

	data.imageUrl = $('[name=imageUrl]', form).value;
      const body = {
        ...data,
        amenities: data.amenities
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
[
  "courtName",
  "sportType",
  "surface",
  "pricePerHour",
  "courtImages",
  "courtPhotos",
  "courtDescription",
  "active",
  "venuePhoto",
].forEach((key) => delete body[key]);
      if (!context.id) body.courts = $$(".court-draft", form).map(readCourt);
      await send(
        context.id ? `/api/owner/venues/${context.id}` : "/api/owner/venues",
        context.id ? "PUT" : "POST",
        body,
      );
      closeEditor();
      toast("Hồ sơ đã được gửi để kiểm duyệt.");
      if (state.detail) await refreshSchedule();
      await loadOwner();
      return;
    }
    if (form.id === "courtEditor") {
      await uploadCourtPhotos(form);
      await send(
        context.id
          ? `/api/owner/courts/${context.id}`
          : `/api/owner/venues/${state.detail.venue.id}/courts`,
        context.id ? "PUT" : "POST",
        readCourt(form),
      );
      closeEditor();
      toast("Đã lưu thông tin sân và bảng giá");
      await refreshSchedule();
      await loadOwner();
      return;
    }
    if (form.id === "manualEditor") {
      const body = {
        courtId: context.courtId,
        startsAt: iso(data.date, data.startTime),
        endsAt: iso(data.date, data.endTime),
        source: data.source,
        guestName: data.guestName,
        guestPhone: data.guestPhone,
        note: data.note,
      };
      try {
        await send(
          context.id
            ? `/api/owner/manual-bookings/${context.id}`
            : "/api/owner/manual-bookings",
          context.id ? "PUT" : "POST",
          body,
        );
      } catch (e) {
        if (e.status === 409) await refreshSchedule();
        throw e;
      }
      closeEditor();
      toast("Đã lưu lịch thủ công");
      state.detail.date = data.date;
      state.detail.courtId = context.courtId;
      await refreshSchedule();
      await loadOwner();
      return;
    }
    if (form.id === "reviewEditor") {
      await send(`/api/admin/venues/${context.id}/status`, "PATCH", {
        status: button.value,
        reviewNote: data.reviewNote,
      });
      closeEditor();
      toast("Đã xử lý hồ sơ");
      await loadAdmin();
      await loadCourts();
    }
  }, button);
});
useHalfHourSelects();
$("#dateFilter").min = localDate();
updateAuth();
guard(() => loadCourts());
if (state.token)
  guard(async () => {
    const data = await api("/api/auth/me");
    state.user = data.user;
    localStorage.setItem("sporthub_user", JSON.stringify(data.user));
    updateAuth();
  });
setInterval(() => {
  if (
    state.detail &&
    $("#detailModal.open") &&
    !$("#editorModal.open") &&
    !document.hidden
  )
    guard(() => refreshSchedule(false));
}, 30000);
