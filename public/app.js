(function () {
  "use strict";

  /* ================================================================
     PIN / TOKEN SYSTEM
     PIN: 0969 | Token expires after 8 hours (stored in localStorage)
  ================================================================ */
  const TOKEN_KEY = "ll_auth_v1";
  const TOKEN_EXPIRY_MS = 8 * 60 * 60 * 1000;

  function saveToken() {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ expires: Date.now() + TOKEN_EXPIRY_MS }));
  }
  function isTokenValid() {
    try {
      var t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "{}");
      return !!(t.expires && t.expires > Date.now());
    } catch (e) { return false; }
  }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  var pinScreenEl     = document.getElementById("pinScreen");
  var systemSelectorEl = document.getElementById("systemSelector");
  var rentSystemEl    = document.getElementById("rentSystem");
  var financialSystemEl = document.getElementById("financialSystem");

  function showScreen(name) {
    pinScreenEl.classList.toggle("hidden", name !== "pin");
    systemSelectorEl.classList.toggle("hidden", name !== "selector");
    rentSystemEl.classList.toggle("hidden", name !== "rent");
    financialSystemEl.classList.toggle("hidden", name !== "financial");
  }

  // Show PIN screen initially; openSelector() below handles token-valid case
  showScreen("pin");

  /* ---- PIN pad ---- */
  var CORRECT_PIN  = "0969";
  var pinEntry     = "";
  var pinAttempts  = 0;
  var pinLocked    = false;
  var pinDots      = document.querySelectorAll(".pin-dot");
  var pinHint      = document.getElementById("pinHint");
  var pinCard      = document.querySelector(".pin-card");
  var pinLockIcon  = document.getElementById("pinLockIcon");

  function updatePinDots() {
    pinDots.forEach(function (dot, i) {
      dot.classList.toggle("filled", i < pinEntry.length);
      dot.classList.remove("error", "success");
    });
  }

  function pinError() {
    pinAttempts++;
    pinDots.forEach(function (dot) { dot.classList.add("error"); });
    pinCard.classList.add("shake");

    var remaining = 5 - pinAttempts;
    if (pinAttempts >= 3 && remaining > 0) {
      pinHint.textContent = "Incorrect PIN — " + remaining + " attempt" + (remaining === 1 ? "" : "s") + " left";
    } else if (pinAttempts >= 5) {
      pinHint.textContent = "Too many attempts. Try again in 30 seconds.";
      pinHint.className = "pin-hint warning";
      pinLocked = true;
      document.querySelectorAll(".pin-key[data-digit]").forEach(function (k) { k.disabled = true; });
      setTimeout(function () {
        pinLocked = false;
        pinAttempts = 0;
        document.querySelectorAll(".pin-key[data-digit]").forEach(function (k) { k.disabled = false; });
        pinHint.textContent = "Enter your 4-digit PIN to continue";
        pinHint.className = "pin-hint";
      }, 30000);
    } else {
      pinHint.textContent = "Incorrect PIN — please try again";
    }
    pinHint.className = "pin-hint " + (pinAttempts >= 5 ? "warning" : "error");

    setTimeout(function () {
      pinEntry = "";
      updatePinDots();
      pinCard.classList.remove("shake");
      if (!pinLocked) {
        pinHint.textContent = pinAttempts >= 3 ? "Enter your PIN — " + (5 - pinAttempts) + " attempt" + ((5 - pinAttempts) === 1 ? "" : "s") + " remaining" : "Enter your 4-digit PIN to continue";
        pinHint.className = "pin-hint" + (pinAttempts >= 3 ? " warning" : "");
      }
    }, 1100);
  }

  function pinSuccess() {
    pinAttempts = 0;
    pinDots.forEach(function (dot) { dot.classList.add("success"); });
    if (pinLockIcon) { pinLockIcon.textContent = "🔓"; pinLockIcon.classList.add("unlocked"); }
    pinHint.textContent = "Access granted — welcome back!";
    pinHint.className = "pin-hint success";
    saveToken();
    setTimeout(function () {
      pinEntry = "";
      updatePinDots();
      pinHint.textContent = "Enter your 4-digit PIN to continue";
      pinHint.className = "pin-hint";
      if (pinLockIcon) { pinLockIcon.textContent = "🔒"; pinLockIcon.classList.remove("unlocked"); }
      openSelector();
    }, 700);
  }

  function pinPress(digit) {
    if (pinLocked || pinEntry.length >= 4) return;
    pinEntry += digit;
    updatePinDots();
    if (pinEntry.length === 4) {
      setTimeout(function () {
        if (pinEntry === CORRECT_PIN) pinSuccess();
        else pinError();
      }, 80);
    }
  }

  function pinDelete() {
    if (pinLocked || !pinEntry.length) return;
    pinEntry = pinEntry.slice(0, -1);
    updatePinDots();
  }

  document.querySelectorAll(".pin-key[data-digit]").forEach(function (btn) {
    btn.addEventListener("click", function () { pinPress(this.dataset.digit); });
  });
  document.getElementById("pinDelBtn").addEventListener("click", pinDelete);
  document.addEventListener("keydown", function (e) {
    if (!pinScreenEl.classList.contains("hidden")) {
      if (e.key >= "0" && e.key <= "9") pinPress(e.key);
      else if (e.key === "Backspace") pinDelete();
    }
  });

  /* ================================================================
     TOAST NOTIFICATION SYSTEM
  ================================================================ */
  var toastContainer = document.getElementById("toastContainer");

  function toast(type, title, msg, duration) {
    var el = document.createElement("div");
    el.className = "toast " + (type || "info");
    var icons = { success: "✓", error: "✕", warning: "!", info: "i" };
    el.innerHTML =
      '<div class="toast-icon">' + (icons[type] || "i") + '</div>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + escHtmlEarly(title || "") + '</div>' +
        (msg ? '<div class="toast-msg">' + escHtmlEarly(msg) + '</div>' : '') +
      '</div>' +
      '<button class="toast-close" type="button" aria-label="Close">×</button>';

    el.querySelector(".toast-close").addEventListener("click", function () { removeToast(el); });
    toastContainer.appendChild(el);

    var timer = setTimeout(function () { removeToast(el); }, duration || 4500);
    el._toastTimer = timer;
  }

  function removeToast(el) {
    clearTimeout(el._toastTimer);
    el.classList.add("removing");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
  }

  function escHtmlEarly(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- System routing ---- */
  /* ---- Selector greeting & live clock ---- */
  var greetingEl  = document.getElementById("selectorGreeting");
  var clockEl     = document.getElementById("selectorDateTime");
  var clockTicker = null;

  function getGreeting() {
    var h = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }));
    if (h < 5)  return "Good night! 🌙";
    if (h < 12) return "Good morning! ☀️";
    if (h < 18) return "Good afternoon! 👋";
    return "Good evening! 🌆";
  }

  function refreshSelectorClock() {
    if (greetingEl) greetingEl.textContent = getGreeting();
    if (clockEl) {
      var now = new Date();
      clockEl.textContent =
        now.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "long", year: "numeric", month: "long", day: "numeric" }) +
        "  ·  " +
        now.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });
    }
  }

  function openSelector() {
    showScreen("selector");
    refreshSelectorClock();
    clearInterval(clockTicker);
    clockTicker = setInterval(refreshSelectorClock, 30000);
  }

  // Override initial show if token valid
  if (isTokenValid()) openSelector();

  document.getElementById("logoutBtn").addEventListener("click", function () {
    clearToken();
    clearInterval(clockTicker);
    showScreen("pin");
  });
  document.getElementById("goToRentSystem").addEventListener("click", function () {
    clearInterval(clockTicker);
    showScreen("rent");
  });
  document.getElementById("goToFinancialSystem").addEventListener("click", function () {
    clearInterval(clockTicker);
    showScreen("financial");
    finInit();
  });
  document.getElementById("rentBackBtn").addEventListener("click", openSelector);
  document.getElementById("finBackBtn").addEventListener("click", openSelector);

  /* ================================================================
     END PIN / ROUTING — rest of app continues below
  ================================================================ */

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const PH_TZ = "Asia/Manila";

  function phNow() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: PH_TZ }));
  }

  function phBillingPeriod() {
    var d = phNow();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  var billingDraft = {
    year: null,
    month: null,
    rooms: {},
    house: { prev: null, curr: null },
  };
  var billingDraftByPeriod = {};

  function billingPeriodCacheKey(year, month) {
    return year + "-" + month;
  }

  function readingValue(raw) {
    if (raw == null || raw === "") return null;
    var n = parseFloat(raw);
    return isFinite(n) ? n : null;
  }

  function cloneBillingDraft(draft) {
    var rooms = {};
    Object.keys(draft.rooms || {}).forEach(function (id) {
      rooms[id] = {
        prev: draft.rooms[id].prev,
        curr: draft.rooms[id].curr,
      };
    });
    return {
      year: draft.year,
      month: draft.month,
      rooms: rooms,
      house: { prev: draft.house.prev, curr: draft.house.curr },
    };
  }

  function captureBillingDraftFromDOM() {
    var year = billingDraft.year || num(el.billingPeriodYear && el.billingPeriodYear.value);
    var month = billingDraft.month || num(el.billingPeriodMonth && el.billingPeriodMonth.value);
    if (!year || !month) return;
    billingDraft.year = year;
    billingDraft.month = month;
    if (el.billingHousePrev) {
      billingDraft.house.prev = readingValue(el.billingHousePrev.value);
    }
    if (el.billingHouseCurr) {
      billingDraft.house.curr = readingValue(el.billingHouseCurr.value);
    }
    if (el.billingRoomMeters) {
      el.billingRoomMeters.querySelectorAll(".billing-room-meter").forEach(function (card) {
        var roomId = Number(card.dataset.roomId);
        var prevInput = card.querySelector(".billing-room-prev");
        var currInput = card.querySelector(".billing-room-curr");
        if (!roomId || !prevInput || !currInput) return;
        if (!billingDraft.rooms[roomId]) billingDraft.rooms[roomId] = { prev: null, curr: null };
        billingDraft.rooms[roomId].prev = readingValue(prevInput.value);
        billingDraft.rooms[roomId].curr = readingValue(currInput.value);
      });
    }
    billingDraftByPeriod[billingPeriodCacheKey(billingDraft.year, billingDraft.month)] =
      cloneBillingDraft(billingDraft);
  }

  function loadBillingDraftForPeriod(year, month) {
    var key = billingPeriodCacheKey(year, month);
    if (billingDraftByPeriod[key]) {
      var cached = billingDraftByPeriod[key];
      billingDraft.year = year;
      billingDraft.month = month;
      billingDraft.rooms = {};
      Object.keys(cached.rooms || {}).forEach(function (id) {
        billingDraft.rooms[id] = { prev: cached.rooms[id].prev, curr: cached.rooms[id].curr };
      });
      billingDraft.house = { prev: cached.house.prev, curr: cached.house.curr };
      return;
    }
    billingDraft.year = year;
    billingDraft.month = month;
    billingDraft.rooms = {};
    state.rooms.forEach(function (room) {
      billingDraft.rooms[room.id] = defaultRoomReadings(room.id, year, month);
    });
    billingDraft.house = defaultHouseReadings(year, month);
  }

  function syncBillingMeterInputsFromDraft() {
    if (el.billingHousePrev) {
      el.billingHousePrev.value = billingDraft.house.prev == null ? "" : billingDraft.house.prev;
    }
    if (el.billingHouseCurr) {
      el.billingHouseCurr.value = billingDraft.house.curr == null ? "" : billingDraft.house.curr;
    }
  }

  function hasBillingCurrentReading() {
    if (billingDraft.house.curr != null) return true;
    return state.rooms.some(function (r) {
      var d = billingDraft.rooms[r.id];
      return d && d.curr != null;
    });
  }

  function refreshBillingMetersUI() {
    syncBillingMeterInputsFromDraft();
    renderBillingRoomMeters();
    updateBillingDueLabel();
    updateBillingMeterResults();
  }

  let state = {
    settings: { rate: 15, cost: 0, internet_rate: 250, currency: "₱" },
    rooms: [],
    renters: [],
    meterHistory: { rooms: [], house: [] },
    expenses: [],
    paymentsView: [],
    paymentsCurrent: [],
    roomHistory: [],
  };

  const currentPeriod = phBillingPeriod();
  let viewPeriod = { year: currentPeriod.year, month: currentPeriod.month };

  // Nothing below saves to the database until a section Save button is pressed.
  // `pendingPayments` holds not-yet-saved paid/unpaid toggles, keyed by room+renter+period.
  let pendingPayments = {};

  /* ---------------- API ---------------- */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method: method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = "Something went wrong saving to the database.";
      if (text && text.trim()) {
        try {
          const data = JSON.parse(text);
          if (data && data.error) msg = data.error;
        } catch (e) { /* ignore */ }
      }
      throw new Error(msg);
    }
    if (res.status === 204 || res.status === 205 || !text || !text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Server returned an invalid response.");
    }
  }

  /* ---------------- Section-scoped save system ---------------- */
  const statusBanner = document.getElementById("statusBanner");
  const connStatus = document.getElementById("connStatus");
  const dirtyIndicator = document.getElementById("dirtyIndicator");
  const dirtySections = { rooms: false, renters: false, expenses: false, settings: false };
  const savingSections = { rooms: false, renters: false, expenses: false, settings: false };
  let hideTimer = null;

  function showStatus(type, message, autoHideMs) {
    statusBanner.className = "status-banner show " + type;
    statusBanner.textContent = message;
    clearTimeout(hideTimer);
    if (autoHideMs) {
      hideTimer = setTimeout(function () {
        statusBanner.className = "status-banner";
      }, autoHideMs);
    }
  }

  function isAnyDirty() {
    return Object.keys(dirtySections).some(function (k) { return dirtySections[k]; });
  }

  function markDirty(scope) {
    if (!dirtySections.hasOwnProperty(scope)) return;
    dirtySections[scope] = true;
    updateSaveUI(scope);
  }

  function clearDirty(scope) {
    dirtySections[scope] = false;
    updateSaveUI(scope);
  }

  function updateSaveUI(scope) {
    if (scope) {
      document.querySelectorAll('[data-save-scope="' + scope + '"]').forEach(function (bar) {
        var status = bar.querySelector("[data-save-status]");
        var btn = bar.querySelector("[data-save-btn]");
        var dirty = dirtySections[scope];
        var saving = savingSections[scope];
        if (status) {
          status.textContent = saving ? "Saving…" : (dirty ? "Unsaved changes" : "All saved");
          status.className = "panel-save-status " + (dirty ? "dirty" : "clean");
        }
        if (btn) btn.disabled = saving || !dirty;
      });
    } else {
      Object.keys(dirtySections).forEach(function (s) { updateSaveUI(s); });
    }
    var count = Object.keys(dirtySections).filter(function (k) { return dirtySections[k]; }).length;
    if (dirtyIndicator) {
      dirtyIndicator.textContent = count
        ? count + " section" + (count > 1 ? "s" : "") + " unsaved"
        : "";
      dirtyIndicator.className = "dirty-indicator " + (count ? "dirty" : "clean");
      dirtyIndicator.style.display = count ? "" : "none";
    }
  }

  window.addEventListener("beforeunload", function (e) {
    if (!isAnyDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  function saveFailed(err) {
    showStatus("error", err.message, 6000);
    toast("error", "Save failed", err.message, 6000);
  }

  /* ---------------- Helpers ---------------- */
  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function money(v) {
    const c = state.settings.currency || "₱";
    return c + num(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function kwh(v) {
    const n = num(v);
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " kWh";
  }

  function roomKwh(room, year, month) {
    year = year || currentPeriod.year;
    month = month || currentPeriod.month;
    var hist = (state.roomHistory || []).find(function (h) {
      return h.room_id === room.id && h.period_year === year && h.period_month === month;
    });
    if (hist) return num(hist.kwh_used) || 0;
    if (billingDraft.year === year && billingDraft.month === month && billingDraft.rooms[room.id]) {
      var r = billingDraft.rooms[room.id];
      if (r.curr != null && r.curr !== "") {
        var prev = r.prev != null && r.prev !== "" ? num(r.prev) : num(r.curr);
        return Math.max(0, num(r.curr) - prev);
      }
    }
    return 0;
  }

  function roomRenters(roomId) {
    return state.renters.filter(function (r) { return r.room_id === roomId; });
  }

  function activeRoomRenters(roomId) {
    return state.renters.filter(function (r) {
      return r.room_id === roomId && r.status !== "moved_out";
    });
  }

  function roomOccupancyLimit(room) {
    return Math.max(1, parseInt(room && room.occupant_amount, 10) || 1);
  }

  function roomVacancy(room, excludeRenterId) {
    if (!room) return 0;
    var limit = roomOccupancyLimit(room);
    var count = activeRoomRenters(room.id).filter(function (r) {
      return excludeRenterId == null || r.id !== excludeRenterId;
    }).length;
    return Math.max(0, limit - count);
  }

  function occupancyLimitMessage(room) {
    var limit = roomOccupancyLimit(room);
    return (room.name || "This room") + " allows only " + limit +
      " occupant" + (limit === 1 ? "" : "s") + ". Remove a renter first or raise the occupancy limit.";
  }

  function canAssignRenterToRoom(room, renter) {
    if (!room) return { ok: false, message: "Room not found." };
    if (roomVacancy(room, renter ? renter.id : null) > 0) return { ok: true };
    return { ok: false, message: occupancyLimitMessage(room) };
  }

  function roomsWithRenters() {
    return state.rooms.filter(function (room) {
      return roomRenters(room.id).length > 0;
    });
  }

  function occupiedRoomsKwh(year, month) {
    var total = 0;
    roomsWithRenters().forEach(function (room) {
      total += roomKwh(room, year, month);
    });
    return total;
  }

  function effectiveRent(room) {
    const occupants = room.occupant_amount || 1;
    return occupants * (num(room.rate_per_person) || 0);
  }

  function roomInternet(room) {
    return roomRenters(room.id).length * num(state.settings.internet_rate);
  }

  function houseMeterKwh(year, month) {
    year = year || currentPeriod.year;
    month = month || currentPeriod.month;
    if (billingDraft.year === year && billingDraft.month === month &&
        billingDraft.house.curr != null && billingDraft.house.curr !== "") {
      var prev = billingDraft.house.prev != null && billingDraft.house.prev !== ""
        ? num(billingDraft.house.prev) : num(billingDraft.house.curr);
      return Math.max(0, num(billingDraft.house.curr) - prev);
    }
    var houseRows = (state.meterHistory && state.meterHistory.house) || [];
    var hist = houseRows.find(function (h) {
      return h.period_year === year && h.period_month === month;
    });
    if (hist) {
      if (hist.usage_kwh != null) return num(hist.usage_kwh) || 0;
      return Math.max(0, num(hist.curr_reading) - num(hist.prev_reading));
    }
    return 0;
  }

  function totalRoomsKwh(year, month) {
    year = year || currentPeriod.year;
    month = month || currentPeriod.month;
    let total = 0;
    state.rooms.forEach(function (r) { total += roomKwh(r, year, month); });
    return total;
  }

  function fullName(r) {
    return [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ");
  }

  function durationSince(dateStr) {
    if (!dateStr) return "—";
    var start = new Date(dateStr + "T00:00:00+08:00");
    if (isNaN(start.getTime())) return "—";
    const today = phNow();
    if (start > today) return "—";
    let years = today.getFullYear() - start.getFullYear();
    let months = today.getMonth() - start.getMonth();
    let days = today.getDate() - start.getDate();
    if (days < 0) {
      months -= 1;
      days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    const parts = [];
    if (years > 0) parts.push(years + (years === 1 ? " year" : " years"));
    if (months > 0) parts.push(months + (months === 1 ? " month" : " months"));
    if (years === 0 && months === 0) parts.push(days + (days === 1 ? " day" : " days"));
    return parts.length ? parts.join(", ") : "Just moved in";
  }

  function dueDateObj(room, year, month) {
    return new Date(year + "-" + String(month).padStart(2, "0") + "-15T00:00:00+08:00");
  }

  /**
   * Computes prorated rent for a renter in a billing period whose due date
   * is the 15th of {year, month}. The billing period runs from the 15th of
   * the prior month to the 15th of the current month (~30 days).
   * Returns prorated rent only when stay_start_date falls inside that window.
   */
  function computeProration(renter, fullMonthlyRate, year, month) {
    var NONE = { isProrated: false, days: null, totalDays: null, amount: fullMonthlyRate, label: "" };
    if (!renter.stay_start_date) return NONE;
    var startDate = new Date(String(renter.stay_start_date).slice(0, 10) + "T00:00:00+08:00");
    if (isNaN(startDate.getTime())) return NONE;

    var dueDate = new Date(year + "-" + String(month).padStart(2, "0") + "-15T00:00:00+08:00");
    var prevMonth = month === 1 ? 12 : month - 1;
    var prevYear  = month === 1 ? year - 1 : year;
    var prevCutoff = new Date(prevYear + "-" + String(prevMonth).padStart(2, "0") + "-15T00:00:00+08:00");

    // Only prorate if renter moved in strictly after previous cutoff and on/before due date
    if (startDate <= prevCutoff || startDate > dueDate) return NONE;

    var MS = 86400000;
    var daysInPeriod = Math.round((dueDate - prevCutoff) / MS);  // ~30
    var daysStayed   = Math.round((dueDate - startDate)  / MS);  // actual days
    var amount = Math.round((daysStayed / daysInPeriod) * fullMonthlyRate * 100) / 100;
    return {
      isProrated: true,
      days: daysStayed,
      totalDays: daysInPeriod,
      amount: amount,
      label: daysStayed + " of " + daysInPeriod + " days"
    };
  }

  /**
   * Returns the ISO next_due date (always the 15th) for a given move-in date.
   * If move-in day ≤ 15 → 15th of same month; else → 15th of next month.
   */
  function nextDueFromMoveIn(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + "T00:00:00+08:00");
    if (isNaN(d.getTime())) return null;
    var y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() > 15) { m++; if (m > 12) { m = 1; y++; } }
    return y + "-" + String(m).padStart(2, "0") + "-15";
  }

  function nextDueDefault(dateStr) {
    return nextDueFromMoveIn(dateStr) || (function () {
      var d = phNow();
      var y = d.getFullYear(), m = d.getMonth() + 1;
      if (d.getDate() > 15) { m++; if (m > 12) { m = 1; y++; } }
      return y + "-" + String(m).padStart(2, "0") + "-15";
    })();
  }

  function ensureRenterBillingDefaults(renter) {
    if (!renter.stay_start_date) renter.stay_start_date = todayISO();
    if (!renter.next_due) renter.next_due = nextDueDefault(renter.stay_start_date);
  }

  function renterIsNew(renter) {
    return renter.is_new_renter === true;
  }

  /** True when this billing period is the renter's move-in month (15th–15th window). */
  function isFirstBillingMonth(renter, year, month) {
    if (!renter || !renter.stay_start_date) return false;
    var startDate = new Date(String(renter.stay_start_date).slice(0, 10) + "T00:00:00+08:00");
    if (isNaN(startDate.getTime())) return false;
    var dueDate = new Date(year + "-" + String(month).padStart(2, "0") + "-15T00:00:00+08:00");
    var prevMonth = month === 1 ? 12 : month - 1;
    var prevYear = month === 1 ? year - 1 : year;
    var prevCutoff = new Date(prevYear + "-" + String(prevMonth).padStart(2, "0") + "-15T00:00:00+08:00");
    return startDate > prevCutoff && startDate <= dueDate;
  }

  function suggestedAdvanceRent(renter) {
    if (!renter.room_id) return null;
    var room = state.rooms.find(function (r) { return r.id === renter.room_id; });
    if (!room) return null;
    return num(room.rate_per_person);
  }

  function openRenterRentalSection(card) {
    if (!card) return;
    card.querySelectorAll("details.rc-section").forEach(function (section) {
      if (section.querySelector(".r-is-new")) section.open = true;
    });
  }

  var assignRenterContext = { room: null, onAssigned: null };
  var assignRenterModal = document.getElementById("assignRenterModal");
  var assignRenterList = document.getElementById("assignRenterList");
  var assignRenterEmpty = document.getElementById("assignRenterEmpty");
  var assignRenterHint = document.getElementById("assignRenterHint");
  var assignRenterTitle = document.getElementById("assignRenterTitle");

  function unassignedRenters() {
    return state.renters.filter(function (r) {
      return !r.room_id && r.status !== "moved_out";
    });
  }

  function closeAssignRenterPicker() {
    if (!assignRenterModal) return;
    assignRenterModal.hidden = true;
    assignRenterModal.setAttribute("aria-hidden", "true");
    assignRenterContext.room = null;
    assignRenterContext.onAssigned = null;
  }

  function assignRenterToRoom(renter, room) {
    var check = canAssignRenterToRoom(room, renter);
    if (!check.ok) {
      toast("error", "Room is full", check.message);
      return Promise.reject(new Error(check.message));
    }
    renter.room_id = room.id;
    ensureRenterBillingDefaults(renter);
    return api("PUT", "/api/renters/" + renter.id, renter).then(function (updated) {
      var idx = state.renters.findIndex(function (r) { return r.id === updated.id; });
      if (idx >= 0) state.renters[idx] = updated;
      refreshRoomChips();
      renderRenters();
      loadBillingPayments();
      renderSummary();
      renderWorkflowGuide();
      toast("success", (fullName(updated) || "Renter") + " assigned to " + (room.name || "room") + ".");
      if (typeof assignRenterContext.onAssigned === "function") assignRenterContext.onAssigned();
    });
  }

  function createRenterForRoom(room, onDone) {
    var check = canAssignRenterToRoom(room, null);
    if (!check.ok) {
      toast("error", "Room is full", check.message);
      return Promise.reject(new Error(check.message));
    }
    var start = todayISO();
    return api("POST", "/api/renters", {
      room_id: room.id,
      stay_start_date: start,
      next_due: nextDueDefault(start),
      is_new_renter: true,
    }).then(function (renter) {
      state.renters.push(renter);
      refreshRoomChips();
      renderRenters();
      loadBillingPayments();
      renderSummary();
      renderWorkflowGuide();
      toast("success", "New renter created and assigned to " + (room.name || "room") + ".");
      if (onDone) onDone();
    });
  }

  function openAssignRenterPicker(room, onAssigned) {
    if (!assignRenterModal || !room) return;
    assignRenterContext.room = room;
    assignRenterContext.onAssigned = onAssigned || null;
    var limit = roomOccupancyLimit(room);
    var assigned = activeRoomRenters(room.id).length;
    var vacancy = roomVacancy(room);
    var full = vacancy <= 0;

    if (assignRenterTitle) {
      assignRenterTitle.textContent = "Assign to " + (room.name || "room");
    }
    if (assignRenterHint) {
      assignRenterHint.textContent = full
        ? occupancyLimitMessage(room)
        : "Choose an unassigned renter (" + assigned + "/" + limit + " assigned).";
    }

    var available = unassignedRenters();
    if (assignRenterList) assignRenterList.innerHTML = "";
    if (assignRenterEmpty) {
      assignRenterEmpty.hidden = !full && available.length > 0;
      assignRenterEmpty.textContent = full
        ? occupancyLimitMessage(room)
        : "No unassigned renters. Create a new renter profile first.";
    }

    var createBtn = assignRenterModal.querySelector(".assign-renter-create");
    if (createBtn) createBtn.disabled = full;

    if (full) {
      assignRenterModal.hidden = false;
      assignRenterModal.setAttribute("aria-hidden", "false");
      return;
    }

    available.forEach(function (renter) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "assign-renter-item";
      var label = fullName(renter) || "(Unnamed renter)";
      var sub = renter.contact_number || "No contact";
      btn.innerHTML = '<span class="assign-renter-name">' + label + '</span><span class="assign-renter-sub">' + sub + '</span>';
      btn.addEventListener("click", function () {
        btn.disabled = true;
        assignRenterToRoom(renter, room).then(function () {
          closeAssignRenterPicker();
        }).catch(function (err) {
          btn.disabled = false;
          saveFailed(err);
        });
      });
      assignRenterList.appendChild(btn);
    });

    assignRenterModal.hidden = false;
    assignRenterModal.setAttribute("aria-hidden", "false");
  }

  if (assignRenterModal) {
    assignRenterModal.querySelector(".assign-renter-close").addEventListener("click", closeAssignRenterPicker);
    assignRenterModal.querySelector(".assign-renter-backdrop").addEventListener("click", closeAssignRenterPicker);
    assignRenterModal.querySelector(".assign-renter-create").addEventListener("click", function () {
      var room = assignRenterContext.room;
      if (!room) return;
      var btn = this;
      btn.disabled = true;
      createRenterForRoom(room, function () {
        btn.disabled = false;
        closeAssignRenterPicker();
        if (typeof assignRenterContext.onAssigned === "function") assignRenterContext.onAssigned();
      }).catch(function (err) {
        btn.disabled = false;
        saveFailed(err);
      });
    });
  }

  function formatDate(d) {
    return d.toLocaleDateString("en-PH", { timeZone: PH_TZ, year: "numeric", month: "short", day: "numeric" });
  }

  function startOfToday() {
    const d = phNow();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function todayISO() {
    const d = phNow();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ---------------- Payment targets ----------------
     Every assigned renter is billed individually. Flat room rent and
     electricity are split evenly among the renters assigned to that room. */
  function paymentTargets() {
    const targets = [];
    state.rooms.forEach(function (room) {
      const renters = roomRenters(room.id);
      const electricity = roomKwh(room) * num(state.settings.rate);
      const electricityShare = renters.length ? electricity / renters.length : 0;
      const fullRentShare = num(room.rate_per_person);
      renters.forEach(function (renter) {
        const internet = num(state.settings.internet_rate);
        const proration = computeProration(renter, fullRentShare, viewPeriod.year, viewPeriod.month);
        const rentShare = proration.amount;
        targets.push({
          room: room,
          renter: renter,
          rent_amount: rentShare,
          electricity_amount: electricityShare,
          internet_amount: internet,
          amount: rentShare + electricityShare + internet,
          proration: proration,
          fullRent: fullRentShare,
        });
      });
    });
    return targets;
  }

  function calcRenterPaymentAmounts(renter, year, month) {
    var room = state.rooms.find(function (r) { return r.id === renter.room_id; });
    if (!room) return null;
    var fullRate = num(room.rate_per_person);
    var pro = computeProration(renter, fullRate, year, month);
    var renterCount = Math.max(1, roomRenters(room.id).length);
    var hist = (state.roomHistory || []).find(function (h) {
      return h.room_id === room.id && h.period_year === year && h.period_month === month;
    });
    var elecTotal = hist
      ? num(hist.electricity_amount)
      : (roomKwh(room, year, month) * num(state.settings.rate));
    var elecShare = elecTotal / renterCount;
    var inet = num(state.settings.internet_rate);
    return {
      room: room,
      rent: pro.amount,
      elec: elecShare,
      inet: inet,
      total: pro.amount + elecShare + inet,
      proLabel: pro.isProrated ? pro.label + ", prorated" : "",
      dueLabel: "15 " + MONTH_NAMES[month - 1] + " " + year,
    };
  }

  function assignedRenters() {
    return state.renters.filter(function (r) { return r.room_id && r.status !== "moved_out"; });
  }

  function assignedRenters() {
    return state.renters.filter(function (r) { return r.room_id && r.status !== "moved_out"; });
  }

  /* ---------------- Collect payments list controls ---------------- */
  var billingPaymentsControls = {
    search: "",
    status: "",
    room: "",
    sort: "name_asc",
  };
  var billingPaymentsControlsReady = false;
  var historyRowsCache = [];
  var historyControls = {
    search: "",
    status: "",
    room: "",
    month: "",
    year: "",
    sort: "period_desc",
  };
  var historyControlsReady = false;

  function paymentIsOverdue(year, month, paid) {
    if (paid) return false;
    var due = new Date(year + "-" + String(month).padStart(2, "0") + "-15T00:00:00+08:00");
    return due < startOfToday();
  }

  function billingPaymentCardMatches(card) {
    var q = billingPaymentsControls.search.toLowerCase().trim();
    if (q) {
      var name = (card.dataset.sortName || "");
      var room = (card.dataset.sortRoom || "");
      var amount = card.dataset.amount || "";
      if (name.indexOf(q) === -1 && room.indexOf(q) === -1 && amount.indexOf(q) === -1) return false;
    }
    if (billingPaymentsControls.status === "paid" && card.dataset.paid !== "1") return false;
    if (billingPaymentsControls.status === "pending" && card.dataset.paid !== "0") return false;
    if (billingPaymentsControls.status === "overdue" && card.dataset.overdue !== "1") return false;
    if (billingPaymentsControls.room && card.dataset.roomId !== billingPaymentsControls.room) return false;
    return true;
  }

  function compareBillingPaymentCards(a, b) {
    switch (billingPaymentsControls.sort) {
      case "name_desc":
        return (b.dataset.sortName || "").localeCompare(a.dataset.sortName || "", undefined, { sensitivity: "base" });
      case "room_asc":
        return (a.dataset.sortRoom || "").localeCompare(b.dataset.sortRoom || "", undefined, { sensitivity: "base" })
          || (a.dataset.sortName || "").localeCompare(b.dataset.sortName || "", undefined, { sensitivity: "base" });
      case "amount_desc":
        return num(b.dataset.amount) - num(a.dataset.amount);
      case "amount_asc":
        return num(a.dataset.amount) - num(b.dataset.amount);
      case "status_pending": {
        var pa = a.dataset.paid === "1" ? 1 : 0;
        var pb = b.dataset.paid === "1" ? 1 : 0;
        if (pa !== pb) return pa - pb;
        return (a.dataset.sortName || "").localeCompare(b.dataset.sortName || "", undefined, { sensitivity: "base" });
      }
      case "status_paid": {
        var pa2 = a.dataset.paid === "1" ? 0 : 1;
        var pb2 = b.dataset.paid === "1" ? 0 : 1;
        if (pa2 !== pb2) return pa2 - pb2;
        return (a.dataset.sortName || "").localeCompare(b.dataset.sortName || "", undefined, { sensitivity: "base" });
      }
      default:
        return (a.dataset.sortName || "").localeCompare(b.dataset.sortName || "", undefined, { sensitivity: "base" });
    }
  }

  function populateBillingPaymentsRoomFilter() {
    var sel = document.getElementById("bpFilterRoom");
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">All rooms</option>';
    var seen = {};
    assignedRenters().forEach(function (r) {
      if (!r.room_id || seen[r.room_id]) return;
      seen[String(r.room_id)] = true;
      var room = state.rooms.find(function (rm) { return rm.id === r.room_id; });
      if (!room) return;
      var opt = document.createElement("option");
      opt.value = String(room.id);
      opt.textContent = room.name || "Room " + room.id;
      sel.appendChild(opt);
    });
    sel.value = prev && seen[prev] ? prev : (billingPaymentsControls.room || "");
  }

  function applyBillingPaymentsControls() {
    if (!el.billingPaymentsList) return;
    var metaEl = document.getElementById("billingPaymentsMeta");
    var filterEmptyEl = document.getElementById("billingPaymentsFilterEmpty");
    var toolbar = document.getElementById("billingPaymentsToolbar");
    var cards = Array.prototype.slice.call(el.billingPaymentsList.querySelectorAll(".billing-payment-card"));
    var total = cards.length;

    if (toolbar) toolbar.style.display = total ? "" : "none";

    var editing = document.activeElement && document.activeElement.closest
      && document.activeElement.closest(".billing-payment-card")
      && (document.activeElement.classList.contains("bp-paid-check")
        || document.activeElement.classList.contains("bp-paid-date"));

    if (!editing && total) {
      cards.sort(compareBillingPaymentCards).forEach(function (card) {
        el.billingPaymentsList.appendChild(card);
      });
    }

    var visible = 0;
    cards.forEach(function (card) {
      var show = billingPaymentCardMatches(card);
      card.classList.toggle("list-item-hidden", !show);
      if (show) visible++;
    });

    if (metaEl) {
      if (!total) metaEl.textContent = "";
      else if (visible === total) {
        metaEl.textContent = "Showing all " + total + " payment" + (total === 1 ? "" : "s");
      } else {
        metaEl.textContent = "Showing " + visible + " of " + total + " payments";
      }
    }

    if (filterEmptyEl) {
      var showEmpty = total > 0 && visible === 0;
      filterEmptyEl.hidden = !showEmpty;
      if (showEmpty) {
        var q = billingPaymentsControls.search.trim();
        filterEmptyEl.textContent = q
          ? 'No payments match "' + q + '". Try a different keyword or clear the filters.'
          : "No payments match your search or filters.";
      }
    }

    el.billingPaymentsList.classList.toggle("list-hidden", total > 0 && visible === 0);
  }

  function initBillingPaymentsControls() {
    if (billingPaymentsControlsReady) return;
    billingPaymentsControlsReady = true;
    var searchInput = document.getElementById("bpSearchInput");
    var statusSel = document.getElementById("bpFilterStatus");
    var roomSel = document.getElementById("bpFilterRoom");
    var sortSel = document.getElementById("bpSortBy");
    if (!searchInput) return;

    searchInput.addEventListener("input", function () {
      billingPaymentsControls.search = this.value;
      applyBillingPaymentsControls();
    });
    if (statusSel) {
      statusSel.addEventListener("change", function () {
        billingPaymentsControls.status = this.value;
        applyBillingPaymentsControls();
      });
    }
    if (roomSel) {
      roomSel.addEventListener("change", function () {
        billingPaymentsControls.room = this.value;
        applyBillingPaymentsControls();
      });
    }
    if (sortSel) {
      sortSel.addEventListener("change", function () {
        billingPaymentsControls.sort = this.value;
        applyBillingPaymentsControls();
      });
    }
  }

  /* ---------------- Payment history list controls ---------------- */
  function historyRowSearchText(row) {
    var renterName = [row.renter_first_name, row.renter_last_name].filter(Boolean).join(" ");
    var period = MONTH_NAMES[row.period_month - 1] + " " + row.period_year;
    return (renterName + " " + (row.room_name || "") + " " + period + " " + (row.amount || "")).toLowerCase();
  }

  function historyRowMatches(row) {
    var q = historyControls.search.toLowerCase().trim();
    if (q && historyRowSearchText(row).indexOf(q) === -1) return false;
    if (historyControls.status === "paid" && !row.paid) return false;
    if (historyControls.status === "unpaid" && row.paid) return false;
    if (historyControls.room && String(row.room_id) !== historyControls.room) return false;
    if (historyControls.year && row.period_year !== parseInt(historyControls.year, 10)) return false;
    if (historyControls.month && row.period_month !== parseInt(historyControls.month, 10)) return false;
    return true;
  }

  function compareHistoryRows(a, b) {
    switch (historyControls.sort) {
      case "name_desc":
        return historyRowRenterName(b).localeCompare(historyRowRenterName(a), undefined, { sensitivity: "base" });
      case "amount_desc":
        return num(b.amount) - num(a.amount);
      case "amount_asc":
        return num(a.amount) - num(b.amount);
      case "status_unpaid": {
        var pa = a.paid ? 1 : 0;
        var pb = b.paid ? 1 : 0;
        if (pa !== pb) return pa - pb;
        return historyRowRenterName(a).localeCompare(historyRowRenterName(b), undefined, { sensitivity: "base" });
      }
      case "status_paid": {
        var pa2 = a.paid ? 0 : 1;
        var pb2 = b.paid ? 0 : 1;
        if (pa2 !== pb2) return pa2 - pb2;
        return historyRowRenterName(a).localeCompare(historyRowRenterName(b), undefined, { sensitivity: "base" });
      }
      default:
        return historyRowRenterName(a).localeCompare(historyRowRenterName(b), undefined, { sensitivity: "base" });
    }
  }

  function historyRowRenterName(row) {
    return [row.renter_first_name, row.renter_last_name].filter(Boolean).join(" ") || row.room_name || "";
  }

  function populateHistoryFilterDropdowns() {
    var roomSel = document.getElementById("histFilterRoom");
    var monthSel = document.getElementById("histFilterMonth");
    var yearSel = document.getElementById("histFilterYear");
    if (!monthSel || !yearSel) return;

    var prevRoom = roomSel ? roomSel.value : "";
    var prevMonth = monthSel.value;
    var prevYear = yearSel.value;

    if (roomSel) {
      roomSel.innerHTML = '<option value="">All rooms</option>';
      var roomsSeen = {};
      historyRowsCache.forEach(function (row) {
        if (!row.room_id || roomsSeen[row.room_id]) return;
        roomsSeen[String(row.room_id)] = true;
        var opt = document.createElement("option");
        opt.value = String(row.room_id);
        opt.textContent = row.room_name || "Room " + row.room_id;
        roomSel.appendChild(opt);
      });
      roomSel.value = prevRoom && roomsSeen[prevRoom] ? prevRoom : (historyControls.room || "");
    }

    monthSel.innerHTML = '<option value="">All months</option>';
    MONTH_NAMES.forEach(function (name, i) {
      var opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = name;
      monthSel.appendChild(opt);
    });

    var years = {};
    years[currentPeriod.year] = true;
    historyRowsCache.forEach(function (row) {
      if (row.period_year) years[row.period_year] = true;
    });
    yearSel.innerHTML = '<option value="">All years</option>';
    Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
      var opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearSel.appendChild(opt);
    });

    monthSel.value = prevMonth || historyControls.month || "";
    yearSel.value = prevYear || historyControls.year || "";
  }

  function applyHistoryControls() {
    var metaEl = document.getElementById("historyListMeta");
    var filterEmptyEl = document.getElementById("historyFilterEmpty");
    var toolbar = document.getElementById("historyToolbar");
    if (!el.historyList) return;

    var filtered = historyRowsCache.filter(historyRowMatches);
    var total = historyRowsCache.length;
    var visible = filtered.length;

    if (toolbar) toolbar.style.display = total ? "" : "none";
    el.historyEmpty.style.display = total ? "none" : "";

    if (!total) {
      el.historyList.innerHTML = "";
      if (metaEl) metaEl.textContent = "";
      if (filterEmptyEl) filterEmptyEl.hidden = true;
      return;
    }

    var groups = [];
    var byKey = {};
    filtered.forEach(function (row) {
      var key = row.period_year + "-" + row.period_month;
      if (!byKey[key]) {
        byKey[key] = { year: row.period_year, month: row.period_month, rows: [] };
        groups.push(byKey[key]);
      }
      byKey[key].rows.push(row);
    });

    groups.sort(function (a, b) {
      var ka = a.year * 100 + a.month;
      var kb = b.year * 100 + b.month;
      return historyControls.sort === "period_asc" ? ka - kb : kb - ka;
    });

    groups.forEach(function (group) {
      group.rows.sort(compareHistoryRows);
    });

    el.historyList.innerHTML = "";
    groups.forEach(function (group) {
      var wrap = document.createElement("div");
      wrap.className = "history-group";

      var head = document.createElement("div");
      head.className = "history-group-head";
      var title = document.createElement("span");
      title.className = "history-group-title";
      title.textContent = MONTH_NAMES[group.month - 1] + " " + group.year;
      var totalCollected = group.rows.reduce(function (sum, r) { return sum + (r.paid ? num(r.amount) : 0); }, 0);
      var totalEl = document.createElement("span");
      totalEl.className = "history-group-total";
      totalEl.textContent = "Collected " + money(totalCollected);
      head.appendChild(title);
      head.appendChild(totalEl);
      wrap.appendChild(head);

      group.rows.forEach(function (row) {
        var rowEl = document.createElement("div");
        rowEl.className = "history-row";

        var roomCell = document.createElement("div");
        roomCell.className = "history-room";
        var renterName = historyRowRenterName(row);
        if (renterName && row.room_name) {
          roomCell.textContent = renterName;
          var sub = document.createElement("span");
          sub.className = "p-room-sub";
          sub.textContent = row.room_name;
          roomCell.appendChild(sub);
        } else {
          roomCell.textContent = renterName || row.room_name || "—";
        }

        var amountCell = document.createElement("div");
        amountCell.className = "history-amount";
        amountCell.setAttribute("data-label", "Amount");
        amountCell.textContent = money(row.amount);

        var statusCell = document.createElement("div");
        statusCell.className = "history-status";
        statusCell.setAttribute("data-label", "Status");
        var badge = document.createElement("span");
        badge.className = "status-badge" + (row.paid ? " paid" : "");
        badge.textContent = row.paid ? "Paid" : "Unpaid";
        statusCell.appendChild(badge);

        var dateCell = document.createElement("div");
        dateCell.className = "history-date";
        dateCell.setAttribute("data-label", "Paid on");
        dateCell.textContent = row.paid_date
          ? formatDate(new Date(String(row.paid_date).slice(0, 10) + "T00:00:00"))
          : "—";

        rowEl.appendChild(roomCell);
        rowEl.appendChild(amountCell);
        rowEl.appendChild(statusCell);
        rowEl.appendChild(dateCell);
        wrap.appendChild(rowEl);
      });

      el.historyList.appendChild(wrap);
    });

    if (metaEl) {
      if (visible === total) {
        metaEl.textContent = "Showing all " + total + " record" + (total === 1 ? "" : "s");
      } else {
        metaEl.textContent = "Showing " + visible + " of " + total + " records";
      }
    }

    if (filterEmptyEl) {
      var showEmpty = visible === 0;
      filterEmptyEl.hidden = !showEmpty;
      el.historyList.classList.toggle("list-hidden", showEmpty);
      if (showEmpty) {
        var q = historyControls.search.trim();
        filterEmptyEl.textContent = q
          ? 'No records match "' + q + '". Try a different keyword or clear the filters.'
          : "No payment records match your search or filters.";
      }
    } else {
      el.historyList.classList.remove("list-hidden");
    }
  }

  function initHistoryControls() {
    if (historyControlsReady) return;
    historyControlsReady = true;
    var searchInput = document.getElementById("histSearchInput");
    var statusSel = document.getElementById("histFilterStatus");
    var roomSel = document.getElementById("histFilterRoom");
    var monthSel = document.getElementById("histFilterMonth");
    var yearSel = document.getElementById("histFilterYear");
    var sortSel = document.getElementById("histSortBy");
    if (!searchInput) return;

    searchInput.addEventListener("input", function () {
      historyControls.search = this.value;
      applyHistoryControls();
    });
    if (statusSel) {
      statusSel.addEventListener("change", function () {
        historyControls.status = this.value;
        applyHistoryControls();
      });
    }
    if (roomSel) {
      roomSel.addEventListener("change", function () {
        historyControls.room = this.value;
        applyHistoryControls();
      });
    }
    if (monthSel) {
      monthSel.addEventListener("change", function () {
        historyControls.month = this.value;
        applyHistoryControls();
      });
    }
    if (yearSel) {
      yearSel.addEventListener("change", function () {
        historyControls.year = this.value;
        applyHistoryControls();
      });
    }
    if (sortSel) {
      sortSel.addEventListener("change", function () {
        historyControls.sort = this.value;
        applyHistoryControls();
      });
    }
  }

  function renderBillingPayments(paymentRows) {
    if (!el.billingPaymentsList) return;
    var year = billingDraft.year || currentPeriod.year;
    var month = billingDraft.month || currentPeriod.month;
    var renters = assignedRenters();
    el.billingPaymentsList.innerHTML = "";

    if (el.billingPaymentsDue) {
      el.billingPaymentsDue.textContent = "Due: 15 " + MONTH_NAMES[month - 1] + " " + year;
    }
    if (el.billingPaymentsHint) {
      el.billingPaymentsHint.textContent = renters.length
        ? "Mark renters as paid for " + MONTH_NAMES[month - 1] + " " + year + ". Amounts auto-calculate from generated bills."
        : "Assign renters to rooms first, then generate bills above.";
    }
    if (el.billingPaymentsEmpty) {
      el.billingPaymentsEmpty.style.display = renters.length ? "none" : "";
    }
    var toolbar = document.getElementById("billingPaymentsToolbar");
    if (toolbar) toolbar.style.display = renters.length ? "" : "none";
    if (!renters.length) {
      if (document.getElementById("billingPaymentsMeta")) {
        document.getElementById("billingPaymentsMeta").textContent = "";
      }
      return;
    }

    initBillingPaymentsControls();

    var recordMap = {};
    (paymentRows || []).forEach(function (row) {
      if (row.renter_id != null) recordMap[row.renter_id] = row;
    });

    renters.forEach(function (renter) {
      var amounts = calcRenterPaymentAmounts(renter, year, month);
      if (!amounts) return;
      var record = recordMap[renter.id] || null;
      var paid = record ? !!record.paid : false;
      var paidDate = record && record.paid_date ? String(record.paid_date).slice(0, 10) : "";

      var card = document.createElement("div");
      card.className = "billing-payment-card" + (paid ? " is-paid" : "");
      var overdue = paymentIsOverdue(year, month, paid);
      card.dataset.renterId = String(renter.id);
      card.dataset.roomId = String(amounts.room.id);
      card.dataset.paid = paid ? "1" : "0";
      card.dataset.overdue = overdue ? "1" : "0";
      card.dataset.amount = String(amounts.total);
      card.dataset.sortName = (fullName(renter) || "").toLowerCase();
      card.dataset.sortRoom = (amounts.room.name || "").toLowerCase();
      card.innerHTML = [
        '<div class="bp-head">',
          '<div class="bp-who">',
            '<strong class="bp-name">' + (fullName(renter) || "(Unnamed renter)") + '</strong>',
            '<span class="hint bp-room">' + (amounts.room.name || "Room") + '</span>',
          '</div>',
          '<span class="bp-status ' + (paid ? "bp-status-paid" : "bp-status-pending") + '">' + (paid ? "Paid" : "Pending") + '</span>',
        '</div>',
        '<div class="bp-breakdown">',
          '<span>Rent <strong class="bp-rent">' + money(amounts.rent) + '</strong><em class="bp-prorate">' + (amounts.proLabel ? " (" + amounts.proLabel + ")" : "") + '</em></span>',
          '<span>Electricity <strong class="bp-elec">' + money(amounts.elec) + '</strong></span>',
          '<span>Internet <strong class="bp-inet">' + money(amounts.inet) + '</strong></span>',
          '<span class="bp-total">Total <strong class="bp-total-val">' + money(amounts.total) + '</strong></span>',
        '</div>',
        '<div class="bp-actions">',
          '<span class="bp-due">Due ' + amounts.dueLabel + '</span>',
          '<label class="bp-paid-label">',
            '<input type="checkbox" class="bp-paid-check" />',
            '<span>Paid</span>',
          '</label>',
          '<input type="date" class="text-input bp-paid-date" title="Date payment was received" />',
          '<button class="btn btn-sm btn-primary bp-save-btn" type="button">Save</button>',
        '</div>',
      ].join("");

      var check = card.querySelector(".bp-paid-check");
      var dateInput = card.querySelector(".bp-paid-date");
      var saveBtn = card.querySelector(".bp-save-btn");
      var statusEl = card.querySelector(".bp-status");
      check.checked = paid;
      dateInput.value = paidDate;

      check.addEventListener("change", function () {
        if (check.checked && !dateInput.value) dateInput.value = todayISO();
        if (!check.checked) dateInput.value = "";
        card.dataset.paid = check.checked ? "1" : "0";
        card.dataset.overdue = paymentIsOverdue(year, month, check.checked) ? "1" : "0";
      });

      saveBtn.addEventListener("click", function () {
        var a = calcRenterPaymentAmounts(renter, year, month);
        if (!a) return;
        saveBtn.disabled = true;
        api("PUT", "/api/payments", {
          room_id: a.room.id,
          renter_id: renter.id,
          year: year,
          month: month,
          paid: check.checked,
          paid_date: dateInput.value || null,
          amount: a.total,
          rent_amount: a.rent,
          electricity_amount: a.elec,
          internet_amount: a.inet,
        }).then(function () {
          saveBtn.disabled = false;
          var period = MONTH_NAMES[month - 1] + " " + year;
          toast("success", "Payment saved", period + " marked as " + (check.checked ? "paid." : "unpaid."));
          card.classList.toggle("is-paid", check.checked);
          statusEl.textContent = check.checked ? "Paid" : "Pending";
          statusEl.className = "bp-status " + (check.checked ? "bp-status-paid" : "bp-status-pending");
          card.dataset.paid = check.checked ? "1" : "0";
          card.dataset.overdue = paymentIsOverdue(year, month, check.checked) ? "1" : "0";
          applyBillingPaymentsControls();
          refreshCurrentMonthWidget();
          if (year === currentPeriod.year && month === currentPeriod.month) {
            loadBillingPayments();
          }
          loadHistory();
          loadReceiptSearchCatalog();
        }).catch(function (err) {
          saveBtn.disabled = false;
          toast("error", "Save failed", err.message);
        });
      });

      el.billingPaymentsList.appendChild(card);
    });

    populateBillingPaymentsRoomFilter();
    applyBillingPaymentsControls();
  }

  function loadBillingPayments() {
    var year = billingDraft.year || currentPeriod.year;
    var month = billingDraft.month || currentPeriod.month;
    return api("GET", "/api/payments?year=" + year + "&month=" + month).then(function (rows) {
      renderBillingPayments(rows || []);
    }).catch(function () {
      renderBillingPayments([]);
    });
  }

  function findPaymentRecord(list, target) {
    return list.find(function (rec) {
      return rec.renter_id === target.renter.id;
    });
  }

  function pendingKey(roomId, renterId, year, month) {
    return roomId + ":" + (renterId || "") + ":" + year + ":" + month;
  }

  // Unsaved toggle (if any) wins over what's already in the database.
  function effectivePayment(list, target, year, month) {
    const key = pendingKey(target.room.id, target.renter ? target.renter.id : null, year, month);
    if (pendingPayments[key]) return pendingPayments[key];
    const record = findPaymentRecord(list, target);
    return record
      ? {
          paid: record.paid,
          paid_date: record.paid_date,
          amount: record.amount == null ? num(target.amount) : num(record.amount),
          rent_amount: record.rent_amount == null ? num(target.rent_amount) : num(record.rent_amount),
          electricity_amount: record.electricity_amount == null
            ? num(target.electricity_amount) : num(record.electricity_amount),
          internet_amount: record.internet_amount == null
            ? num(target.internet_amount) : num(record.internet_amount),
        }
      : {
          paid: false,
          paid_date: null,
          amount: num(target.amount),
          rent_amount: num(target.rent_amount),
          electricity_amount: num(target.electricity_amount),
          internet_amount: num(target.internet_amount),
        };
  }

  /* ---------------- Tabs ---------------- */
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  function activateTab(name) {
    tabButtons.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    tabPanels.forEach(function (p) { p.classList.toggle("active", p.dataset.tabPanel === name); });
    if (name === "billing") {
      initBillingTab();
      loadHistory();
      loadMeterHistory();
      loadBillingPayments();
      openReceiptsTab();
    }
    if (name === "dashboard") {
      renderSummary();
      renderDashboardWidget();
    }
    if (name === "settings") renderExpenses();
  }
  tabButtons.forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.dataset.tab); });
  });
  document.querySelectorAll("[data-goto-tab]").forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.dataset.gotoTab); });
  });

  /* ================================================================
     GLOBAL SEARCH (Rent System)
  ================================================================ */
  (function () {
    var searchInput   = document.getElementById("globalSearch");
    var searchDropdown= document.getElementById("globalSearchDropdown");
    var clearBtn      = document.getElementById("globalSearchClear");
    if (!searchInput) return;

    var TYPE_LABELS = { renter: "Renter", room: "Room", expense: "Expense", billing: "Billing" };

    function escHtmlS(s) {
      return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function flashEl(el) {
      el.classList.remove("search-flash");
      void el.offsetWidth; // reflow to restart animation
      el.classList.add("search-flash");
      el.addEventListener("animationend", function () { el.classList.remove("search-flash"); }, { once: true });
    }

    function navigateTo(type, id) {
      var numId = parseInt(id, 10);
      if (type === "renter") {
        activateTab("renters");
        setTimeout(function () {
          var card = el.renterList.querySelector("[data-renter-id='" + numId + "']");
          if (card) {
            card.classList.remove("collapsed");
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            flashEl(card);
          }
        }, 60);
      } else if (type === "room") {
        activateTab("rooms");
        setTimeout(function () {
          var card = el.tenantList.querySelector("[data-room-id='" + numId + "']");
          if (card) {
            card.classList.remove("collapsed");
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            flashEl(card);
          }
        }, 60);
      } else if (type === "expense") {
        activateTab("settings");
        clearExpenseFilters();
        setTimeout(function () {
          var row = el.expenseList.querySelector("[data-expense-id='" + numId + "']");
          if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            flashEl(row);
          }
        }, 60);
      } else if (type === "billing") {
        activateTab("billing");
        setTimeout(function () {
          var panel = document.querySelector('[data-tab-panel="billing"]');
          if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    }

    function runSearch(query) {
      var q = query.toLowerCase().trim();
      if (!q) { searchDropdown.hidden = true; return; }

      var groups = { renter: [], room: [], expense: [], billing: [] };

      state.renters.forEach(function (r) {
        var full = ((r.first_name || "") + " " + (r.last_name || "")).trim().toLowerCase();
        var contact = (r.contact_number || "").toLowerCase();
        if (full.includes(q) || contact.includes(q)) {
          groups.renter.push({ id: r.id, label: ((r.first_name || "") + " " + (r.last_name || "")).trim(), sub: r.status || "active" });
        }
      });

      state.rooms.forEach(function (r) {
        if ((r.name || "").toLowerCase().includes(q)) {
          groups.room.push({ id: r.id, label: r.name, sub: (r.occupant_amount || 0) + " occupant(s)" });
        }
      });

      state.expenses.forEach(function (e) {
        if ((e.name || "").toLowerCase().includes(q)) {
          groups.expense.push({ id: e.id, label: e.name, sub: e.recurrence_type === "one_time" ? "One-time" : "Monthly" });
        }
      });

      (state.roomHistory || []).forEach(function (h) {
        var roomLabel = (h.room_name || "").toLowerCase();
        var period = (MONTH_NAMES[h.period_month - 1] || "") + " " + h.period_year;
        if (roomLabel.includes(q) || period.toLowerCase().includes(q)) {
          groups.billing.push({ id: h.room_id, label: (h.room_name || "Room"), sub: period });
        }
      });

      var totalResults = groups.renter.length + groups.room.length + groups.expense.length + groups.billing.length;

      if (totalResults === 0) {
        searchDropdown.innerHTML = '<div class="search-no-results">No results for "<strong>' + escHtmlS(query) + '</strong>"</div>';
        searchDropdown.hidden = false;
        return;
      }

      var html = "";
      var order = ["renter", "room", "expense", "billing"];
      order.forEach(function (type) {
        var items = groups[type];
        if (!items.length) return;
        html += '<div class="search-group-label">' + TYPE_LABELS[type] + "s" + "</div>";
        items.forEach(function (item) {
          html += '<button class="search-result-item" data-type="' + type + '" data-id="' + item.id + '" type="button">' +
            '<span class="sri-label">' + escHtmlS(item.label) + "</span>" +
            '<span class="sri-sub">' + escHtmlS(item.sub) + "</span>" +
            "</button>";
        });
      });

      searchDropdown.innerHTML = html;
      searchDropdown.querySelectorAll(".search-result-item").forEach(function (btn) {
        btn.addEventListener("click", function () {
          navigateTo(btn.dataset.type, btn.dataset.id);
          closeSearch();
        });
      });
      searchDropdown.hidden = false;
    }

    function closeSearch() {
      searchInput.value = "";
      clearBtn.classList.remove("visible");
      searchDropdown.hidden = true;
    }

    searchInput.addEventListener("input", function () {
      var q = this.value.trim();
      clearBtn.classList.toggle("visible", q.length > 0);
      runSearch(this.value);
    });

    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeSearch(); searchInput.blur(); }
    });

    clearBtn.addEventListener("click", function () {
      closeSearch();
      searchInput.focus();
    });

    // Close when clicking outside
    document.addEventListener("click", function (e) {
      if (!document.getElementById("headerSearchWrap").contains(e.target)) {
        searchDropdown.hidden = true;
      }
    });
  }());

  /* ---------------- Elements ---------------- */
  const el = {
    tenantList: document.getElementById("tenantList"),
    expenseList: document.getElementById("expenseList"),
    renterList: document.getElementById("renterList"),
    tenantTpl: document.getElementById("tenantTemplate"),
    expenseTpl: document.getElementById("expenseTemplate"),
    renterTpl: document.getElementById("renterTemplate"),
    paymentTpl: document.getElementById("paymentTemplate"),
    renterChipTpl: document.getElementById("renterChipTemplate"),
    setRate: document.getElementById("setRate"),
    setCost: document.getElementById("setCost"),
    setInternetRate: document.getElementById("setInternetRate"),
    setCurrency: document.getElementById("setCurrency"),
    sumGrossTotal: document.getElementById("sumGrossTotal"),
    sumNetTotal: document.getElementById("sumNetTotal"),
    sumGrossRent: document.getElementById("sumGrossRent"),
    sumRentExpenses: document.getElementById("sumRentExpenses"),
    sumNetRent: document.getElementById("sumNetRent"),
    sumGrossPower: document.getElementById("sumGrossPower"),
    sumPowerCost: document.getElementById("sumPowerCost"),
    sumNetPower: document.getElementById("sumNetPower"),
    sumKwh: document.getElementById("sumKwh"),
    sumHousehold: document.getElementById("sumHousehold"),
    sumGrossInternet: document.getElementById("sumGrossInternet"),
    sumInternetRate: document.getElementById("sumInternetRate"),
    sumInternetPeople: document.getElementById("sumInternetPeople"),
    billingPeriodMonth: document.getElementById("billingPeriodMonth"),
    billingPeriodYear: document.getElementById("billingPeriodYear"),
    billingDueLabel: document.getElementById("billingDueLabel"),
    billingRoomMeters: document.getElementById("billingRoomMeters"),
    billingHousePrev: document.getElementById("billingHousePrev"),
    billingHouseCurr: document.getElementById("billingHouseCurr"),
    billingHouseKwh: document.getElementById("billingHouseKwh"),
    billingRoomsKwh: document.getElementById("billingRoomsKwh"),
    billingHouseholdKwh: document.getElementById("billingHouseholdKwh"),
    generateBillsBtn: document.getElementById("generateBillsBtn"),
    billingPaymentsList: document.getElementById("billingPaymentsList"),
    billingPaymentsEmpty: document.getElementById("billingPaymentsEmpty"),
    billingPaymentsDue: document.getElementById("billingPaymentsDue"),
    billingPaymentsHint: document.getElementById("billingPaymentsHint"),
    dashPaymentsPeriod_unused: null, // payments tab removed
    dashPaymentsPeriod: document.getElementById("dashPaymentsPeriod"),
    dashPaymentsSummary: document.getElementById("dashPaymentsSummary"),
    historyList: document.getElementById("historyList"),
    historyEmpty: document.getElementById("historyEmpty"),
    remindersList: document.getElementById("remindersList"),
    remindersSummary: document.getElementById("remindersSummary"),
    collectionMeter: document.getElementById("collectionMeter"),
    collectionMeterFill: document.getElementById("collectionMeterFill"),
    collectionCollected: document.getElementById("collectionCollected"),
    collectionExpected: document.getElementById("collectionExpected"),
    statsChart: document.getElementById("statsChart"),
    statsEmpty: document.getElementById("statsEmpty"),
    statsYearTotal: document.getElementById("statsYearTotal"),
    statsAvg: document.getElementById("statsAvg"),
    statsBest: document.getElementById("statsBest"),
    wfRoomsCount: document.getElementById("wfRoomsCount"),
    wfRentersCount: document.getElementById("wfRentersCount"),
    wfBillingCount: document.getElementById("wfBillingCount"),
    dashPeriodLabel: document.getElementById("dashPeriodLabel"),
    receiptRenter: document.getElementById("receiptRenter"),
    receiptMonth: document.getElementById("receiptMonth"),
    receiptYear: document.getElementById("receiptYear"),
    receiptPreview: document.getElementById("receiptPreview"),
    receiptEmpty: document.getElementById("receiptEmpty"),
    printReceiptBtn: document.getElementById("printReceiptBtn"),
    meterHistoryList: document.getElementById("meterHistoryList"),
    meterHistoryEmpty: document.getElementById("meterHistoryEmpty"),
  };

  /* ---------------- Settings ---------------- */
  function renderSettings() {
    el.setRate.value = state.settings.rate;
    el.setCost.value = state.settings.cost;
    el.setInternetRate.value = state.settings.internet_rate;
    el.setCurrency.value = state.settings.currency;
  }

  el.setRate.addEventListener("input", function () {
    state.settings.rate = num(this.value);
    recalcRooms();
    renderSummary();
    markDirty("settings");
  });
  el.setCost.addEventListener("input", function () {
    state.settings.cost = num(this.value);
    renderSummary();
    markDirty("settings");
  });
  el.setInternetRate.addEventListener("input", function () {
    state.settings.internet_rate = num(this.value);
    recalcRooms();
    renderSummary();
    loadBillingPayments();
    markDirty("settings");
  });
  el.setCurrency.addEventListener("input", function () {
    state.settings.currency = this.value || "₱";
    recalcRooms();
    renderSummary();
    markDirty("settings");
  });

  /* ---------------- Billing tab ---------------- */
  var billingTabInitialized = false;
  state.meterHistory = { rooms: [], house: [] };

  function billingPeriodKey(year, month) {
    return year * 12 + month;
  }

  function roomHistoryForPeriod(roomId, year, month) {
    return (state.roomHistory || []).find(function (h) {
      return h.room_id === roomId && h.period_year === year && h.period_month === month;
    });
  }

  function defaultRoomReadings(roomId, year, month) {
    var existing = roomHistoryForPeriod(roomId, year, month);
    if (existing) {
      return { prev: existing.prev_reading, curr: existing.curr_reading };
    }
    var target = billingPeriodKey(year, month);
    var prior = null;
    (state.roomHistory || []).forEach(function (h) {
      if (h.room_id !== roomId) return;
      var pk = billingPeriodKey(h.period_year, h.period_month);
      if (pk < target && (!prior || pk > billingPeriodKey(prior.period_year, prior.period_month))) {
        prior = h;
      }
    });
    if (prior && prior.curr_reading != null) return { prev: prior.curr_reading, curr: null };
    return { prev: null, curr: null };
  }

  function defaultHouseReadings(year, month) {
    var houseRows = (state.meterHistory && state.meterHistory.house) || [];
    var existing = houseRows.find(function (h) {
      return h.period_year === year && h.period_month === month;
    });
    if (existing) {
      return { prev: existing.prev_reading, curr: existing.curr_reading };
    }
    var target = billingPeriodKey(year, month);
    var prior = null;
    houseRows.forEach(function (h) {
      var pk = billingPeriodKey(h.period_year, h.period_month);
      if (pk < target && (!prior || pk > billingPeriodKey(prior.period_year, prior.period_month))) {
        prior = h;
      }
    });
    if (prior && prior.curr_reading != null) return { prev: prior.curr_reading, curr: null };
    return { prev: null, curr: null };
  }

  function syncBillingDraftFromPeriod() {
    var year = num(el.billingPeriodYear && el.billingPeriodYear.value) || currentPeriod.year;
    var month = num(el.billingPeriodMonth && el.billingPeriodMonth.value) || currentPeriod.month;
    loadBillingDraftForPeriod(year, month);
  }

  function updateBillingDueLabel() {
    if (!el.billingDueLabel || !billingDraft.month) return;
    el.billingDueLabel.textContent = "Due: 15 " + MONTH_NAMES[billingDraft.month - 1] + " " + billingDraft.year;
  }

  function updateBillingMeterResults() {
    var house = houseMeterKwh();
    var rooms = totalRoomsKwh();
    var household = Math.max(0, house - rooms);
    if (el.billingHouseKwh) el.billingHouseKwh.textContent = kwh(house);
    if (el.billingRoomsKwh) el.billingRoomsKwh.textContent = kwh(rooms);
    if (el.billingHouseholdKwh) el.billingHouseholdKwh.textContent = kwh(household);
    if (billingDraft.year === currentPeriod.year && billingDraft.month === currentPeriod.month) {
      renderSummary();
    }
  }

  function renderBillingRoomMeters() {
    if (!el.billingRoomMeters) return;
    el.billingRoomMeters.innerHTML = "";
    if (!state.rooms.length) {
      el.billingRoomMeters.innerHTML = '<p class="hint">Create rooms first, then enter meter readings here.</p>';
      return;
    }
    state.rooms.forEach(function (room, idx) {
      var draft = billingDraft.rooms[room.id] || { prev: null, curr: null };
      var card = document.createElement("div");
      card.className = "billing-room-meter";
      card.dataset.roomId = String(room.id);
      var renters = roomRenters(room.id);
      var renterHint = renters.length
        ? renters.map(function (r) { return fullName(r) || "(Unnamed)"; }).join(", ")
        : "No renters assigned";
      card.innerHTML = [
        '<div class="billing-room-meter-head">',
          '<span class="billing-room-num">' + (idx + 1) + '</span>',
          '<div>',
            '<strong class="billing-room-name">' + (room.name || "Unnamed room") + '</strong>',
            '<span class="hint billing-room-renters">' + renterHint + '</span>',
          '</div>',
        '</div>',
        '<div class="billing-room-meter-fields tenant-fields">',
          '<label class="field">',
            '<span class="field-label">Previous reading</span>',
            '<div class="input-affix">',
              '<input type="number" class="billing-room-prev" min="0" step="0.01" inputmode="decimal" placeholder="0" />',
              '<span class="affix affix-right">kWh</span>',
            '</div>',
          '</label>',
          '<label class="field">',
            '<span class="field-label">Current reading</span>',
            '<div class="input-affix">',
              '<input type="number" class="billing-room-curr" min="0" step="0.01" inputmode="decimal" placeholder="0" />',
              '<span class="affix affix-right">kWh</span>',
            '</div>',
          '</label>',
          '<div class="billing-room-usage"><span>Usage</span><strong class="billing-room-kwh">0 kWh</strong></div>',
        '</div>',
      ].join("");

      var prevInput = card.querySelector(".billing-room-prev");
      var currInput = card.querySelector(".billing-room-curr");
      var usageEl = card.querySelector(".billing-room-kwh");
      prevInput.value = draft.prev == null ? "" : draft.prev;
      currInput.value = draft.curr == null ? "" : draft.curr;

      function syncRoomDraft() {
        billingDraft.rooms[room.id] = {
          prev: readingValue(prevInput.value),
          curr: readingValue(currInput.value),
        };
        billingDraftByPeriod[billingPeriodCacheKey(billingDraft.year, billingDraft.month)] =
          cloneBillingDraft(billingDraft);
        var used = roomKwh(room, billingDraft.year, billingDraft.month);
        usageEl.textContent = kwh(used);
        updateBillingMeterResults();
      }

      prevInput.addEventListener("input", syncRoomDraft);
      currInput.addEventListener("input", syncRoomDraft);
      usageEl.textContent = kwh(roomKwh(room, billingDraft.year, billingDraft.month));
      el.billingRoomMeters.appendChild(card);
    });
    updateBillingMeterResults();
  }

  function onBillingPeriodChange() {
    if (billingDraft.year && billingDraft.month) {
      captureBillingDraftFromDOM();
    }
    var year = num(el.billingPeriodYear && el.billingPeriodYear.value) || currentPeriod.year;
    var month = num(el.billingPeriodMonth && el.billingPeriodMonth.value) || currentPeriod.month;
    loadBillingDraftForPeriod(year, month);
    refreshBillingMetersUI();
    loadBillingPayments();
  }

  function initBillingTab() {
    if (!el.billingPeriodMonth) return;
    if (!billingTabInitialized) {
      MONTH_NAMES.forEach(function (name, i) {
        var opt = document.createElement("option");
        opt.value = String(i + 1);
        opt.textContent = name;
        el.billingPeriodMonth.appendChild(opt);
      });
      el.billingPeriodMonth.addEventListener("change", onBillingPeriodChange);
      el.billingPeriodYear.addEventListener("change", onBillingPeriodChange);
      el.billingHousePrev.addEventListener("input", function () {
        billingDraft.house.prev = readingValue(this.value);
        billingDraftByPeriod[billingPeriodCacheKey(billingDraft.year, billingDraft.month)] =
          cloneBillingDraft(billingDraft);
        updateBillingMeterResults();
      });
      el.billingHouseCurr.addEventListener("input", function () {
        billingDraft.house.curr = readingValue(this.value);
        billingDraftByPeriod[billingPeriodCacheKey(billingDraft.year, billingDraft.month)] =
          cloneBillingDraft(billingDraft);
        updateBillingMeterResults();
      });
      el.generateBillsBtn.addEventListener("click", function () {
        captureBillingDraftFromDOM();
        var year = billingDraft.year;
        var month = billingDraft.month;
        var period = MONTH_NAMES[month - 1] + " " + year;
        if (!hasBillingCurrentReading()) {
          showStatus("error", "Enter a current reading for at least one room or the main house meter.", 5000);
          return;
        }
        if (!confirm("Generate bills for " + period + "? Rent, electricity, and internet will be created for every assigned renter.")) return;

        el.generateBillsBtn.disabled = true;
        var payload = {
          year: year,
          month: month,
          rooms: state.rooms.map(function (r) {
            var d = billingDraft.rooms[r.id] || {};
            return { id: r.id, prev_reading: d.prev, curr_reading: d.curr };
          }),
          house_meter: {
            prev_reading: billingDraft.house.prev,
            curr_reading: billingDraft.house.curr,
          },
        };
        api("POST", "/api/meter-rollover", payload).then(function () {
          showStatus("saving", period + " bills generated.", 4000);
          toast("success", period + " billing recorded successfully.");
          delete billingDraftByPeriod[billingPeriodCacheKey(year, month)];
          return loadState();
        }).then(loadMeterHistory).then(loadRoomHistory).then(refreshCurrentMonthWidget).then(loadBillingPayments).then(function () {
          loadBillingDraftForPeriod(year, month);
          refreshBillingMetersUI();
        }).catch(saveFailed).finally(function () {
          el.generateBillsBtn.disabled = false;
        });
      });
      billingTabInitialized = true;
    }
    el.billingPeriodMonth.value = String(billingDraft.month || currentPeriod.month);
    el.billingPeriodYear.value = String(billingDraft.year || currentPeriod.year);
    onBillingPeriodChange();
  }

  /* ---------------- Rooms ---------------- */
  function renderRooms() {
    closeEditModal();
    el.tenantList.innerHTML = "";
    state.rooms.forEach(function (r, idx) {
      el.tenantList.appendChild(buildRoomCard(r, idx + 1));
    });
  }

  /* ---------------- Rooms ---------------- */
  function viewText(val) {
    return val == null || val === "" ? "—" : String(val);
  }
  function viewDate(val) {
    return val ? String(val).slice(0, 10) : "—";
  }
  function viewKwhReading(val) {
    return val == null ? "—" : Number(val).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " kWh";
  }

  function setEditPanelAccessible(panel, accessible) {
    if (!panel) return;
    panel.hidden = !accessible;
    panel.setAttribute("aria-hidden", accessible ? "false" : "true");
    panel.querySelectorAll("input, select, textarea, button").forEach(function (el) {
      if (accessible) el.removeAttribute("tabindex");
      else el.setAttribute("tabindex", "-1");
    });
  }

  function flushEditPanelValues(panel) {
    if (!panel) return;
    panel.querySelectorAll("input, select, textarea").forEach(function (el) {
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function getEditModalSaveScope(card) {
    if (!card) return null;
    if (card.classList.contains("tenant-card")) return "rooms";
    if (card.classList.contains("renter-card")) return "renters";
    return null;
  }

  function closeEditModal(options) {
    options = options || {};
    if (!editModal) return;

    var card = activeEditCard;
    var panel = activeEditPanel;
    var scope = getEditModalSaveScope(card);

    if (options.save) {
      flushEditPanelValues(panel);
      if (scope === "renters") {
        var renterId = card && card.dataset.renterId;
        var renter = state.renters.find(function (r) { return String(r.id) === String(renterId); });
        if (!renter || !(renter.first_name || "").trim()) {
          toast("error", "First name is required before saving.");
          if (panel) {
            var first = panel.querySelector(".r-first");
            var wrap = first && first.closest(".field");
            if (wrap) {
              wrap.classList.add("field-error");
              wrap.querySelectorAll(".field-error-msg").forEach(function (m) { m.remove(); });
              var msg = document.createElement("p");
              msg.className = "field-error-msg";
              msg.textContent = "First name is required";
              wrap.appendChild(msg);
            }
            if (first) first.focus();
          }
          return;
        }
      }
    }

    if (activeEditPanel && activeEditAnchor && activeEditAnchor.parentNode) {
      activeEditAnchor.parentNode.insertBefore(activeEditPanel, activeEditAnchor);
      activeEditAnchor.remove();
      setEditPanelAccessible(activeEditPanel, false);
    } else if (activeEditPanel) {
      setEditPanelAccessible(activeEditPanel, false);
    }
    if (editModalBody) editModalBody.innerHTML = "";
    editModal.hidden = true;
    editModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (activeEditCard) activeEditCard.classList.remove("is-editing");
    var onClose = activeEditOnClose;
    activeEditCard = null;
    activeEditPanel = null;
    activeEditAnchor = null;
    activeEditOnClose = null;
    if (onClose) onClose();
    if (options.save && scope) {
      if (scope === "rooms") saveRooms();
      else if (scope === "renters") saveRenters();
    }
  }

  function openEditModal(cardNode, title, onClose) {
    if (!editModal || !editModalBody) return;
    closeEditModal();
    var panel = cardNode.querySelector(".card-edit-panel");
    if (!panel) return;

    activeEditCard = cardNode;
    activeEditPanel = panel;
    activeEditOnClose = onClose || null;

    activeEditAnchor = document.createElement("div");
    activeEditAnchor.className = "card-edit-anchor";
    activeEditAnchor.hidden = true;
    panel.parentNode.insertBefore(activeEditAnchor, panel);

    setEditPanelAccessible(panel, true);
    editModalBody.appendChild(panel);
    editModalTitle.textContent = title || "Edit";
    editModal.hidden = false;
    editModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    cardNode.classList.add("is-editing");

    if (cardNode.dataset.roomId) {
      var room = state.rooms.find(function (r) { return String(r.id) === String(cardNode.dataset.roomId); });
      if (room) syncRoomView(cardNode, room);
    }

    var first = panel.querySelector("input:not([type=hidden]), select, textarea");
    if (first) setTimeout(function () { first.focus(); }, 80);
  }

  function closeEditModalIfCard(card) {
    if (activeEditCard === card) closeEditModal();
  }

  var editModal = document.getElementById("editModal");
  var editModalBody = document.getElementById("editModalBody");
  var editModalTitle = document.getElementById("editModalTitle");
  var activeEditCard = null;
  var activeEditPanel = null;
  var activeEditAnchor = null;
  var activeEditOnClose = null;

  if (editModal) {
    editModal.querySelector(".edit-modal-done").addEventListener("click", function () {
      closeEditModal({ save: true });
    });
    editModal.querySelector(".edit-modal-close").addEventListener("click", closeEditModal);
    editModal.querySelector(".edit-modal-backdrop").addEventListener("click", closeEditModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (assignRenterModal && !assignRenterModal.hidden) {
          closeAssignRenterPicker();
          return;
        }
        if (editModal && !editModal.hidden) closeEditModal();
      }
    });
  }

  function syncRoomView(node, room) {
    var set = function (sel, text) {
      var el = node.querySelector(sel);
      if (el) el.textContent = text;
    };
    set(".tc-v-name", viewText(room.name) || "(Unnamed room)");
    var occ = room.occupant_amount || 1;
    set(".tc-v-occupants", occ + (occ === 1 ? " occupant" : " occupants"));
    set(".tc-v-rate", money(room.rate_per_person || 0) + "/person");
  }

  function syncRenterView(node, renter) {
    var room = renter.room_id
      ? state.rooms.find(function (r) { return r.id === renter.room_id; })
      : null;
    var statusMap = { active: "Active", inactive: "Inactive", moved_out: "Moved Out" };
    var payMap = { cash: "Cash", gcash: "GCash", bank_transfer: "Bank Transfer", others: "Others" };
    var set = function (sel, text) {
      var el = node.querySelector(sel);
      if (el) el.textContent = viewText(text);
    };
    set(".rv-name", [renter.first_name, renter.middle_name, renter.last_name].filter(Boolean).join(" "));
    set(".rv-room", room ? (room.name || "Unnamed room") : "No room assigned");
    set(".rv-contact", renter.contact_number);
    set(".rv-duration", durationSince(renter.stay_start_date));
    set(".rv-status", statusMap[renter.status] || "Active");
    set(".rv-next-due", viewDate(renter.next_due));
    set(".rv-birthday", viewDate(renter.birthday));
    set(".rv-nationality", renter.nationality);
    set(".rv-gender", renter.gender);
    set(".rv-civil", renter.civil_status);
    set(".rv-address", renter.address);
    set(".rv-email", renter.mail_address);
    set(".rv-occupation", renter.occupation);
    set(".rv-employer", renter.employer);
    set(".rv-work", renter.work_address);
    set(".rv-id", renter.id_number);
    set(".rv-ec-name", renter.emergency_contact_name);
    set(".rv-ec-relation", renter.emergency_contact_relation);
    set(".rv-ec-number", renter.emergency_contact_number);
    set(".rv-ec-address", renter.emergency_contact_address);
    set(".rv-since", viewDate(renter.stay_start_date));
    set(".rv-pay-method", payMap[renter.payment_method] || renter.payment_method);
    set(".rv-is-new", renterIsNew(renter) ? "Yes — new move-in" : "No");
    node.querySelectorAll(".rv-new-fee-view").forEach(function (el) {
      el.style.display = renterIsNew(renter) ? "" : "none";
    });
    set(".rv-deposit", renter.deposit != null ? money(renter.deposit) : "—");
    set(".rv-advance", renter.advance_rent != null ? money(renter.advance_rent) : "—");
    set(".rv-balance", renter.balance != null ? money(renter.balance) : "—");
    set(".rv-reason", renter.reason_for_stay);
  }

  function buildRoomCard(room, roomNum) {
    const node = el.tenantTpl.content.firstElementChild.cloneNode(true);
    node.dataset.roomId = room.id;
    const name        = node.querySelector(".tenant-name");
    const occupants   = node.querySelector(".t-occupants");
    const rate        = node.querySelector(".t-rate");
    const rentersList = node.querySelector(".room-renters-list");
    const rentersListEdit = node.querySelector(".room-renters-list-edit");
    const addRenterBtn= node.querySelector(".add-room-renter");
    const tcHeader    = node.querySelector(".tc-header");
    const tcToggle    = node.querySelector(".tc-toggle");
    const editBtn     = node.querySelector(".card-edit-btn");
    const numBadge    = node.querySelector(".tc-room-num");
    const nameDisplay = node.querySelector(".tc-room-name-display");
    const occupantsChip = node.querySelector(".tc-occupants-chip");
    const rateChip    = node.querySelector(".tc-rate-chip");

    // Currency symbol
    node.querySelectorAll(".affix.cur").forEach(function (c) {
      c.textContent = state.settings.currency || "₱";
    });

    // Populate
    numBadge.textContent = roomNum || "?";
    name.value      = room.name || "";
    occupants.value = room.occupant_amount == null ? "1" : room.occupant_amount;
    rate.value      = room.rate_per_person == null ? "" : room.rate_per_person;

    function updateRoomHeader() {
      nameDisplay.textContent  = room.name || "(Unnamed room)";
      const occ = room.occupant_amount || 1;
      occupantsChip.textContent = occ + (occ === 1 ? " occupant" : " occupants");
      rateChip.textContent = money(room.rate_per_person || 0) + "/person";
    }
    node._syncRoomDisplay = function () {
      updateRoomHeader();
      syncRoomView(node, room);
    };
    updateRoomHeader();

    // Collapse toggle
    tcHeader.addEventListener("click", function (e) {
      if (e.target.closest(".card-toggle, .card-edit-btn")) return;
      const isCollapsed = node.classList.contains("collapsed");
      node.classList.toggle("collapsed", !isCollapsed);
      tcToggle.setAttribute("aria-expanded", String(isCollapsed));
    });
    tcToggle.addEventListener("click", function () {
      const isCollapsed = node.classList.contains("collapsed");
      node.classList.toggle("collapsed", !isCollapsed);
      this.setAttribute("aria-expanded", String(isCollapsed));
    });

    editBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (node.classList.contains("collapsed")) {
        node.classList.remove("collapsed");
        tcToggle.setAttribute("aria-expanded", "true");
      }
      openEditModal(node, "Edit " + (room.name || "Room " + (roomNum || "")), function () {
        if (typeof node._syncRoomDisplay === "function") node._syncRoomDisplay();
      });
    });

    function renderChips() {
      [rentersList, rentersListEdit].forEach(function (list) {
        if (!list) return;
        list.innerHTML = "";
        const renters = roomRenters(room.id);
        if (!renters.length) {
          const empty = document.createElement("span");
          empty.className = "room-renters-empty";
          empty.textContent = "No renters assigned yet.";
          list.appendChild(empty);
        } else {
          renters.forEach(function (renter) {
            const chip = el.renterChipTpl.content.firstElementChild.cloneNode(true);
            chip.textContent = fullName(renter) || "(Unnamed)";
            list.appendChild(chip);
          });
        }
      });
      if (addRenterBtn) {
        var vacancy = roomVacancy(room);
        addRenterBtn.disabled = vacancy <= 0;
        addRenterBtn.title = vacancy <= 0
          ? occupancyLimitMessage(room)
          : "Assign a renter to this room";
      }
    }
    renderChips();
    node._renderRoomChips = renderChips;

    name.addEventListener("input", function () {
      room.name = this.value;
      nameDisplay.textContent = this.value || "(Unnamed room)";
      syncRoomView(node, room);
      markDirty("rooms");
    });
    function applyRoomOccupants(raw) {
      var n = Math.max(1, parseInt(raw, 10) || 1);
      var assigned = activeRoomRenters(room.id).length;
      if (n < assigned) {
        toast("error", "Occupancy too low",
          (room.name || "This room") + " has " + assigned + " renter" + (assigned === 1 ? "" : "s") +
          " assigned. Set at least " + assigned + " or remove renters first.");
        occupants.value = String(room.occupant_amount || assigned);
        return;
      }
      room.occupant_amount = n;
      occupants.value = String(n);
      updateRoomHeader();
      syncRoomView(node, room);
      renderSummary();
      loadBillingPayments();
      markDirty("rooms");
    }
    occupants.addEventListener("input", function () {
      var raw = this.value.trim();
      if (raw === "") return;
      var n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 1) {
        room.occupant_amount = n;
        updateRoomHeader();
        syncRoomView(node, room);
        renderSummary();
        loadBillingPayments();
        markDirty("rooms");
      }
    });
    occupants.addEventListener("blur", function () {
      applyRoomOccupants(this.value);
    });
    rate.addEventListener("input", function () {
      room.rate_per_person = this.value === "" ? null : num(this.value);
      updateRoomHeader();
      syncRoomView(node, room);
      renderSummary();
      loadBillingPayments();
      markDirty("rooms");
    });

    addRenterBtn.addEventListener("click", function () {
      openAssignRenterPicker(room, function () {
        renderChips();
      });
    });

    syncRoomView(node, room);
    setEditPanelAccessible(node.querySelector(".card-edit-panel"), false);
    return node;
  }

  function recalcRooms() {
    const cards = el.tenantList.querySelectorAll(".tenant-card");
    cards.forEach(function (node) {
      node.querySelectorAll(".affix.cur").forEach(function (cur) {
        cur.textContent = state.settings.currency || "₱";
      });
    });
  }

  /* ---------------- Renters ---------------- */
  function populateRoomOptions(select, selectedId, renterId) {
    select.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— No room assigned —";
    select.appendChild(noneOpt);
    state.rooms.forEach(function (room) {
      const opt = document.createElement("option");
      opt.value = room.id;
      const limit = roomOccupancyLimit(room);
      const assigned = activeRoomRenters(room.id).length;
      const isCurrent = selectedId && String(room.id) === String(selectedId);
      const full = roomVacancy(room, renterId) <= 0 && !isCurrent;
      if (full) {
        opt.disabled = true;
        opt.textContent = (room.name || "(Unnamed room)") + " (full — " + limit + "/" + limit + ")";
      } else {
        opt.textContent = (room.name || "(Unnamed room)") + " (" + assigned + "/" + limit + ")";
      }
      select.appendChild(opt);
    });
    select.value = selectedId ? String(selectedId) : "";
  }

  function renderRenters() {
    closeEditModal();
    el.renterList.innerHTML = "";
    if (state.renters.length === 0) {
      const empty = document.createElement("div");
      empty.className = "expense-empty";
      empty.textContent = "No renters yet. Press “+ Add a renter” below, or add one straight from a Room card.";
      el.renterList.appendChild(empty);
      return;
    }
    state.renters.forEach(function (r) {
      el.renterList.appendChild(buildRenterCard(r));
    });
  }

  function refreshRoomChips() {
    el.tenantList.querySelectorAll(".tenant-card").forEach(function (node) {
      if (typeof node._renderRoomChips === "function") node._renderRoomChips();
    });
    recalcRooms();
    // Also update renter header room chips
    el.renterList.querySelectorAll(".renter-card").forEach(function (card) {
      if (typeof card._syncHeader === "function") card._syncHeader();
    });
  }

  // ── Phone number validation (Philippine format) ──────────────────────
  function isValidPH(num) {
    if (!num) return true;
    const cleaned = String(num).replace(/[\s\-()]/g, "");
    return /^(09\d{9}|\+639\d{9})$/.test(cleaned);
  }

  // ── Renter card header sync ───────────────────────────────────────────
  function syncRenterHeader(node, renter) {
    const avatar      = node.querySelector(".rc-avatar");
    const nameEl      = node.querySelector(".rc-full-name");
    const statusBadge = node.querySelector(".rc-status-badge");
    const roomChip    = node.querySelector(".rc-room-chip");
    const contactChip = node.querySelector(".rc-contact-chip");
    const durationChip= node.querySelector(".rc-duration-chip");

    const first = renter.first_name || "";
    const last  = renter.last_name  || "";
    const initials = ((first[0] || "") + (last[0] || "")).toUpperCase() || "?";
    avatar.textContent  = initials;
    nameEl.textContent  = [first, last].filter(Boolean).join(" ") || "New Renter";

    // Status badge
    const statusMap = { active: "Active", inactive: "Inactive", moved_out: "Moved Out" };
    statusBadge.textContent = statusMap[renter.status] || "Active";
    statusBadge.className   = "rc-status-badge rc-status-" + (renter.status || "active");

    // Room chip
    const assignedRoom = renter.room_id
      ? state.rooms.find(function (r) { return r.id === renter.room_id; })
      : null;
    roomChip.textContent = assignedRoom
      ? (assignedRoom.name || "Unnamed room")
      : "No room assigned";

    // Contact chip
    if (renter.contact_number) {
      contactChip.textContent = "📞 " + renter.contact_number;
      contactChip.style.display = "";
    } else {
      contactChip.style.display = "none";
    }

    // Duration chip
    const dur = durationSince(renter.stay_start_date);
    if (dur && dur !== "—") {
      durationChip.textContent = "⏱ " + dur;
      durationChip.style.display = "";
    } else {
      durationChip.style.display = "none";
    }
  }

  function buildRenterCard(renter) {
    const node = el.renterTpl.content.firstElementChild.cloneNode(true);
    node.dataset.renterId = renter.id;

    // Elements
    const rcHeader    = node.querySelector(".rc-header");
    const rcToggle    = node.querySelector(".rc-toggle");
    const editBtn     = node.querySelector(".card-edit-btn");
    const fields = {
      first:         node.querySelector(".r-first"),
      middle:        node.querySelector(".r-middle"),
      last:          node.querySelector(".r-last"),
      room:          node.querySelector(".r-room"),
      contact:       node.querySelector(".r-contact"),
      duration:      node.querySelector(".r-duration"),
      birthday:      node.querySelector(".r-birthday"),
      nationality:   node.querySelector(".r-nationality"),
      gender:        node.querySelector(".r-gender"),
      civilStatus:   node.querySelector(".r-civil-status"),
      address:       node.querySelector(".r-address"),
      mailAddress:   node.querySelector(".r-mail-address"),
      occupation:    node.querySelector(".r-occupation"),
      employer:      node.querySelector(".r-employer"),
      workAddress:   node.querySelector(".r-work-address"),
      idNumber:      node.querySelector(".r-id-number"),
      ecName:        node.querySelector(".r-ec-name"),
      ecRelation:    node.querySelector(".r-ec-relation"),
      ecNumber:      node.querySelector(".r-ec-number"),
      ecAddress:     node.querySelector(".r-ec-address"),
      since:         node.querySelector(".r-since"),
      nextDue:       node.querySelector(".r-next-due"),
      status:        node.querySelector(".r-status"),
      paymentMethod: node.querySelector(".r-payment-method"),
      isNew:         node.querySelector(".r-is-new"),
      newRenterFees: node.querySelector(".new-renter-fees"),
      advanceHint:   node.querySelector(".r-advance-hint"),
      deposit:       node.querySelector(".r-deposit"),
      advanceRent:   node.querySelector(".r-advance-rent"),
      balance:       node.querySelector(".r-balance"),
      reason:        node.querySelector(".r-reason"),
    };

    // ── Populate ──────────────────────────────────────────────────────
    fields.first.value   = renter.first_name  || "";
    fields.middle.value  = renter.middle_name || "";
    fields.last.value    = renter.last_name   || "";
    populateRoomOptions(fields.room, renter.room_id, renter.id);
    fields.contact.value = renter.contact_number || "";
    fields.duration.textContent = durationSince(renter.stay_start_date);

    if (fields.birthday)    fields.birthday.value    = renter.birthday ? String(renter.birthday).slice(0,10) : "";
    if (fields.nationality) fields.nationality.value = renter.nationality || "";
    if (fields.gender)      fields.gender.value      = renter.gender || "";
    if (fields.civilStatus) fields.civilStatus.value = renter.civil_status || "";
    if (fields.address)     fields.address.value     = renter.address || "";
    if (fields.mailAddress) fields.mailAddress.value = renter.mail_address || "";
    if (fields.occupation)  fields.occupation.value  = renter.occupation || "";
    if (fields.employer)    fields.employer.value    = renter.employer || "";
    if (fields.workAddress) fields.workAddress.value = renter.work_address || "";
    if (fields.idNumber)    fields.idNumber.value    = renter.id_number || "";
    if (fields.ecName)      fields.ecName.value      = renter.emergency_contact_name || "";
    if (fields.ecRelation)  fields.ecRelation.value  = renter.emergency_contact_relation || "";
    if (fields.ecNumber)    fields.ecNumber.value    = renter.emergency_contact_number || "";
    if (fields.ecAddress)   fields.ecAddress.value   = renter.emergency_contact_address || "";
    if (fields.since)       fields.since.value       = renter.stay_start_date ? String(renter.stay_start_date).slice(0,10) : "";
    if (fields.nextDue)     fields.nextDue.value     = renter.next_due ? String(renter.next_due).slice(0,10) : "";
    if (fields.status)      fields.status.value      = renter.status || "active";
    if (fields.paymentMethod) fields.paymentMethod.value = renter.payment_method || "cash";
    if (fields.isNew) {
      fields.isNew.value = renterIsNew(renter) ? "yes" : "no";
    }
    if (fields.deposit)     fields.deposit.value     = renter.deposit == null ? "" : renter.deposit;
    if (fields.advanceRent) fields.advanceRent.value = renter.advance_rent == null ? "" : renter.advance_rent;
    if (fields.balance)     fields.balance.value     = renter.balance == null ? "" : renter.balance;
    if (fields.reason)      fields.reason.value      = renter.reason_for_stay || "";

    function syncNewRenterFeesUI() {
      var isNew = fields.isNew && fields.isNew.value === "yes";
      renter.is_new_renter = isNew;
      if (fields.newRenterFees) fields.newRenterFees.hidden = !isNew;
      if (isNew) {
        var suggested = suggestedAdvanceRent(renter);
        if (fields.advanceHint) {
          fields.advanceHint.textContent = suggested != null
            ? "Suggested 1 month advance rent: " + money(suggested)
            : "Assign a room to auto-suggest 1 month advance";
        }
        if (renter.advance_rent == null && suggested != null && fields.advanceRent) {
          renter.advance_rent = suggested;
          fields.advanceRent.value = suggested;
        }
      }
      syncRenterView(node, renter);
    }
    syncNewRenterFeesUI();

    syncRenterHeader(node, renter);
    syncRenterView(node, renter);
    node._syncHeader = function () { syncRenterHeader(node, renter); syncRenterView(node, renter); };

    // ── Binding helpers ───────────────────────────────────────────────
    function bindText(input, prop, afterFn) {
      if (!input) return;
      input.addEventListener("input", function () {
        renter[prop] = this.value;
        if (afterFn) afterFn();
        syncRenterView(node, renter);
        markDirty("renters");
      });
    }
    function bindSelect(select, prop, afterFn) {
      if (!select) return;
      select.addEventListener("change", function () {
        renter[prop] = this.value;
        if (afterFn) afterFn();
        syncRenterView(node, renter);
        markDirty("renters");
      });
    }
    function bindDate(input, prop, afterFn) {
      if (!input) return;
      input.addEventListener("change", function () {
        renter[prop] = this.value || null;
        if (afterFn) afterFn();
        syncRenterView(node, renter);
        markDirty("renters");
      });
    }
    function bindNum(input, prop) {
      if (!input) return;
      input.addEventListener("input", function () {
        renter[prop] = this.value === "" ? null : num(this.value);
        syncRenterView(node, renter);
        markDirty("renters");
      });
    }

    // ── Contact number live validation ────────────────────────────────
    function validateContact() {
      const warnEl = fields.contact.parentElement;
      warnEl.querySelectorAll(".field-warn-msg").forEach(function (m) { m.remove(); });
      warnEl.classList.remove("field-warn");
      const val = fields.contact.value.trim();
      if (val && !isValidPH(val)) {
        warnEl.classList.add("field-warn");
        const msg = document.createElement("p");
        msg.className = "field-warn-msg";
        msg.textContent = "⚠ Expected format: 09xx xxx xxxx or +639xxxxxxxxx";
        warnEl.appendChild(msg);
      }
    }
    fields.contact.addEventListener("blur", validateContact);

    // ── Wire up all bindings ──────────────────────────────────────────
    bindText(fields.first,  "first_name",  function () { syncRenterHeader(node, renter); });
    bindText(fields.last,   "last_name",   function () { syncRenterHeader(node, renter); });
    bindText(fields.middle, "middle_name");
    bindText(fields.contact,"contact_number", function () { syncRenterHeader(node, renter); });
    bindDate(fields.birthday, "birthday");
    bindText(fields.nationality, "nationality");
    bindSelect(fields.gender,      "gender");
    bindSelect(fields.civilStatus, "civil_status");
    bindText(fields.address,    "address");
    bindText(fields.mailAddress, "mail_address");
    bindText(fields.occupation,  "occupation");
    bindText(fields.employer,    "employer");
    bindText(fields.workAddress, "work_address");
    bindText(fields.idNumber,    "id_number");
    bindText(fields.ecName,     "emergency_contact_name");
    bindText(fields.ecRelation, "emergency_contact_relation");
    bindText(fields.ecNumber,   "emergency_contact_number");
    bindText(fields.ecAddress,  "emergency_contact_address");
    bindDate(fields.since, "stay_start_date", function () {
      fields.duration.textContent = durationSince(renter.stay_start_date);
      syncRenterHeader(node, renter);
      // Auto-fill next_due only if the field is empty
      if (!renter.next_due && fields.nextDue) {
        const auto = nextDueFromMoveIn(renter.stay_start_date);
        if (auto) {
          renter.next_due = auto;
          fields.nextDue.value = auto;
          markDirty("renters");
        }
      }
    });
    bindDate(fields.nextDue, "next_due");
    bindSelect(fields.status, "status", function () { syncRenterHeader(node, renter); });
    bindSelect(fields.paymentMethod, "payment_method");
    if (fields.isNew) {
      fields.isNew.addEventListener("change", function () {
        renter.is_new_renter = this.value === "yes";
        if (!renter.is_new_renter) {
          renter.deposit = null;
          renter.advance_rent = null;
          if (fields.deposit) fields.deposit.value = "";
          if (fields.advanceRent) fields.advanceRent.value = "";
        }
        syncNewRenterFeesUI();
        markDirty("renters");
      });
    }
    bindNum(fields.deposit,     "deposit");
    bindNum(fields.advanceRent, "advance_rent");
    bindNum(fields.balance,     "balance");
    bindText(fields.reason,     "reason_for_stay");

    // Room assignment
    fields.room.addEventListener("change", function () {
      var prevRoomId = renter.room_id;
      var newRoomId = this.value === "" ? null : Number(this.value);
      if (newRoomId) {
        var room = state.rooms.find(function (r) { return r.id === newRoomId; });
        var check = canAssignRenterToRoom(room, renter);
        if (!check.ok) {
          toast("error", "Room is full", check.message);
          this.value = prevRoomId ? String(prevRoomId) : "";
          return;
        }
      }
      renter.room_id = newRoomId;
      if (renter.room_id) {
        ensureRenterBillingDefaults(renter);
        if (fields.since) fields.since.value = String(renter.stay_start_date).slice(0, 10);
        if (fields.nextDue) fields.nextDue.value = String(renter.next_due).slice(0, 10);
        syncNewRenterFeesUI();
      }
      syncRenterHeader(node, renter);
      syncRenterView(node, renter);
      refreshRoomChips();
      loadBillingPayments();
      renderSummary();
      markDirty("renters");
    });

    editBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (node.classList.contains("collapsed")) {
        node.classList.remove("collapsed");
        rcToggle.setAttribute("aria-expanded", "true");
      }
      openEditModal(node, "Edit " + (fullName(renter) || "Renter"), function () {
        syncRenterHeader(node, renter);
        syncRenterView(node, renter);
      });
    });

    // ── Card collapse toggle ──────────────────────────────────────────
    rcHeader.addEventListener("click", function (e) {
      if (e.target.closest(".rc-header-actions")) return;
      const isCollapsed = node.classList.contains("collapsed");
      node.classList.toggle("collapsed", !isCollapsed);
      rcToggle.setAttribute("aria-expanded", String(isCollapsed));
    });
    rcToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      const isCollapsed = node.classList.contains("collapsed");
      node.classList.toggle("collapsed", !isCollapsed);
      this.setAttribute("aria-expanded", String(isCollapsed));
    });

    // ── First-name required: clear error on input ─────────────────────
    fields.first.addEventListener("input", function () {
      const wrap = this.closest(".field");
      if (wrap) {
        wrap.classList.remove("field-error");
        wrap.querySelectorAll(".field-error-msg").forEach(function (m) { m.remove(); });
      }
      node.classList.remove("has-error");
    });

    // ── Remove ───────────────────────────────────────────────────────
    node.querySelector(".remove-renter").addEventListener("click", function () {
      const label = fullName(renter) || "this renter";
      if (!confirm('Remove "' + label + '"? This cannot be undone.')) return;
      api("DELETE", "/api/renters/" + renter.id).then(function () {
        state.renters = state.renters.filter(function (r) { return r.id !== renter.id; });
        renderRenters();
        refreshRoomChips();
        renderSummary();
        refreshCurrentMonthWidget();
        toast("success", label + " removed.");
      }).catch(saveFailed);
    });

    setEditPanelAccessible(node.querySelector(".card-edit-panel"), false);
    return node;
  }

  // ── Validate all renter cards before save ─────────────────────────────
  function validateAllRenters() {
    let errors = [];
    el.renterList.querySelectorAll(".renter-card").forEach(function (card, idx) {
      const firstInput = card.querySelector(".r-first");
      const firstWrap  = firstInput && firstInput.closest(".field");
      // Clear previous
      if (firstWrap) {
        firstWrap.classList.remove("field-error");
        firstWrap.querySelectorAll(".field-error-msg").forEach(function (m) { m.remove(); });
      }
      card.classList.remove("has-error");

      if (!firstInput || !firstInput.value.trim()) {
        errors.push("Renter #" + (idx + 1) + " is missing a first name.");
        if (firstWrap) {
          firstWrap.classList.add("field-error");
          const msg = document.createElement("p");
          msg.className = "field-error-msg";
          msg.textContent = "First name is required";
          firstWrap.appendChild(msg);
        }
        card.classList.add("has-error");
        card.classList.remove("collapsed");
        openEditModal(card, "Edit Renter — first name required", function () {
          if (typeof card._syncHeader === "function") card._syncHeader();
        });
      }

      var renter = state.renters[idx];
      if (renter && renterIsNew(renter)) {
        var missing = [];
        if (renter.deposit == null) missing.push("deposit");
        if (renter.advance_rent == null) missing.push("1 month advance rent");
        if (missing.length) {
          errors.push("Renter #" + (idx + 1) + " is new but missing " + missing.join(" and ") + ".");
          card.classList.add("has-error");
          card.classList.remove("collapsed");
          openEditModal(card, "New renter — enter deposit & advance", function () {
            if (typeof card._syncHeader === "function") card._syncHeader();
          });
          openRenterRentalSection(card);
        }
      }
    });

    var perRoom = {};
    state.renters.forEach(function (r) {
      if (!r.room_id || r.status === "moved_out") return;
      perRoom[r.room_id] = (perRoom[r.room_id] || 0) + 1;
    });
    Object.keys(perRoom).forEach(function (roomId) {
      var room = state.rooms.find(function (r) { return r.id === Number(roomId); });
      if (!room) return;
      var limit = roomOccupancyLimit(room);
      if (perRoom[roomId] > limit) {
        errors.push((room.name || "Room") + " has " + perRoom[roomId] + " renters but only allows " + limit + ".");
      }
    });

    return errors;
  }

  document.getElementById("addRenterBtn").addEventListener("click", function () {
    api("POST", "/api/renters", { is_new_renter: true }).then(function (renter) {
      state.renters.push(renter);
      renderRenters();
      // Auto-expand the newest card
      const cards = el.renterList.querySelectorAll(".renter-card");
      if (cards.length) {
        const last = cards[cards.length - 1];
        last.classList.remove("collapsed");
        const t = last.querySelector(".rc-toggle");
        if (t) t.setAttribute("aria-expanded", "true");
        openEditModal(last, "New Renter", function () {
          if (typeof last._syncHeader === "function") last._syncHeader();
        });
        openRenterRentalSection(last);
      }
    }).catch(saveFailed);
  });

  // ── Expand / Collapse all rooms ──────────────────────────────────────
  document.getElementById("expandAllRooms").addEventListener("click", function () {
    el.tenantList.querySelectorAll(".tenant-card").forEach(function (card) {
      card.classList.remove("collapsed");
      const t = card.querySelector(".tc-toggle");
      if (t) t.setAttribute("aria-expanded", "true");
    });
  });
  document.getElementById("collapseAllRooms").addEventListener("click", function () {
    el.tenantList.querySelectorAll(".tenant-card").forEach(function (card) {
      card.classList.add("collapsed");
      closeEditModalIfCard(card);
      const t = card.querySelector(".tc-toggle");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  });

  // ── Expand / Collapse all renters ────────────────────────────────────
  document.getElementById("expandAllRenters").addEventListener("click", function () {
    el.renterList.querySelectorAll(".renter-card").forEach(function (card) {
      card.classList.remove("collapsed");
      const t = card.querySelector(".rc-toggle");
      if (t) t.setAttribute("aria-expanded", "true");
    });
  });
  document.getElementById("collapseAllRenters").addEventListener("click", function () {
    el.renterList.querySelectorAll(".renter-card").forEach(function (card) {
      card.classList.add("collapsed");
      closeEditModalIfCard(card);
      const t = card.querySelector(".rc-toggle");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  });

  /* ---------------- Expenses ---------------- */
  var expenseListControls = {
    search: "",
    recurrence: "",
    applies: "",
    month: "",
    year: "",
    sort: "name_asc",
  };
  var expenseControlsReady = false;

  function expenseAppliesToMonth(expense, year, month) {
    if (expense.recurrence_type === "monthly") return true;
    return expense.expense_year === year && expense.expense_month === month;
  }

  function expenseIsActiveThisMonth(expense) {
    return expenseAppliesToMonth(expense, currentPeriod.year, currentPeriod.month);
  }

  function expenseMatchesFilters(expense) {
    var q = expenseListControls.search.toLowerCase().trim();
    if (q) {
      var name = (expense.name || "").toLowerCase();
      var amt = expense.amount != null ? String(expense.amount) : "";
      if (name.indexOf(q) === -1 && amt.indexOf(q) === -1) return false;
    }
    if (expenseListControls.recurrence && (expense.recurrence_type || "monthly") !== expenseListControls.recurrence) {
      return false;
    }
    if (expenseListControls.applies === "active" && !expenseIsActiveThisMonth(expense)) {
      return false;
    }
    if (expenseListControls.month || expenseListControls.year) {
      var fy = expenseListControls.year ? parseInt(expenseListControls.year, 10) : null;
      var fm = expenseListControls.month ? parseInt(expenseListControls.month, 10) : null;
      if (fy && fm) {
        if (!expenseAppliesToMonth(expense, fy, fm)) return false;
      } else if (fy) {
        if (expense.recurrence_type === "one_time" && expense.expense_year !== fy) return false;
      } else if (fm) {
        if (expense.recurrence_type === "one_time" && expense.expense_month !== fm) return false;
      }
    }
    return true;
  }

  function compareExpenses(a, b) {
    switch (expenseListControls.sort) {
      case "name_desc":
        return (b.name || "").localeCompare(a.name || "", undefined, { sensitivity: "base" });
      case "amount_desc":
        return num(b.amount) - num(a.amount);
      case "amount_asc":
        return num(a.amount) - num(b.amount);
      case "type": {
        var ta = (a.recurrence_type || "monthly") === "one_time" ? 1 : 0;
        var tb = (b.recurrence_type || "monthly") === "one_time" ? 1 : 0;
        if (ta !== tb) return ta - tb;
        return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      }
      case "recent":
        return (b.id || 0) - (a.id || 0);
      default:
        return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    }
  }

  function getSortedExpenses() {
    return state.expenses.slice().sort(compareExpenses);
  }

  function populateExpenseFilterDropdowns() {
    var monthSel = document.getElementById("expFilterMonth");
    var yearSel = document.getElementById("expFilterYear");
    if (!monthSel || !yearSel) return;

    var prevMonth = monthSel.value;
    var prevYear = yearSel.value;

    monthSel.innerHTML = '<option value="">All months</option>';
    MONTH_NAMES.forEach(function (name, i) {
      var opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = name;
      monthSel.appendChild(opt);
    });

    var years = {};
    years[currentPeriod.year] = true;
    state.expenses.forEach(function (e) {
      if (e.expense_year) years[e.expense_year] = true;
    });
    yearSel.innerHTML = '<option value="">All years</option>';
    Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
      var opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearSel.appendChild(opt);
    });

    monthSel.value = prevMonth || expenseListControls.month || "";
    yearSel.value = prevYear || expenseListControls.year || "";
  }

  function applyExpenseListControls() {
    var metaEl = document.getElementById("expenseListMeta");
    var filterEmptyEl = document.getElementById("expenseFilterEmpty");
    if (!el.expenseList) return;

    var active = document.activeElement;
    var editingExpense = active && active.closest
      && active.closest("#expenseList")
      && (active.classList.contains("e-name") || active.classList.contains("e-amount"));

    if (!editingExpense) {
      var sorted = getSortedExpenses();
      sorted.forEach(function (expense) {
        var row = el.expenseList.querySelector('[data-expense-id="' + expense.id + '"]');
        if (row) el.expenseList.appendChild(row);
      });
    }

    var visible = 0;
    state.expenses.forEach(function (expense) {
      var row = el.expenseList.querySelector('[data-expense-id="' + expense.id + '"]');
      if (!row) return;
      var show = expenseMatchesFilters(expense);
      row.classList.toggle("exp-row-hidden", !show);
      row.classList.toggle("exp-inactive", !expenseIsActiveThisMonth(expense));
      if (show) visible++;
    });

    var total = state.expenses.length;
    if (metaEl) {
      if (!total) metaEl.textContent = "";
      else if (visible === total) metaEl.textContent = "Showing all " + total + " expense" + (total === 1 ? "" : "s");
      else metaEl.textContent = "Showing " + visible + " of " + total + " expenses";
    }

    if (filterEmptyEl) {
      var showEmpty = total > 0 && visible === 0;
      filterEmptyEl.hidden = !showEmpty;
      if (showEmpty) {
        var q = expenseListControls.search.trim();
        filterEmptyEl.textContent = q
          ? 'No expenses match "' + q + '". Try a different keyword or clear the filters.'
          : "No expenses match your search or filters.";
      }
    }

    var listHead = document.querySelector(".expense-list-head");
    if (listHead) listHead.style.display = total > 0 && visible > 0 ? "" : "none";
    el.expenseList.style.display = visible > 0 ? "" : "none";
  }

  function clearExpenseFilters() {
    expenseListControls.search = "";
    expenseListControls.recurrence = "";
    expenseListControls.applies = "";
    expenseListControls.month = "";
    expenseListControls.year = "";
    var searchInput = document.getElementById("expSearchInput");
    if (searchInput) searchInput.value = "";
    var recurrenceSel = document.getElementById("expFilterRecurrence");
    if (recurrenceSel) recurrenceSel.value = "";
    var appliesSel = document.getElementById("expFilterApplies");
    if (appliesSel) appliesSel.value = "";
    var monthSel = document.getElementById("expFilterMonth");
    if (monthSel) monthSel.value = "";
    var yearSel = document.getElementById("expFilterYear");
    if (yearSel) yearSel.value = "";
    applyExpenseListControls();
  }

  function initExpenseListControls() {
    if (expenseControlsReady) return;
    expenseControlsReady = true;
    populateExpenseFilterDropdowns();

    var searchInput = document.getElementById("expSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        expenseListControls.search = this.value;
        applyExpenseListControls();
      });
    }
    var recurrenceSel = document.getElementById("expFilterRecurrence");
    if (recurrenceSel) {
      recurrenceSel.addEventListener("change", function () {
        expenseListControls.recurrence = this.value;
        applyExpenseListControls();
      });
    }
    var appliesSel = document.getElementById("expFilterApplies");
    if (appliesSel) {
      appliesSel.addEventListener("change", function () {
        expenseListControls.applies = this.value;
        if (this.value === "active") {
          expenseListControls.month = "";
          expenseListControls.year = "";
          var monthSel = document.getElementById("expFilterMonth");
          var yearSel = document.getElementById("expFilterYear");
          if (monthSel) monthSel.value = "";
          if (yearSel) yearSel.value = "";
        }
        applyExpenseListControls();
      });
    }
    var monthSel = document.getElementById("expFilterMonth");
    if (monthSel) {
      monthSel.addEventListener("change", function () {
        expenseListControls.month = this.value;
        if (this.value) {
          expenseListControls.applies = "";
          if (appliesSel) appliesSel.value = "";
        }
        applyExpenseListControls();
      });
    }
    var yearSel = document.getElementById("expFilterYear");
    if (yearSel) {
      yearSel.addEventListener("change", function () {
        expenseListControls.year = this.value;
        if (this.value) {
          expenseListControls.applies = "";
          if (appliesSel) appliesSel.value = "";
        }
        applyExpenseListControls();
      });
    }
    var sortSel = document.getElementById("expSortBy");
    if (sortSel) {
      sortSel.addEventListener("change", function () {
        expenseListControls.sort = this.value || "name_asc";
        applyExpenseListControls();
      });
    }
  }

  function renderExpenses() {
    initExpenseListControls();
    populateExpenseFilterDropdowns();
    el.expenseList.innerHTML = "";
    var filterEmptyEl = document.getElementById("expenseFilterEmpty");
    if (filterEmptyEl) filterEmptyEl.hidden = true;
    el.expenseList.style.display = "";

    if (state.expenses.length === 0) {
      const empty = document.createElement("div");
      empty.className = "expense-empty";
      empty.innerHTML = "No expenses yet. Click <strong>+ Add an expense</strong> below.";
      el.expenseList.appendChild(empty);
      var metaEl = document.getElementById("expenseListMeta");
      if (metaEl) metaEl.textContent = "";
      var listHead = document.querySelector(".expense-list-head");
      if (listHead) listHead.style.display = "none";
      return;
    }

    getSortedExpenses().forEach(function (e) {
      el.expenseList.appendChild(buildExpenseRow(e));
    });
    applyExpenseListControls();
  }

  function buildExpenseRow(expense) {
    const node       = el.expenseTpl.content.firstElementChild.cloneNode(true);
    node.dataset.expenseId = expense.id;
    const recurrence = node.querySelector(".e-recurrence");
    const name       = node.querySelector(".e-name");
    const amount     = node.querySelector(".e-amount");
    const monthPicker= node.querySelector(".e-month-picker");
    const recurBadge = node.querySelector(".exp-recur-badge");
    const cur        = node.querySelector(".affix.cur");

    if (cur) cur.textContent = state.settings.currency || "₱";

    // Set initial values
    const type = expense.recurrence_type || "monthly";
    recurrence.value = type;
    name.value    = expense.name   || "";
    amount.value  = expense.amount == null ? "" : expense.amount;

    function applyRecurrenceUI() {
      const isOneTime = recurrence.value === "one_time";
      monthPicker.style.display  = isOneTime ? "" : "none";
      recurBadge.style.display   = isOneTime ? "none" : "";
    }

    function monthPickerVal() {
      if (!expense.expense_year || !expense.expense_month) return "";
      return expense.expense_year + "-" + String(expense.expense_month).padStart(2, "0");
    }
    monthPicker.value = monthPickerVal();
    applyRecurrenceUI();

    recurrence.addEventListener("change", function () {
      expense.recurrence_type = this.value;
      if (this.value === "one_time" && !expense.expense_year) {
        // Pre-fill with current month
        expense.expense_month = currentPeriod.month;
        expense.expense_year  = currentPeriod.year;
        monthPicker.value = monthPickerVal();
      }
      if (this.value === "monthly") {
        expense.expense_month = null;
        expense.expense_year  = null;
        monthPicker.value = "";
      }
      applyRecurrenceUI();
      renderSummary();
      markDirty("expenses");
      applyExpenseListControls();
    });

    monthPicker.addEventListener("change", function () {
      if (!this.value) {
        expense.expense_month = null;
        expense.expense_year  = null;
      } else {
        const parts = this.value.split("-");
        expense.expense_year  = parseInt(parts[0], 10);
        expense.expense_month = parseInt(parts[1], 10);
      }
      renderSummary();
      markDirty("expenses");
      applyExpenseListControls();
    });

    name.addEventListener("input", function () {
      expense.name = this.value;
      markDirty("expenses");
    });
    name.addEventListener("blur", function () {
      applyExpenseListControls();
    });
    amount.addEventListener("input", function () {
      expense.amount = this.value === "" ? null : num(this.value);
      renderSummary();
      markDirty("expenses");
    });
    amount.addEventListener("blur", function () {
      applyExpenseListControls();
    });

    node.querySelector(".remove-expense").addEventListener("click", function () {
      const label = expense.name || "this expense";
      if (!confirm('Remove "' + label + '"?')) return;
      api("DELETE", "/api/expenses/" + expense.id).then(function () {
        state.expenses = state.expenses.filter(function (e) { return e.id !== expense.id; });
        renderExpenses();
        renderSummary();
        toast("success", "Expense removed.");
      }).catch(saveFailed);
    });
    return node;
  }

  // Helper: expenses active for the given period (year+month)
  function activeExpensesForPeriod(year, month) {
    return state.expenses.filter(function (e) {
      if (e.recurrence_type === "one_time") {
        return e.expense_year === year && e.expense_month === month;
      }
      return true; // monthly always applies
    });
  }

  document.getElementById("addExpenseBtn").addEventListener("click", function () {
    api("POST", "/api/expenses", { name: "", amount: null, recurrence_type: "monthly" }).then(function (expense) {
      state.expenses.push(expense);
      renderExpenses();
      renderSummary();
      const rows = el.expenseList.querySelectorAll(".expense-row .e-name");
      if (rows.length) rows[rows.length - 1].focus();
    }).catch(saveFailed);
  });

  function renderPaymentsTab() {
    loadBillingPayments();
  }

  function buildPaymentRow(target) {
    const node = el.paymentTpl.content.firstElementChild.cloneNode(true);
    const renterCell = node.querySelector(".p-renter");
    const roomCell = node.querySelector(".p-room");
    const breakdownCell = node.querySelector(".p-breakdown");
    const rentCell = node.querySelector(".p-rent");
    const dueCell = node.querySelector(".p-due");
    const statusBadge = node.querySelector(".p-status");
    const paidCheckbox = node.querySelector(".p-paid");
    const paidDateInput = node.querySelector(".p-paid-date");

    const renterNameCell = document.createElement("div");
    renterNameCell.style.display = "flex";
    renterNameCell.style.alignItems = "center";
    renterNameCell.style.gap = "6px";
    renterNameCell.style.flexWrap = "wrap";
    renterNameCell.textContent = fullName(target.renter) || "(Unnamed renter)";
    if (target.proration && target.proration.isProrated) {
      const badge = document.createElement("span");
      badge.className = "prorated-badge";
      badge.textContent = "Prorated";
      badge.title = "Move-in: " + String(target.renter.stay_start_date || "").slice(0, 10) +
        " · " + target.proration.label;
      renterNameCell.appendChild(badge);
    }
    renterCell.appendChild(renterNameCell);
    roomCell.textContent = target.room.name || "(Unnamed room)";
    const due = dueDateObj(target.room, viewPeriod.year, viewPeriod.month);
    dueCell.textContent = formatDate(due);

    const current = effectivePayment(state.paymentsView, target, viewPeriod.year, viewPeriod.month);
    var rentLabel = "Rent";
    if (target.proration && target.proration.isProrated) {
      rentLabel = "Rent (" + target.proration.label + ")";
    }
    [
      [rentLabel, current.rent_amount],
      ["Electricity", current.electricity_amount],
      ["Internet", current.internet_amount],
    ].forEach(function (item) {
      const line = document.createElement("span");
      line.className = "p-charge-line";
      const label = document.createElement("span");
      label.textContent = item[0];
      const value = document.createElement("strong");
      value.textContent = money(item[1]);
      line.appendChild(label);
      line.appendChild(value);
      breakdownCell.appendChild(line);
    });
    rentCell.textContent = money(current.amount);
    paidCheckbox.checked = !!current.paid;
    paidDateInput.value = current.paid_date ? String(current.paid_date).slice(0, 10) : "";

    function applyStatus() {
      statusBadge.classList.remove("paid", "overdue");
      if (paidCheckbox.checked) {
        statusBadge.textContent = "Paid";
        statusBadge.classList.add("paid");
      } else if (due && due < startOfToday()) {
        statusBadge.textContent = "Overdue";
        statusBadge.classList.add("overdue");
      } else {
        statusBadge.textContent = due ? "Pending" : "No due date";
      }
    }
    applyStatus();

    function stagePending() {
      const key = pendingKey(target.room.id, target.renter ? target.renter.id : null, viewPeriod.year, viewPeriod.month);
      pendingPayments[key] = {
        room_id: target.room.id,
        renter_id: target.renter ? target.renter.id : null,
        year: viewPeriod.year,
        month: viewPeriod.month,
        paid: paidCheckbox.checked,
        paid_date: paidDateInput.value || null,
        amount: current.amount,
        rent_amount: current.rent_amount,
        electricity_amount: current.electricity_amount,
        internet_amount: current.internet_amount,
      };
      applyStatus();
      markDirty("rooms");
    }

    paidCheckbox.addEventListener("change", function () {
      if (paidCheckbox.checked && !paidDateInput.value) paidDateInput.value = todayISO();
      stagePending();
    });
    paidDateInput.addEventListener("change", stagePending);

    return node;
  }

  function loadPaymentsView() { return Promise.resolve(); }

  /* ---------------- Dashboard payments widget (always real current month) ---------------- */
  function renderDashboardWidget() {
    const targets = paymentTargets();
    el.dashPaymentsSummary.innerHTML = "";
    const periodLabel = MONTH_NAMES[currentPeriod.month - 1] + " " + currentPeriod.year;
    if (!targets.length) {
      el.dashPaymentsPeriod.textContent = periodLabel + (state.rooms.length
        ? " — no renters assigned yet"
        : " — set up rooms first");
      renderCollectionMeter([]);
      renderReminders([]);
      renderWorkflowGuide();
      return;
    }
    let paidCount = 0;
    targets.forEach(function (t) {
      const current = effectivePayment(state.paymentsCurrent, t, currentPeriod.year, currentPeriod.month);
      const paid = !!current.paid;
      if (paid) paidCount++;
      const due = dueDateObj(t.room, currentPeriod.year, currentPeriod.month);
      const overdue = !paid && due && due < startOfToday();
      const chip = document.createElement("span");
      chip.className = "dash-chip" + (paid ? " paid" : overdue ? " overdue" : "");
      const label = t.renter ? fullName(t.renter) : t.room.name;
      chip.textContent = label + (paid ? " · Paid" : overdue ? " · Overdue" : " · Pending");
      el.dashPaymentsSummary.appendChild(chip);
    });
    el.dashPaymentsPeriod.textContent = MONTH_NAMES[currentPeriod.month - 1] + " " + currentPeriod.year +
      " — " + paidCount + " of " + targets.length + " paid";

    renderCollectionMeter(targets);
    renderReminders(targets);
    renderWorkflowGuide();
  }

  /* ---------------- Collection meter (expected vs collected, this month) ---------------- */
  function renderCollectionMeter(targets) {
    let expected = 0;
    let collected = 0;
    targets.forEach(function (t) {
      const current = effectivePayment(state.paymentsCurrent, t, currentPeriod.year, currentPeriod.month);
      expected += num(current.amount);
      if (current.paid) collected += num(current.amount);
    });
    const pct = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
    el.collectionMeterFill.style.width = pct + "%";
    el.collectionMeterFill.classList.toggle("full", pct >= 100 && expected > 0);
    el.collectionCollected.textContent = money(collected);
    el.collectionExpected.textContent = money(expected);
  }

  /* ---------------- Billing reminders ----------------
     Looks at every billable unit for the current real month and flags the
     ones that are overdue or coming due soon, sorted most-urgent first. */
  const REMIND_SOON_DAYS = 7;
  function renderReminders(targets) {
    el.remindersList.innerHTML = "";
    const today = startOfToday();
    const items = [];

    targets.forEach(function (t) {
      const current = effectivePayment(state.paymentsCurrent, t, currentPeriod.year, currentPeriod.month);
      if (current.paid) return;
      const due = dueDateObj(t.room, currentPeriod.year, currentPeriod.month);
      if (!due) return;
      const diffDays = Math.round((due - today) / 86400000);
      if (diffDays < 0) {
        items.push({ target: t, due: due, days: diffDays, kind: "overdue" });
      } else if (diffDays <= REMIND_SOON_DAYS) {
        items.push({ target: t, due: due, days: diffDays, kind: "soon" });
      }
    });

    items.sort(function (a, b) { return a.days - b.days; });

    const overdueCount = items.filter(function (i) { return i.kind === "overdue"; }).length;
    const soonCount = items.length - overdueCount;

    if (!items.length) {
      el.remindersSummary.textContent = targets.length
        ? "You're all caught up — nothing due in the next " + REMIND_SOON_DAYS + " days."
        : "Assign renters to rooms to get reminders for the 15th.";
      const ok = document.createElement("div");
      ok.className = "reminders-empty";
      ok.textContent = targets.length ? "✓ No overdue or upcoming payments." : "No assigned renters yet.";
      el.remindersList.appendChild(ok);
      return;
    }

    const parts = [];
    if (overdueCount) parts.push(overdueCount + " overdue");
    if (soonCount) parts.push(soonCount + " due soon");
    el.remindersSummary.textContent = parts.join(" · ");

    items.forEach(function (item) {
      const t = item.target;
      const row = document.createElement("div");
      row.className = "reminder-row " + item.kind;

      const info = document.createElement("div");
      info.className = "reminder-info";
      const who = document.createElement("span");
      who.className = "reminder-who";
      who.textContent = t.renter ? (fullName(t.renter) || "(Unnamed)") : (t.room.name || "(Unnamed room)");
      const sub = document.createElement("span");
      sub.className = "reminder-sub";
      if (t.renter) {
        sub.textContent = (t.room.name || "Room") + " · due " + formatDate(item.due);
      } else {
        sub.textContent = "Due " + formatDate(item.due);
      }
      info.appendChild(who);
      info.appendChild(sub);

      const right = document.createElement("div");
      right.className = "reminder-right";
      const amount = document.createElement("span");
      amount.className = "reminder-amount";
      amount.textContent = money(effectivePayment(
        state.paymentsCurrent, t, currentPeriod.year, currentPeriod.month
      ).amount);
      const badge = document.createElement("span");
      badge.className = "reminder-badge " + item.kind;
      if (item.kind === "overdue") {
        const late = Math.abs(item.days);
        badge.textContent = late === 0 ? "Due today" : late + (late === 1 ? " day late" : " days late");
      } else {
        badge.textContent = item.days === 0 ? "Due today" : "In " + item.days + (item.days === 1 ? " day" : " days");
      }
      right.appendChild(amount);
      right.appendChild(badge);

      row.appendChild(info);
      row.appendChild(right);
      el.remindersList.appendChild(row);
    });
  }

  /* ---------------- Workflow guide ---------------- */
  function renderWorkflowGuide() {
    if (!el.wfRoomsCount) return;
    const roomCount = state.rooms.length;
    const renterCount = state.renters.length;
    const assigned = assignedRenters();
    const assignedCount = assigned.length;
    const billsThisMonth = (state.paymentsCurrent || []).length;

    el.wfRoomsCount.textContent = roomCount
      ? roomCount + (roomCount === 1 ? " room" : " rooms") + " set up"
      : "No rooms yet";
    el.wfRentersCount.textContent = renterCount
      ? assignedCount + " of " + renterCount + " renters assigned to rooms"
      : "No renters yet — add in Renters tab";
    if (!assignedCount) {
      el.wfBillingCount.textContent = roomCount
        ? "Assign renters in Rooms, then open Billing"
        : "Set up rooms first";
    } else if (!billsThisMonth) {
      el.wfBillingCount.textContent = assignedCount + " renter" + (assignedCount === 1 ? "" : "s") +
        " ready — enter meters & generate bills";
    } else {
      const paidCount = (state.paymentsCurrent || []).filter(function (p) { return p.paid; }).length;
      el.wfBillingCount.textContent = paidCount + " of " + billsThisMonth + " paid this month";
    }
  }

  function refreshCurrentMonthWidget() {
    return api("GET", "/api/payments?year=" + currentPeriod.year + "&month=" + currentPeriod.month).then(function (rows) {
      state.paymentsCurrent = rows;
      renderSummary();
      renderDashboardWidget();
      loadStats();
    }).catch(function () { /* dashboard widget failure is non-critical */ });
  }

  /* ---------------- Monthly financial statistics ----------------
     Pulls the full payment history and charts how much was actually
     collected (paid) in each of the last several months. */
  function loadStats() {
    return api("GET", "/api/payments").then(renderStats).catch(function () { /* non-critical */ });
  }

  function renderStats(rows) {
    const MONTHS_SHOWN = 12;
    // Build the last MONTHS_SHOWN month buckets ending on the current month.
    const buckets = [];
    const index = {};
    let y = currentPeriod.year;
    let m = currentPeriod.month;
    for (let i = 0; i < MONTHS_SHOWN; i++) {
      buckets.unshift({ year: y, month: m, collected: 0 });
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
    }
    buckets.forEach(function (b) { index[b.year + "-" + b.month] = b; });

    (rows || []).forEach(function (row) {
      if (!row.paid) return;
      const key = row.period_year + "-" + row.period_month;
      if (index[key]) index[key].collected += num(row.amount);
    });

    const total = buckets.reduce(function (s, b) { return s + b.collected; }, 0);
    const monthsWithData = buckets.filter(function (b) { return b.collected > 0; }).length;
    const avg = monthsWithData ? total / monthsWithData : 0;
    let best = null;
    buckets.forEach(function (b) { if (!best || b.collected > best.collected) best = b; });
    const max = best ? best.collected : 0;

    el.statsYearTotal.textContent = money(total);
    el.statsAvg.textContent = money(avg);
    el.statsBest.textContent = best && best.collected > 0
      ? MONTH_NAMES[best.month - 1].slice(0, 3) + " " + best.year + " · " + money(best.collected)
      : "—";

    el.statsChart.innerHTML = "";
    if (total <= 0) {
      el.statsChart.style.display = "none";
      el.statsEmpty.style.display = "";
      return;
    }
    el.statsChart.style.display = "";
    el.statsEmpty.style.display = "none";

    buckets.forEach(function (b) {
      const col = document.createElement("div");
      col.className = "stats-bar-col";
      const isCurrent = b.year === currentPeriod.year && b.month === currentPeriod.month;

      const barWrap = document.createElement("div");
      barWrap.className = "stats-bar-wrap";
      const bar = document.createElement("div");
      bar.className = "stats-bar" + (isCurrent ? " current" : "");
      const h = max > 0 ? Math.max(2, Math.round((b.collected / max) * 100)) : 0;
      bar.style.height = h + "%";
      if (b.collected > 0) {
        bar.title = MONTH_NAMES[b.month - 1] + " " + b.year + ": " + money(b.collected);
        const val = document.createElement("span");
        val.className = "stats-bar-value";
        val.textContent = money(b.collected);
        bar.appendChild(val);
      }
      barWrap.appendChild(bar);

      const label = document.createElement("span");
      label.className = "stats-bar-label";
      label.textContent = MONTH_NAMES[b.month - 1].slice(0, 3);
      const yearLabel = document.createElement("span");
      yearLabel.className = "stats-bar-year";
      yearLabel.textContent = "'" + String(b.year).slice(2);

      col.appendChild(barWrap);
      col.appendChild(label);
      col.appendChild(yearLabel);
      el.statsChart.appendChild(col);
    });
  }

  /* ---------------- History ---------------- */
  function loadHistory() {
    initHistoryControls();
    return api("GET", "/api/payments").then(function (rows) {
      historyRowsCache = rows || [];
      populateHistoryFilterDropdowns();
      applyHistoryControls();
    }).catch(saveFailed);
  }

  function loadMeterHistory() {
    return api("GET", "/api/meter-history").then(function (data) {
      state.meterHistory = {
        rooms: (data && data.rooms) || [],
        house: (data && data.house) || [],
      };
      renderMeterHistory(data);
    }).catch(saveFailed);
  }

  function renderMeterHistory(data) {
    const roomRows  = (data && data.rooms)  || [];
    const houseRows = (data && data.house) || [];

    // ── Inline house meter history in the Rooms tab ───────────────────
    const hhEmpty  = document.getElementById("houseMeterHistEmpty");
    const hhTable  = document.getElementById("houseMeterHistTable");
    const hhRows   = document.getElementById("houseMeterHistRows");
    const hhCount  = document.getElementById("houseMeterHistCount");
    if (hhRows) {
      hhRows.innerHTML = "";
      const sortedHouse = houseRows.slice().sort(function (a, b) {
        return (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month);
      });
      if (hhEmpty)  hhEmpty.style.display  = sortedHouse.length ? "none" : "";
      if (hhTable)  hhTable.style.display  = sortedHouse.length ? ""     : "none";
      if (hhCount)  hhCount.textContent    = sortedHouse.length ? "(" + sortedHouse.length + " records)" : "";
      sortedHouse.forEach(function (h) {
        var period = MONTH_NAMES[(h.period_month || 1) - 1] + " " + h.period_year;
        var row = document.createElement("div");
        row.className = "hh-row";
        var prev = h.prev_reading != null ? Number(h.prev_reading).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) : "—";
        var curr = h.curr_reading != null ? Number(h.curr_reading).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) : "—";
        var used = Number(h.usage_kwh || 0).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) + " kWh";
        row.innerHTML = [
          "<span data-label='Period'>" + period + "</span>",
          "<span data-label='Previous'>" + prev + "</span>",
          "<span data-label='Current'>" + curr + "</span>",
          "<span data-label='Used'>" + used + "</span>",
        ].join("");
        hhRows.appendChild(row);
      });
    }

    // ── Full history tab rendering ────────────────────────────────────
    el.meterHistoryList.innerHTML = "";
    if (!roomRows.length && !houseRows.length) {
      el.meterHistoryEmpty.style.display = "";
      return;
    }
    el.meterHistoryEmpty.style.display = "none";

    const groups = {};
    roomRows.forEach(function (row) {
      const key = row.period_year + "-" + row.period_month;
      if (!groups[key]) groups[key] = {
        year: row.period_year, month: row.period_month, rooms: [], house: null,
      };
      groups[key].rooms.push(row);
    });
    houseRows.forEach(function (row) {
      const key = row.period_year + "-" + row.period_month;
      if (!groups[key]) groups[key] = {
        year: row.period_year, month: row.period_month, rooms: [], house: null,
      };
      groups[key].house = row;
    });

    Object.keys(groups).sort(function (a, b) {
      const ga = groups[a];
      const gb = groups[b];
      return (gb.year * 12 + gb.month) - (ga.year * 12 + ga.month);
    }).forEach(function (key) {
      const group = groups[key];
      const section = document.createElement("section");
      section.className = "meter-history-group";

      const heading = document.createElement("div");
      heading.className = "history-group-head";
      const title = document.createElement("span");
      title.className = "history-group-title";
      title.textContent = MONTH_NAMES[group.month - 1] + " " + group.year;
      const totalUsage = group.rooms.reduce(function (sum, row) {
        return sum + num(row.usage_kwh);
      }, 0);
      const total = document.createElement("span");
      total.className = "history-group-total";
      total.textContent = "Rooms billed " + kwh(totalUsage);
      heading.appendChild(title);
      heading.appendChild(total);
      section.appendChild(heading);

      const table = document.createElement("div");
      table.className = "meter-history-table";
      const tableHead = document.createElement("div");
      tableHead.className = "meter-history-head";
      ["Meter", "Previous", "Current", "Usage", "Rate", "Charge", ""].forEach(function (label) {
        const cell = document.createElement("span");
        cell.textContent = label;
        tableHead.appendChild(cell);
      });
      table.appendChild(tableHead);

      function appendMeterRow(name, row, isHouse) {
        const rowEl = document.createElement("div");
        rowEl.className = "meter-history-row" + (isHouse ? " house" : "");
        const values = [
          name,
          row.prev_reading == null ? "—" : num(row.prev_reading).toLocaleString(),
          row.curr_reading == null ? "—" : num(row.curr_reading).toLocaleString(),
          kwh(row.usage_kwh),
          isHouse ? "—" : money(row.electricity_rate),
          isHouse ? "—" : money(row.electricity_charge),
        ];
        values.forEach(function (value, i) {
          const cell = document.createElement("span");
          cell.setAttribute("data-label", tableHead.children[i].textContent);
          cell.textContent = value;
          rowEl.appendChild(cell);
        });
        const actionsCell = document.createElement("span");
        actionsCell.className = "meter-history-actions";
        actionsCell.setAttribute("data-label", "");
        rowEl.appendChild(actionsCell);
        table.appendChild(rowEl);
      }

      group.rooms.forEach(function (row) {
        appendMeterRow(row.room_name || "(Deleted room)", row, false);
      });
      if (group.house) appendMeterRow("Main house", group.house, true);
      section.appendChild(table);
      el.meterHistoryList.appendChild(section);
    });
  }

  /* ---------------- Receipts ---------------- */
  let receiptControlsReady = false;
  var receiptSearchCatalog = [];

  function formatReceiptNo(renterId, year, month) {
    return "OR-" + year + String(month).padStart(2, "0") + "-" + String(renterId).padStart(3, "0");
  }

  function buildReceiptSearchCatalog(paymentRows) {
    var seen = {};
    var items = [];

    function addEntry(renterId, year, month, paid, amount) {
      if (!renterId || !year || !month) return;
      var key = renterId + ":" + year + ":" + month;
      if (seen[key]) return;
      seen[key] = true;
      var renter = state.renters.find(function (r) { return r.id === renterId; });
      if (!renter) return;
      var room = renter.room_id
        ? state.rooms.find(function (r) { return r.id === renter.room_id; })
        : null;
      var orNo = formatReceiptNo(renterId, year, month);
      var renterName = fullName(renter) || "(Unnamed renter)";
      var roomName = room ? (room.name || "Room") : "No room";
      var period = MONTH_NAMES[month - 1] + " " + year;
      items.push({
        renterId: renterId,
        year: year,
        month: month,
        orNo: orNo,
        renterName: renterName,
        roomName: roomName,
        period: period,
        paid: !!paid,
        amount: amount,
        searchText: (
          orNo + " " + renterName + " " + roomName + " " + period +
          " bill billed receipt " + (renter.contact_number || "")
        ).toLowerCase(),
      });
    }

    (paymentRows || []).forEach(function (p) {
      if (p.renter_id) {
        addEntry(p.renter_id, p.period_year, p.period_month, p.paid, p.amount);
      }
    });

    (state.roomHistory || []).forEach(function (h) {
      roomRenters(h.room_id).forEach(function (r) {
        addEntry(r.id, h.period_year, h.period_month, false, null);
      });
    });

    state.renters.forEach(function (r) {
      if (r.room_id) {
        addEntry(r.id, currentPeriod.year, currentPeriod.month, false, null);
      }
    });

    items.sort(function (a, b) {
      if (b.year !== a.year) return b.year - a.year;
      if (b.month !== a.month) return b.month - a.month;
      return a.renterName.localeCompare(b.renterName);
    });
    return items;
  }

  function loadReceiptSearchCatalog() {
    return api("GET", "/api/payments").then(function (rows) {
      receiptSearchCatalog = buildReceiptSearchCatalog(rows || []);
    }).catch(function () {
      receiptSearchCatalog = buildReceiptSearchCatalog([]);
    });
  }

  function parseReceiptOrQuery(q) {
    var m = String(q || "").trim().match(/^OR[\s-]?(\d{4})[\s-]?(\d{2})[\s-]?(\d{1,})/i);
    if (!m) return null;
    return {
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      renterId: parseInt(m[3], 10),
    };
  }

  function selectReceipt(renterId, year, month) {
    if (el.receiptRenter) el.receiptRenter.value = String(renterId);
    if (el.receiptMonth) el.receiptMonth.value = String(month);
    if (el.receiptYear) el.receiptYear.value = String(year);
    renderReceiptPreview();
  }

  function runReceiptSearch(query) {
    var dropdown = document.getElementById("receiptSearchDropdown");
    var clearBtn = document.getElementById("receiptSearchClear");
    if (!dropdown) return;

    var q = String(query || "").trim();
    if (clearBtn) clearBtn.classList.toggle("visible", !!q);
    if (!q) {
      dropdown.hidden = true;
      return;
    }

    var orParsed = parseReceiptOrQuery(q);
    if (orParsed && state.renters.some(function (r) { return r.id === orParsed.renterId; })) {
      var match = receiptSearchCatalog.find(function (item) {
        return item.renterId === orParsed.renterId &&
          item.year === orParsed.year && item.month === orParsed.month;
      });
      selectReceipt(orParsed.renterId, orParsed.year, orParsed.month);
      var searchInput = document.getElementById("receiptSearchInput");
      if (searchInput) {
        searchInput.value = match ? match.orNo : formatReceiptNo(orParsed.renterId, orParsed.year, orParsed.month);
      }
      dropdown.hidden = true;
      return;
    }

    var lower = q.toLowerCase();
    var matches = receiptSearchCatalog.filter(function (item) {
      return item.searchText.indexOf(lower) >= 0 ||
        item.orNo.toLowerCase().indexOf(lower) >= 0;
    }).slice(0, 15);

    dropdown.innerHTML = "";
    if (!matches.length) {
      dropdown.innerHTML = '<div class="search-no-results">No receipt found. Try an OR number (e.g. OR-202607-001), renter name, or room.</div>';
      dropdown.hidden = false;
      return;
    }

    matches.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-result-item";
      btn.innerHTML =
        '<span class="sri-label">' + escapeHtml(item.orNo) + " · " + escapeHtml(item.renterName) + '</span>' +
        '<span class="sri-sub">' + escapeHtml(item.roomName) + " · " + escapeHtml(item.period) +
        (item.paid ? " · Paid" : "") + '</span>';
      btn.addEventListener("click", function () {
        selectReceipt(item.renterId, item.year, item.month);
        var searchInput = document.getElementById("receiptSearchInput");
        if (searchInput) searchInput.value = item.orNo;
        dropdown.hidden = true;
      });
      dropdown.appendChild(btn);
    });
    dropdown.hidden = false;
  }

  function initReceiptSearch() {
    var searchInput = document.getElementById("receiptSearchInput");
    var clearBtn = document.getElementById("receiptSearchClear");
    var wrap = document.getElementById("receiptSearchWrap");
    if (!searchInput || searchInput.dataset.ready) return;
    searchInput.dataset.ready = "1";

    searchInput.addEventListener("input", function () {
      runReceiptSearch(this.value);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var first = document.querySelector("#receiptSearchDropdown .search-result-item");
        if (first) first.click();
      }
      if (e.key === "Escape") {
        document.getElementById("receiptSearchDropdown").hidden = true;
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        searchInput.value = "";
        runReceiptSearch("");
        searchInput.focus();
      });
    }
    document.addEventListener("click", function (e) {
      if (wrap && !wrap.contains(e.target)) {
        var dropdown = document.getElementById("receiptSearchDropdown");
        if (dropdown) dropdown.hidden = true;
      }
    });
  }

  // Self-contained styles written into the print iframe so the receipt looks
  // identical whether previewed on screen or sent to the printer / PDF.
  const RECEIPT_PRINT_CSS =
    '@page { size: A5; margin: 14mm; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #131a24; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    '.receipt { max-width: 560px; margin: 0 auto; }' +
    '.receipt-head { display: flex; justify-content: center; padding-bottom: 16px; border-bottom: 2px solid #131a24; }' +
    '.receipt-meta { text-align: center; }' +
    '.receipt-title { font-size: 22px; font-weight: 800; letter-spacing: -0.2px; color: #131a24; }' +
    '.receipt-no { font-size: 12.5px; font-weight: 700; margin-top: 2px; }' +
    '.receipt-issued { font-size: 12px; color: #5b6572; font-weight: 600; }' +
    '.receipt-parties { display: flex; justify-content: space-between; gap: 20px; padding: 16px 0; }' +
    '.receipt-party { display: flex; flex-direction: column; gap: 2px; }' +
    '.receipt-party-right { text-align: right; align-items: flex-end; }' +
    '.receipt-label { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #8993a1; }' +
    '.receipt-strong { font-size: 15px; font-weight: 800; }' +
    '.receipt-muted { font-size: 12.5px; color: #5b6572; font-weight: 600; }' +
    '.receipt-table { width: 100%; border-collapse: collapse; margin-top: 4px; }' +
    '.receipt-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #8993a1; border-bottom: 1px solid #e2e6ea; padding: 8px 6px; }' +
    '.receipt-table td { padding: 10px 6px; font-size: 13.5px; font-weight: 600; border-bottom: 1px solid #eef1f4; vertical-align: top; }' +
    '.receipt-note { color: #5b6572; font-weight: 500; font-size: 12.5px; }' +
    '.ta-right { text-align: right; }' +
    '.receipt-total-label { font-weight: 800; padding-top: 12px; }' +
    '.receipt-total { font-weight: 800; font-size: 17px; color: #1e3a8a; padding-top: 12px; }' +
    '.receipt-status { display: flex; align-items: center; gap: 12px; margin-top: 18px; }' +
    '.receipt-stamp { font-size: 13px; font-weight: 800; letter-spacing: 0.06em; padding: 6px 14px; border-radius: 6px; border: 2px solid; }' +
    '.receipt-stamp.paid { color: #15803d; border-color: #15803d; }' +
    '.receipt-stamp.unpaid { color: #b91c1c; border-color: #b91c1c; }' +
    '.receipt-status-note { font-size: 12.5px; font-weight: 600; color: #5b6572; }' +
    '.receipt-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 40px; gap: 20px; }' +
    '.receipt-sign { display: flex; flex-direction: column; gap: 4px; width: 200px; }' +
    '.receipt-sign-line { border-top: 1px solid #131a24; height: 1px; margin-top: 24px; }' +
    '.receipt-sign-label { font-size: 12px; color: #5b6572; font-weight: 600; }' +
    '.receipt-thanks { font-size: 13px; font-weight: 700; color: #1d4ed8; }' +
    '.receipt-fineprint { margin-top: 20px; padding-top: 12px; border-top: 1px dashed #cbd3da; font-size: 10.5px; color: #8993a1; font-weight: 500; line-height: 1.45; }';

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function initReceiptControls() {
    if (receiptControlsReady) return;
    receiptControlsReady = true;
    initReceiptSearch();

    MONTH_NAMES.forEach(function (name, i) {
      const opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = name;
      el.receiptMonth.appendChild(opt);
    });
    el.receiptMonth.value = String(currentPeriod.month);
    el.receiptYear.value = String(currentPeriod.year);

    el.receiptRenter.addEventListener("change", renderReceiptPreview);
    el.receiptMonth.addEventListener("change", renderReceiptPreview);
    el.receiptYear.addEventListener("change", renderReceiptPreview);
    el.printReceiptBtn.addEventListener("click", printReceipt);
  }

  function populateReceiptRenters() {
    const prev = el.receiptRenter.value;
    el.receiptRenter.innerHTML = "";
    state.renters.forEach(function (r) {
      const opt = document.createElement("option");
      opt.value = String(r.id);
      opt.textContent = fullName(r) || "(Unnamed renter)";
      el.receiptRenter.appendChild(opt);
    });
    if (prev && state.renters.some(function (r) { return String(r.id) === prev; })) {
      el.receiptRenter.value = prev;
    }
  }

  function openReceiptsTab() {
    initReceiptControls();
    populateReceiptRenters();
    loadReceiptSearchCatalog();
    const hasRenters = state.renters.length > 0;
    el.receiptEmpty.style.display = hasRenters ? "none" : "";
    el.printReceiptBtn.disabled = !hasRenters;
    if (hasRenters) renderReceiptPreview();
    else el.receiptPreview.innerHTML = "";
  }

  // Builds a receipt model for one renter and period. Rent for a per-person
  // room is that person's rate; for a flat room it's the room rent split
  // evenly among assigned renters. Electricity (based on the latest meter
  // readings) is likewise split evenly among the room's renters.
  function getReceiptModel() {
    const renterId = Number(el.receiptRenter.value);
    const renter = state.renters.find(function (r) { return r.id === renterId; });
    if (!renter) return Promise.resolve(null);
    const year = num(el.receiptYear.value) || currentPeriod.year;
    const month = num(el.receiptMonth.value) || currentPeriod.month;
    const room = state.rooms.find(function (r) { return r.id === renter.room_id; }) || null;
    const count = room ? Math.max(1, roomRenters(room.id).length) : 1;
    const rate = num(state.settings.rate);

    let rentShare = 0;
    let rentNote = "No room assigned";
    let proratedInfo = null;
    if (room) {
      const fullRate = num(room.rate_per_person);
      const pro = computeProration(renter, fullRate, year, month);
      proratedInfo = pro.isProrated ? pro : null;
      rentShare = pro.amount;
      if (pro.isProrated) {
        rentNote = pro.label + " (prorated from " + String(renter.stay_start_date || "").slice(0, 10) + ")";
      } else {
        rentNote = "Per-person rate · full month";
      }
    }

    let usedKwh = room ? roomKwh(room) : 0;
    let billedRate = rate;
    let elecFull = usedKwh * billedRate;
    const internetShare = room ? num(state.settings.internet_rate) : 0;

    return Promise.all([
      api("GET", "/api/payments?year=" + year + "&month=" + month),
      api("GET", "/api/meter-history"),
    ]).then(function (results) {
      const rows = results[0];
      const meterData = results[1];
      const meterRow = room && meterData.rooms.find(function (row) {
        return row.room_id === room.id &&
          row.period_year === year && row.period_month === month;
      });
      if (meterRow) {
        usedKwh = num(meterRow.usage_kwh);
        billedRate = num(meterRow.electricity_rate);
        elecFull = num(meterRow.electricity_charge);
      }
      const elecShare = count > 1 ? elecFull / count : elecFull;
      let elecNote = "No electricity billed";
      if (usedKwh > 0) {
        elecNote = kwh(usedKwh) + " × " + money(billedRate) +
          (count > 1 ? " ÷ " + count + " renters" : "");
      }
      let record = null;
      if (room) {
        record = rows.find(function (rec) {
          return rec.renter_id === renter.id;
        });
      }
      var showMoveInFees = isFirstBillingMonth(renter, year, month) &&
        (num(renter.deposit) > 0 || num(renter.advance_rent) > 0 || renterIsNew(renter));
      var depositShare = showMoveInFees ? num(renter.deposit) : 0;
      var advanceShare = showMoveInFees ? num(renter.advance_rent) : 0;
      return {
        renter: renter,
        room: room,
        year: year,
        month: month,
        rentShare: rentShare,
        rentNote: rentNote,
        proratedInfo: proratedInfo,
        elecShare: elecShare,
        elecNote: elecNote,
        usedKwh: usedKwh,
        internetShare: internetShare,
        depositShare: depositShare,
        advanceShare: advanceShare,
        showMoveInFees: showMoveInFees,
        total: rentShare + elecShare + internetShare + depositShare + advanceShare,
        paid: record ? !!record.paid : false,
        paidDate: record && record.paid_date ? String(record.paid_date).slice(0, 10) : null,
        dueDate: room ? dueDateObj(room, year, month) : null,
      };
    });
  }

  function receiptInnerHTML(m) {
    const receiptNo = formatReceiptNo(m.renter.id, m.year, m.month);
    const period = MONTH_NAMES[m.month - 1] + " " + m.year;
    const contact = m.renter.contact_number ? escapeHtml(m.renter.contact_number) : "";
    const address = m.renter.address ? escapeHtml(m.renter.address) : "";
    const roomName = m.room ? escapeHtml(m.room.name || "(Unnamed room)") : "No room assigned";

    let statusLine = "";
    if (m.paid) {
      statusLine = m.paidDate ? "Paid on " + formatDate(new Date(m.paidDate + "T00:00:00")) : "Payment received";
    } else {
      statusLine = m.dueDate ? "Due on " + formatDate(m.dueDate) : "Awaiting payment";
    }

    return '' +
      '<div class="receipt-head">' +
        '<div class="receipt-meta">' +
          '<div class="receipt-title">Receipt</div>' +
          '<div class="receipt-no">' + receiptNo + '</div>' +
          '<div class="receipt-issued">Issued ' + formatDate(new Date()) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="receipt-parties">' +
        '<div class="receipt-party">' +
          '<span class="receipt-label">Billed to</span>' +
          '<span class="receipt-strong">' + (escapeHtml(fullName(m.renter)) || "(Unnamed renter)") + '</span>' +
          (contact ? '<span class="receipt-muted">' + contact + '</span>' : '') +
          (address ? '<span class="receipt-muted">' + address + '</span>' : '') +
        '</div>' +
        '<div class="receipt-party receipt-party-right">' +
          '<span class="receipt-label">Room</span>' +
          '<span class="receipt-strong">' + roomName + '</span>' +
          '<span class="receipt-muted">Billing period: ' + period + '</span>' +
        '</div>' +
      '</div>' +
      '<table class="receipt-table">' +
        '<thead><tr><th>Description</th><th>Details</th><th class="ta-right">Amount</th></tr></thead>' +
        '<tbody>' +
          '<tr>' +
            '<td>Room rent' + (m.proratedInfo ? ' <span class="receipt-prorated-badge">Prorated</span>' : '') + '</td>' +
            '<td class="receipt-note">' + escapeHtml(m.rentNote) + '</td>' +
            '<td class="ta-right">' + money(m.rentShare) + '</td>' +
          '</tr>' +
          '<tr><td>Electricity</td><td class="receipt-note">' + escapeHtml(m.elecNote) + '</td><td class="ta-right">' + money(m.elecShare) + '</td></tr>' +
          '<tr><td>Internet</td><td class="receipt-note">Monthly charge per renter</td><td class="ta-right">' + money(m.internetShare) + '</td></tr>' +
          (m.showMoveInFees && m.depositShare > 0
            ? '<tr><td>Security deposit</td><td class="receipt-note">One-time move-in deposit</td><td class="ta-right">' + money(m.depositShare) + '</td></tr>'
            : '') +
          (m.showMoveInFees && m.advanceShare > 0
            ? '<tr><td>Advance rent</td><td class="receipt-note">1 month advance (move-in)</td><td class="ta-right">' + money(m.advanceShare) + '</td></tr>'
            : '') +
        '</tbody>' +
        '<tfoot><tr><td colspan="2" class="ta-right receipt-total-label">Total due</td><td class="ta-right receipt-total">' + money(m.total) + '</td></tr></tfoot>' +
      '</table>' +
      '<div class="receipt-status">' +
        '<span class="receipt-stamp ' + (m.paid ? 'paid' : 'unpaid') + '">' + (m.paid ? 'PAID' : 'UNPAID') + '</span>' +
        '<span class="receipt-status-note">' + statusLine + '</span>' +
      '</div>' +
      '<div class="receipt-foot">' +
        '<div class="receipt-sign"><span class="receipt-sign-line"></span><span class="receipt-sign-label">Received by</span></div>' +
        '<div class="receipt-thanks">Thank you for your payment!</div>' +
      '</div>' +
      '<div class="receipt-fineprint">Electricity uses the saved meter snapshot for this billing month when available. All bills are due on the 15th.</div>';
  }

  function renderReceiptPreview() {
    getReceiptModel().then(function (m) {
      if (!m) { el.receiptPreview.innerHTML = ""; return; }
      el.receiptPreview.innerHTML = receiptInnerHTML(m);
    }).catch(saveFailed);
  }

  function printReceipt() {
    getReceiptModel().then(function (m) {
      if (!m) return;
      const inner = receiptInnerHTML(m);
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(
        '<!DOCTYPE html><html><head><meta charset="utf-8" />' +
        '<title>Receipt</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />' +
        '<style>' + RECEIPT_PRINT_CSS + '</style></head>' +
        '<body><div class="receipt">' + inner + '</div></body></html>'
      );
      doc.close();
      const done = function () {
        try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { /* ignore */ }
        setTimeout(function () { document.body.removeChild(iframe); }, 1500);
      };
      // Give fonts a brief moment to load for a clean print.
      setTimeout(done, 400);
    }).catch(saveFailed);
  }

  /* ---------------- Summary ---------------- */
  function renderSummary() {
    const rate = num(state.settings.rate);
    const cost = num(state.settings.cost);
    const internetRate = num(state.settings.internet_rate);
    const year = currentPeriod.year;
    const month = currentPeriod.month;
    const renters = assignedRenters();

    let grossRent = 0;
    let grossPower = 0;
    renters.forEach(function (renter) {
      const amounts = calcRenterPaymentAmounts(renter, year, month);
      if (!amounts) return;
      grossRent += amounts.rent;
      grossPower += amounts.elec;
    });

    const totalKwh = occupiedRoomsKwh(year, month);

    let rentExpenses = 0;
    activeExpensesForPeriod(year, month).forEach(function (e) {
      rentExpenses += num(e.amount);
    });

    const powerCost = totalKwh * cost;
    const grossInternet = renters.length * internetRate;

    const netRent = grossRent - rentExpenses;
    const netPower = grossPower - powerCost;

    const grossTotal = grossRent + grossPower + grossInternet;
    const netTotal = netRent + netPower + grossInternet;

    el.sumGrossRent.textContent = money(grossRent);
    el.sumRentExpenses.textContent = money(rentExpenses);
    el.sumNetRent.textContent = money(netRent);

    el.sumGrossPower.textContent = money(grossPower);
    el.sumPowerCost.textContent = money(powerCost);
    el.sumNetPower.textContent = money(netPower);
    el.sumKwh.textContent = kwh(totalKwh);
    el.sumHousehold.textContent = kwh(Math.max(0, houseMeterKwh(year, month) - totalKwh));
    el.sumGrossInternet.textContent = money(grossInternet);
    el.sumInternetRate.textContent = money(internetRate);
    el.sumInternetPeople.textContent = String(renters.length);

    el.sumGrossTotal.textContent = money(grossTotal);
    el.sumNetTotal.textContent = money(netTotal);

    if (el.dashPeriodLabel) {
      const period = MONTH_NAMES[month - 1] + " " + year;
      if (!renters.length) {
        el.dashPeriodLabel.textContent = period + " — income shows only for rooms with assigned renters";
      } else {
        const vacant = state.rooms.length - roomsWithRenters().length;
        el.dashPeriodLabel.textContent = period + " — expected from " + renters.length +
          " assigned renter" + (renters.length === 1 ? "" : "s") +
          (vacant > 0 ? " (" + vacant + " vacant room" + (vacant === 1 ? "" : "s") + " excluded)" : "");
      }
    }
  }

  /* ---------------- Section-specific save ---------------- */
  function runSave(scope, label, tasks, afterFn) {
    savingSections[scope] = true;
    updateSaveUI(scope);
    showStatus("saving", "Saving " + label + "…");
    return Promise.all(tasks).then(function () {
      clearDirty(scope);
      showStatus("saving", label + " saved", 2500);
      toast("success", label + " saved.");
      if (afterFn) return afterFn();
    }).catch(saveFailed).finally(function () {
      savingSections[scope] = false;
      updateSaveUI(scope);
    });
  }

  function saveRooms() {
    const tasks = [];
    state.rooms.forEach(function (r) { tasks.push(api("PUT", "/api/rooms/" + r.id, r)); });
    return runSave("rooms", "Rooms", tasks, function () {
      return refreshCurrentMonthWidget();
    });
  }

  function saveRenters() {
    const validationErrors = validateAllRenters();
    if (validationErrors.length) {
      toast("error", validationErrors[0] + (validationErrors.length > 1 ? " (+" + (validationErrors.length - 1) + " more)" : ""));
      return Promise.reject(new Error("Validation failed"));
    }
    const tasks = [];
    state.renters.forEach(function (r) { tasks.push(api("PUT", "/api/renters/" + r.id, r)); });
    return runSave("renters", "Renter profiles", tasks, function () {
      refreshRoomChips();
      return refreshCurrentMonthWidget();
    });
  }

  function saveExpenses() {
    const tasks = [];
    state.expenses.forEach(function (e) { tasks.push(api("PUT", "/api/expenses/" + e.id, e)); });
    return runSave("expenses", "Expenses", tasks, function () {
      renderSummary();
    });
  }

  function saveSettings() {
    return runSave("settings", "Settings", [api("PUT", "/api/settings", state.settings)], function () {
      recalcRooms();
      renderSummary();
    });
  }

  document.querySelectorAll("[data-save-btn]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var scope = btn.getAttribute("data-save-btn");
      if (scope === "rooms") saveRooms();
      else if (scope === "renters") saveRenters();
      else if (scope === "expenses") saveExpenses();
      else if (scope === "settings") saveSettings();
    });
  });

  updateSaveUI();

  /* ---------------- Reset / print ---------------- */
  document.getElementById("resetBtn").addEventListener("click", function () {
    if (!confirm("This will erase all rooms, renters, readings, payments, expenses, and settings from the database. Are you sure?")) return;
    api("POST", "/api/reset").then(function () {
      viewPeriod = { year: currentPeriod.year, month: currentPeriod.month };
      pendingPayments = {};
      Object.keys(dirtySections).forEach(function (k) { dirtySections[k] = false; });
      updateSaveUI();
      return loadState();
    }).catch(saveFailed);
  });

  /* ---------------- Init ---------------- */
  function renderAll() {
    renderSettings();
    renderRooms();
    renderRenters();
    renderExpenses();
    renderSummary();
    renderWorkflowGuide();
  }

  function loadRoomHistory() {
    return api("GET", "/api/room-billing-history").then(function (rows) {
      state.roomHistory = rows || [];
    }).catch(function () { state.roomHistory = []; });
  }

  function loadState() {
    connStatus.textContent = "Loading…";
    connStatus.className = "conn-status";
    return Promise.all([
      api("GET", "/api/state"),
      api("GET", "/api/room-billing-history"),
    ]).then(function (results) {
      const data = results[0];
      state.settings   = data.settings;
      state.rooms      = data.rooms;
      state.renters    = (data.renters || []).map(function (r) {
        if (!r.is_new_renter && (r.deposit != null || r.advance_rent != null)) {
          r.is_new_renter = true;
        }
        return r;
      });
      state.expenses   = data.expenses;
      state.roomHistory = results[1] || [];
      renderAll();
      connStatus.textContent = "Connected";
      connStatus.className = "conn-status ok";
      statusBanner.className = "status-banner";
      Object.keys(dirtySections).forEach(function (k) { dirtySections[k] = false; });
      updateSaveUI();
      return Promise.all([loadPaymentsView(), refreshCurrentMonthWidget(), loadMeterHistory()]);
    }).catch(function (err) {
      connStatus.textContent = "Offline";
      connStatus.className = "conn-status err";
      showStatus("error", "Can't reach the database (" + err.message + "). Make sure the server is running and your .env file has the right connection details — see README.md.");
    });
  }

  loadState();

  /* ================================================================
     FINANCIAL SYSTEM
  ================================================================ */

  var finState = {
    categories: [],
    transactions: [],
    summary: null,
  };

  var finViewPeriod = { year: currentPeriod.year, month: currentPeriod.month };
  var finInitialized = false;
  var finEditingTxId = null;
  var finEditingCatId = null;

  /* ---- Helpers ---- */
  function finMoney(v) {
    var n = parseFloat(v) || 0;
    return "₱" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function finMonthLabel() {
    return MONTH_NAMES[finViewPeriod.month - 1] + " " + finViewPeriod.year;
  }

  /* ---- Financial tab switching ---- */
  var finTabBtns = document.querySelectorAll(".fin-tab-btn");
  var finPanels  = document.querySelectorAll(".fin-panel");

  function activateFinTab(name) {
    finTabBtns.forEach(function (b) { b.classList.toggle("active", b.dataset.finTab === name); });
    finPanels.forEach(function (p) { p.classList.toggle("active", p.dataset.finPanel === name); });
    if (name === "fin-dashboard") loadFinSummary();
    if (name === "fin-transactions") loadFinTransactions();
    if (name === "fin-categories") renderFinCategories();
  }

  finTabBtns.forEach(function (b) {
    b.addEventListener("click", function () { activateFinTab(this.dataset.finTab); });
  });

  /* ---- Period navigation ---- */
  document.getElementById("finPrevMonthBtn").addEventListener("click", function () {
    finViewPeriod.month -= 1;
    if (finViewPeriod.month < 1) { finViewPeriod.month = 12; finViewPeriod.year -= 1; }
    document.getElementById("finPeriodLabel").textContent = finMonthLabel();
    loadFinSummary();
  });
  document.getElementById("finNextMonthBtn").addEventListener("click", function () {
    finViewPeriod.month += 1;
    if (finViewPeriod.month > 12) { finViewPeriod.month = 1; finViewPeriod.year += 1; }
    document.getElementById("finPeriodLabel").textContent = finMonthLabel();
    loadFinSummary();
  });

  /* ---- Build filter dropdowns ---- */
  function buildFinFilterDropdowns() {
    var filterMonth = document.getElementById("finFilterMonth");
    var filterYear  = document.getElementById("finFilterYear");
    filterMonth.innerHTML = "<option value=''>All months</option>";
    MONTH_NAMES.forEach(function (name, i) {
      var opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = name;
      filterMonth.appendChild(opt);
    });
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y >= thisYear - 5; y--) {
      var opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      filterYear.appendChild(opt);
    }
    filterMonth.value = String(finViewPeriod.month);
    filterYear.value  = String(finViewPeriod.year);

    filterMonth.addEventListener("change", loadFinTransactions);
    filterYear.addEventListener("change", loadFinTransactions);
    document.getElementById("finFilterType").addEventListener("change", loadFinTransactions);

    // Text search — filter client-side on existing results
    var finSearchInput = document.getElementById("finSearchInput");
    if (finSearchInput) {
      finSearchInput.addEventListener("input", function () { renderFinTransactions(); });
    }
  }

  /* ---- Category helpers ---- */
  function populateFinCategorySelect(selectEl, selectedId) {
    var current = selectEl.value;
    selectEl.innerHTML = "<option value=''>— No category —</option>";
    finState.categories.forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = String(cat.id);
      opt.textContent = cat.name;
      selectEl.appendChild(opt);
    });
    if (selectedId) selectEl.value = String(selectedId);
    else if (current) selectEl.value = current;
  }

  /* ---- Load financial categories ---- */
  function loadFinCategories() {
    return api("GET", "/api/financial-categories").then(function (cats) {
      finState.categories = cats;
      populateFinCategorySelect(document.getElementById("finFormCategory"), null);
      renderFinCategories();
    });
  }

  /* ---- Load financial summary ---- */
  function loadFinSummary() {
    document.getElementById("finPeriodLabel").textContent = finMonthLabel();
    document.getElementById("finCategoryPeriodHint").textContent = "Breakdown for " + finMonthLabel();
    return api("GET", "/api/financial-summary?year=" + finViewPeriod.year + "&month=" + finViewPeriod.month)
      .then(function (data) {
        finState.summary = data;
        renderFinDashboard();
      }).catch(function () {});
  }

  /* ---- Load financial transactions ---- */
  function loadFinTransactions() {
    var month = document.getElementById("finFilterMonth").value;
    var year  = document.getElementById("finFilterYear").value;
    var type  = document.getElementById("finFilterType").value;
    var url   = "/api/financial-expenses";
    var params = [];
    if (month) params.push("month=" + month);
    if (year)  params.push("year=" + year);
    if (type)  params.push("type=" + type);
    if (params.length) url += "?" + params.join("&");
    return api("GET", url).then(function (rows) {
      finState.transactions = rows;
      renderFinTransactions();
    }).catch(function () {});
  }

  /* ---- Render financial dashboard ---- */
  function renderFinDashboard() {
    var s = finState.summary;
    if (!s) return;
    document.getElementById("finMonthIncome").textContent = finMoney(s.month.income);
    document.getElementById("finMonthExpenses").textContent = finMoney(s.month.expenses);
    var net = s.month.net;
    var netEl = document.getElementById("finMonthNet");
    netEl.textContent = finMoney(net);
    netEl.className = "stat-value " + (net >= 0 ? "income-value" : "expense-value");

    document.getElementById("finYearIncome").textContent = finMoney(s.year.income);
    document.getElementById("finYearExpenses").textContent = finMoney(s.year.expenses);
    document.getElementById("finYearNet").textContent = finMoney(s.year.net);

    var breakdownEl = document.getElementById("finCategoryBreakdown");
    var emptyEl = document.getElementById("finCategoryEmpty");
    var cats = (s.byCategory || []).filter(function (c) { return c.total > 0; });
    if (!cats.length) {
      breakdownEl.style.display = "none";
      emptyEl.innerHTML =
        '<div class="fin-empty-state">' +
        '<div class="fin-empty-icon">💡</div>' +
        '<div class="fin-empty-title">No expenses recorded for ' + finMonthLabel() + '</div>' +
        '<div class="fin-empty-sub">Go to the Transactions tab to start adding entries.</div>' +
        '</div>';
      emptyEl.style.display = "";
    } else {
      breakdownEl.style.display = "";
      emptyEl.style.display = "none";
      breakdownEl.innerHTML = "";
      var maxVal = Math.max.apply(null, cats.map(function (c) { return c.total; }));
      cats.forEach(function (cat) {
        var row = document.createElement("div");
        row.className = "fin-cat-bar-row";
        var pct = maxVal > 0 ? (cat.total / maxVal) * 100 : 0;
        row.innerHTML =
          '<div class="fin-cat-bar-label"><span class="fin-cat-swatch" style="background:' + cat.color + '"></span>' + escHtml(cat.name) + '</div>' +
          '<div class="fin-cat-bar-track"><div class="fin-cat-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + cat.color + '"></div></div>' +
          '<div class="fin-cat-bar-amount">' + finMoney(cat.total) + '</div>';
        breakdownEl.appendChild(row);
      });
    }
  }

  /* ---- Render transactions ---- */
  function renderFinTransactions() {
    var listEl  = document.getElementById("finTransactionList");
    var emptyEl = document.getElementById("finTransactionEmpty");
    listEl.innerHTML = "";

    // Apply client-side text search filter
    var searchQ = (document.getElementById("finSearchInput").value || "").toLowerCase().trim();
    var txList = finState.transactions;
    if (searchQ) {
      txList = txList.filter(function (tx) {
        return (tx.name || "").toLowerCase().includes(searchQ) ||
               (tx.notes || "").toLowerCase().includes(searchQ) ||
               (tx.category_name || "").toLowerCase().includes(searchQ);
      });
    }

    if (!txList.length) {
      emptyEl.innerHTML =
        '<div class="fin-empty-state">' +
        '<div class="fin-empty-icon">📋</div>' +
        '<div class="fin-empty-title">No transactions found</div>' +
        '<div class="fin-empty-sub">' + (searchQ ? 'No results for "' + escHtml(searchQ) + '". Try a different keyword or clear the search.' : "Add your first expense or income using the form above, or try adjusting the filters.") + '</div>' +
        '</div>';
      emptyEl.style.display = "";
      return;
    }
    emptyEl.style.display = "none";
    txList.forEach(function (tx) {
      var row = document.createElement("div");
      row.className = "fin-transaction-row";

      var isIncome = tx.type === "income";
      var icon = isIncome ? "↑" : "↓";
      var iconClass = isIncome ? "income-icon" : "expense-icon";
      var amountClass = isIncome ? "income" : "expense";
      var amountSign = isIncome ? "+" : "-";

      var catBadge = "";
      if (tx.category_name) {
        catBadge = '<span class="fin-tx-cat" style="background:' + (tx.category_color || "#6b7280") + '">' +
          escHtml(tx.category_name) + '</span>';
      }

      var date = tx.expense_date ? new Date(tx.expense_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

      row.innerHTML =
        '<div class="fin-tx-icon ' + iconClass + '">' + icon + '</div>' +
        '<div class="fin-tx-info">' +
          '<div class="fin-tx-name">' + escHtml(tx.name) + '</div>' +
          '<div class="fin-tx-meta">' + date + ' · ' + escHtml(tx.payment_method || "cash") + (catBadge ? ' · ' + catBadge : '') + (tx.notes ? ' · <em>' + escHtml(tx.notes) + '</em>' : '') + '</div>' +
        '</div>' +
        '<div class="fin-tx-amount ' + amountClass + '">' + amountSign + finMoney(tx.amount) + '</div>' +
        '<div class="fin-tx-actions">' +
          '<button class="icon-btn fin-edit-tx" data-id="' + tx.id + '" type="button" title="Edit">✎</button>' +
          '<button class="icon-btn fin-del-tx" data-id="' + tx.id + '" type="button" title="Delete">×</button>' +
        '</div>';

      row.querySelector(".fin-edit-tx").addEventListener("click", function () {
        finStartEditTx(tx);
      });
      row.querySelector(".fin-del-tx").addEventListener("click", function () {
        if (!confirm("Delete \"" + tx.name + "\"? This cannot be undone.")) return;
        api("DELETE", "/api/financial-expenses/" + tx.id).then(function () {
          toast("success", "Transaction deleted", "\"" + tx.name + "\" has been removed.");
          loadFinTransactions();
          loadFinSummary();
        }).catch(function (err) { toast("error", "Delete failed", err.message); });
      });

      listEl.appendChild(row);
    });
  }

  /* ---- Render categories ---- */
  function renderFinCategories() {
    var listEl  = document.getElementById("finCategoryList");
    var emptyEl = document.getElementById("finCategoryEmpty");
    listEl.innerHTML = "";
    if (!finState.categories.length) {
      emptyEl.innerHTML =
        '<div class="fin-empty-state">' +
        '<div class="fin-empty-icon">🏷️</div>' +
        '<div class="fin-empty-title">No categories yet</div>' +
        '<div class="fin-empty-sub">Add a category above to organize your expenses and income.</div>' +
        '</div>';
      emptyEl.style.display = "";
      return;
    }
    emptyEl.style.display = "none";
    finState.categories.forEach(function (cat) {
      var row = document.createElement("div");
      row.className = "fin-cat-row";
      row.innerHTML =
        '<span class="fin-cat-swatch" style="background:' + cat.color + '"></span>' +
        '<span class="fin-cat-name">' + escHtml(cat.name) + '</span>' +
        '<div class="fin-cat-actions">' +
          '<button class="icon-btn fin-edit-cat" data-id="' + cat.id + '" type="button" title="Edit">✎</button>' +
          '<button class="icon-btn fin-del-cat" data-id="' + cat.id + '" type="button" title="Delete">×</button>' +
        '</div>';

      row.querySelector(".fin-edit-cat").addEventListener("click", function () {
        finStartEditCat(cat);
      });
      row.querySelector(".fin-del-cat").addEventListener("click", function () {
        if (!confirm("Delete category \"" + cat.name + "\"?\nTransactions using it will become uncategorized.")) return;
        api("DELETE", "/api/financial-categories/" + cat.id).then(function () {
          toast("success", "Category deleted", "Transactions have been uncategorized.");
          loadFinCategories().then(function () { loadFinSummary(); loadFinTransactions(); });
        }).catch(function (err) { toast("error", "Delete failed", err.message); });
      });

      listEl.appendChild(row);
    });
  }

  /* ---- Transaction form ---- */
  function finResetTxForm() {
    finEditingTxId = null;
    document.getElementById("finFormName").value = "";
    document.getElementById("finFormAmount").value = "";
    document.getElementById("finFormDate").value = new Date().toISOString().slice(0, 10);
    document.getElementById("finFormType").value = "expense";
    document.getElementById("finFormPayment").value = "cash";
    document.getElementById("finFormNotes").value = "";
    populateFinCategorySelect(document.getElementById("finFormCategory"), null);
    document.getElementById("finFormSubmit").textContent = "Add Transaction";
    document.getElementById("finFormCancel").style.display = "none";
  }

  function finStartEditTx(tx) {
    finEditingTxId = tx.id;
    document.getElementById("finFormName").value = tx.name || "";
    document.getElementById("finFormAmount").value = tx.amount || "";
    document.getElementById("finFormDate").value = tx.expense_date ? String(tx.expense_date).slice(0, 10) : "";
    document.getElementById("finFormType").value = tx.type || "expense";
    document.getElementById("finFormPayment").value = tx.payment_method || "cash";
    document.getElementById("finFormNotes").value = tx.notes || "";
    populateFinCategorySelect(document.getElementById("finFormCategory"), tx.category_id);
    document.getElementById("finFormSubmit").textContent = "Save Changes";
    document.getElementById("finFormCancel").style.display = "";
    document.getElementById("finFormName").focus();
    document.getElementById("finTransactionForm").scrollIntoView({ behavior: "smooth" });
  }

  document.getElementById("finFormSubmit").addEventListener("click", function () {
    var nameEl   = document.getElementById("finFormName");
    var amountEl = document.getElementById("finFormAmount");
    var name     = nameEl.value.trim();
    var amount   = parseFloat(amountEl.value);
    var valid    = true;

    // Inline validation
    nameEl.closest(".field") && nameEl.closest(".field").classList.remove("field-error");
    amountEl.closest(".field") && amountEl.closest(".field").classList.remove("field-error");
    document.querySelectorAll(".field-error-msg").forEach(function (m) { m.remove(); });

    if (!name) {
      valid = false;
      var f = nameEl.closest(".field");
      if (f) { f.classList.add("field-error"); var m = document.createElement("p"); m.className = "field-error-msg"; m.textContent = "Description is required."; f.appendChild(m); }
      nameEl.focus();
    }
    if (!amount || amount <= 0) {
      valid = false;
      var f2 = amountEl.closest(".field");
      if (f2) { f2.classList.add("field-error"); var m2 = document.createElement("p"); m2.className = "field-error-msg"; m2.textContent = "Enter a valid amount greater than 0."; f2.appendChild(m2); }
      if (name) amountEl.focus();
    }
    if (!valid) { toast("warning", "Missing required fields", "Please fill in all required fields before saving."); return; }

    var body = {
      name: name,
      amount: amount,
      type: document.getElementById("finFormType").value,
      category_id: document.getElementById("finFormCategory").value || null,
      expense_date: document.getElementById("finFormDate").value || null,
      payment_method: document.getElementById("finFormPayment").value,
      notes: document.getElementById("finFormNotes").value.trim(),
    };

    var isEdit = !!finEditingTxId;
    var method = isEdit ? "PUT" : "POST";
    var url = isEdit ? "/api/financial-expenses/" + finEditingTxId : "/api/financial-expenses";

    api(method, url, body).then(function () {
      document.querySelectorAll(".field-error-msg").forEach(function (m) { m.remove(); });
      document.querySelectorAll("#finTransactionForm .field-error").forEach(function (f) { f.classList.remove("field-error"); });
      toast("success", isEdit ? "Transaction updated" : "Transaction added", name + " — " + finMoney(amount));
      finResetTxForm();
      loadFinTransactions();
      loadFinSummary();
    }).catch(function (err) { toast("error", "Failed to save transaction", err.message); });
  });

  document.getElementById("finFormCancel").addEventListener("click", finResetTxForm);

  /* ---- Category form ---- */
  function finResetCatForm() {
    finEditingCatId = null;
    document.getElementById("finCatName").value = "";
    document.getElementById("finCatColor").value = "#6366f1";
    document.getElementById("finCatSubmit").textContent = "Add Category";
    document.getElementById("finCatCancel").style.display = "none";
  }

  function finStartEditCat(cat) {
    finEditingCatId = cat.id;
    document.getElementById("finCatName").value = cat.name || "";
    document.getElementById("finCatColor").value = cat.color || "#6366f1";
    document.getElementById("finCatSubmit").textContent = "Save Category";
    document.getElementById("finCatCancel").style.display = "";
    document.getElementById("finCatName").focus();
    activateFinTab("fin-categories");
  }

  document.getElementById("finCatSubmit").addEventListener("click", function () {
    var nameEl = document.getElementById("finCatName");
    var name   = nameEl.value.trim();
    if (!name) {
      toast("warning", "Category name required", "Please enter a name for the category.");
      nameEl.focus();
      return;
    }
    var isEdit = !!finEditingCatId;
    var body   = { name: name, color: document.getElementById("finCatColor").value };
    var method = isEdit ? "PUT" : "POST";
    var url    = isEdit ? "/api/financial-categories/" + finEditingCatId : "/api/financial-categories";
    api(method, url, body).then(function () {
      toast("success", isEdit ? "Category updated" : "Category added", "\"" + name + "\" has been saved.");
      finResetCatForm();
      loadFinCategories().then(function () { loadFinSummary(); });
    }).catch(function (err) { toast("error", "Failed to save category", err.message); });
  });

  document.getElementById("finCatCancel").addEventListener("click", finResetCatForm);

  /* ---- HTML escape helper ---- */
  function escHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---- Initialize financial system (called once when first opened) ---- */
  function finInit() {
    if (finInitialized) {
      loadFinSummary();
      return;
    }
    finInitialized = true;
    document.getElementById("finPeriodLabel").textContent = finMonthLabel();
    document.getElementById("finFormDate").value = new Date().toISOString().slice(0, 10);
    buildFinFilterDropdowns();
    loadFinCategories().then(function () {
      loadFinSummary();
      loadFinTransactions();
    });
  }

})();
