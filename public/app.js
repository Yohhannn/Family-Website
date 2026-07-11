(function () {
  "use strict";

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  let state = {
    settings: { rate: 15, cost: 0, internet_rate: 250, currency: "₱" },
    rooms: [],
    renters: [],
    houseMeter: { prev_reading: null, curr_reading: null },
    expenses: [],
    paymentsView: [],
    paymentsCurrent: [],
  };

  const now = new Date();
  const currentPeriod = { year: now.getFullYear(), month: now.getMonth() + 1 };
  let viewPeriod = { year: now.getFullYear(), month: now.getMonth() + 1 };

  // Nothing below saves to the database until the Save button is pressed.
  // `dirty` tracks whether there's anything unsaved; `pendingPayments` holds
  // not-yet-saved paid/unpaid toggles, keyed by room+renter+period.
  let dirty = false;
  let pendingPayments = {};

  /* ---------------- API ---------------- */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method: method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = "Something went wrong saving to the database.";
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /* ---------------- Status banner + dirty indicator ---------------- */
  const statusBanner = document.getElementById("statusBanner");
  const connStatus = document.getElementById("connStatus");
  const dirtyIndicator = document.getElementById("dirtyIndicator");
  const saveButtons = Array.prototype.slice.call(document.querySelectorAll(".js-save-btn"));
  const saveStatusEls = Array.prototype.slice.call(document.querySelectorAll("[data-save-status]"));
  let saving = false;
  let hideTimer = null;

  function setSaveDisabled(disabled) {
    saveButtons.forEach(function (b) { b.disabled = disabled; });
  }
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
  function saveFailed(err) {
    showStatus("error", err.message, 6000);
  }

  function markDirty() {
    dirty = true;
    updateDirtyIndicator();
  }
  function updateDirtyIndicator() {
    dirtyIndicator.textContent = dirty ? "Unsaved changes" : "All changes saved";
    dirtyIndicator.className = "dirty-indicator " + (dirty ? "dirty" : "clean");
    saveStatusEls.forEach(function (s) {
      s.textContent = saving ? "Saving…" : (dirty ? "You have unsaved changes" : "All changes saved");
      s.className = "tab-actions-status " + (dirty ? "dirty" : "clean");
    });
    if (!saving) setSaveDisabled(!dirty);
  }

  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

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

  function roomKwh(room) {
    return Math.max(0, num(room.curr_reading) - num(room.prev_reading));
  }

  function roomRenters(roomId) {
    return state.renters.filter(function (r) { return r.room_id === roomId; });
  }

  function effectiveRent(room) {
    return room.rent_type === "per_person"
      ? num(room.rate_per_person) * roomRenters(room.id).length
      : num(room.flat_rent);
  }

  function roomInternet(room) {
    return roomRenters(room.id).length * num(state.settings.internet_rate);
  }

  function houseMeterKwh() {
    return Math.max(0, num(state.houseMeter.curr_reading) - num(state.houseMeter.prev_reading));
  }

  function totalRoomsKwh() {
    let total = 0;
    state.rooms.forEach(function (r) { total += roomKwh(r); });
    return total;
  }

  function fullName(r) {
    return [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ");
  }

  function durationSince(dateStr) {
    if (!dateStr) return "—";
    const start = new Date(dateStr + "T00:00:00");
    if (isNaN(start.getTime())) return "—";
    const today = new Date();
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
    return new Date(year, month - 1, 15);
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function todayISO() {
    const d = new Date();
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
      const rentShare = room.rent_type === "per_person"
        ? num(room.rate_per_person)
        : (renters.length ? num(room.flat_rent) / renters.length : 0);
      renters.forEach(function (renter) {
        const internet = num(state.settings.internet_rate);
        targets.push({
          room: room,
          renter: renter,
          rent_amount: rentShare,
          electricity_amount: electricityShare,
          internet_amount: internet,
          amount: rentShare + electricityShare + internet,
        });
      });
    });
    return targets;
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
    if (name === "history") {
      loadHistory();
      loadMeterHistory();
    }
    if (name === "dashboard") renderDashboardWidget();
    if (name === "receipts") openReceiptsTab();
  }
  tabButtons.forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.dataset.tab); });
  });
  document.querySelectorAll("[data-goto-tab]").forEach(function (b) {
    b.addEventListener("click", function () { activateTab(b.dataset.gotoTab); });
  });

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
    houseMeterPrev: document.getElementById("houseMeterPrev"),
    houseMeterCurr: document.getElementById("houseMeterCurr"),
    houseKwh: document.getElementById("houseKwh"),
    roomsKwh: document.getElementById("roomsKwh"),
    householdKwh: document.getElementById("householdKwh"),
    prevMonthBtn: document.getElementById("prevMonthBtn"),
    nextMonthBtn: document.getElementById("nextMonthBtn"),
    periodLabel: document.getElementById("periodLabel"),
    paymentsList: document.getElementById("paymentsList"),
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
    receiptRenter: document.getElementById("receiptRenter"),
    receiptMonth: document.getElementById("receiptMonth"),
    receiptYear: document.getElementById("receiptYear"),
    receiptPreview: document.getElementById("receiptPreview"),
    receiptEmpty: document.getElementById("receiptEmpty"),
    printReceiptBtn: document.getElementById("printReceiptBtn"),
    meterPeriodMonth: document.getElementById("meterPeriodMonth"),
    meterPeriodYear: document.getElementById("meterPeriodYear"),
    rolloverMeterBtn: document.getElementById("rolloverMeterBtn"),
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
    markDirty();
  });
  el.setCost.addEventListener("input", function () {
    state.settings.cost = num(this.value);
    renderSummary();
    markDirty();
  });
  el.setInternetRate.addEventListener("input", function () {
    state.settings.internet_rate = num(this.value);
    recalcRooms();
    renderSummary();
    renderPaymentsTab();
    markDirty();
  });
  el.setCurrency.addEventListener("input", function () {
    state.settings.currency = this.value || "₱";
    recalcRooms();
    renderSummary();
    markDirty();
  });

  /* ---------------- House meter ---------------- */
  function renderHouseMeter() {
    el.houseMeterPrev.value = state.houseMeter.prev_reading == null ? "" : state.houseMeter.prev_reading;
    el.houseMeterCurr.value = state.houseMeter.curr_reading == null ? "" : state.houseMeter.curr_reading;
    updateHouseMeterResults();
  }

  function updateHouseMeterResults() {
    const house = houseMeterKwh();
    const rooms = totalRoomsKwh();
    const household = Math.max(0, house - rooms);
    el.houseKwh.textContent = kwh(house);
    el.roomsKwh.textContent = kwh(rooms);
    el.householdKwh.textContent = kwh(household);
  }

  el.houseMeterPrev.addEventListener("input", function () {
    state.houseMeter.prev_reading = this.value === "" ? null : num(this.value);
    updateHouseMeterResults();
    renderSummary();
    markDirty();
  });
  el.houseMeterCurr.addEventListener("input", function () {
    state.houseMeter.curr_reading = this.value === "" ? null : num(this.value);
    updateHouseMeterResults();
    renderSummary();
    markDirty();
  });

  MONTH_NAMES.forEach(function (name, i) {
    const opt = document.createElement("option");
    opt.value = String(i + 1);
    opt.textContent = name;
    el.meterPeriodMonth.appendChild(opt);
  });
  el.meterPeriodMonth.value = String(currentPeriod.month);
  el.meterPeriodYear.value = String(currentPeriod.year);

  el.rolloverMeterBtn.addEventListener("click", function () {
    const year = num(el.meterPeriodYear.value);
    const month = num(el.meterPeriodMonth.value);
    const period = MONTH_NAMES[month - 1] + " " + year;
    const hasCurrent = state.rooms.some(function (r) { return r.curr_reading != null; }) ||
      state.houseMeter.curr_reading != null;
    if (!hasCurrent) {
      showStatus("error", "Enter at least one current meter reading before finishing the period.", 5000);
      return;
    }
    if (!confirm(
      "Finish " + period + "? Current readings will be saved to history and become the previous readings for the next period."
    )) return;

    el.rolloverMeterBtn.disabled = true;
    saveAll().then(function () {
      if (dirty) throw new Error("Save the current changes before starting the next period.");
      return api("POST", "/api/meter-rollover", { year: year, month: month });
    }).then(function () {
      showStatus("saving", period + " saved. The next meter period is ready.", 4000);
      return loadState();
    }).then(loadMeterHistory).catch(saveFailed).finally(function () {
      el.rolloverMeterBtn.disabled = false;
    });
  });

  /* ---------------- Rooms ---------------- */
  function renderRooms() {
    el.tenantList.innerHTML = "";
    state.rooms.forEach(function (r) {
      el.tenantList.appendChild(buildRoomCard(r));
    });
  }

  function buildRoomCard(room) {
    const node = el.tenantTpl.content.firstElementChild.cloneNode(true);
    const name = node.querySelector(".tenant-name");
    const modeRoom = node.querySelector(".t-mode-room");
    const modePerson = node.querySelector(".t-mode-person");
    const rent = node.querySelector(".t-rent");
    const rate = node.querySelector(".t-rate");
    const flatField = node.querySelector(".rent-flat-field");
    const perPersonFields = node.querySelector(".rent-per-person-fields");
    const prev = node.querySelector(".t-prev");
    const curr = node.querySelector(".t-curr");
    const cur = node.querySelector(".affix.cur");
    const rentersList = node.querySelector(".room-renters-list");
    const addRenterBtn = node.querySelector(".add-room-renter");

    const groupName = "bill-mode-" + room.id;
    modeRoom.name = groupName;
    modePerson.name = groupName;

    if (cur) cur.textContent = state.settings.currency || "₱";
    name.value = room.name || "";
    rent.value = room.flat_rent == null ? "" : room.flat_rent;
    rate.value = room.rate_per_person == null ? "" : room.rate_per_person;
    prev.value = room.prev_reading == null ? "" : room.prev_reading;
    curr.value = room.curr_reading == null ? "" : room.curr_reading;
    modeRoom.checked = room.rent_type !== "per_person";
    modePerson.checked = room.rent_type === "per_person";

    function applyModeVisibility() {
      const on = room.rent_type === "per_person";
      flatField.style.display = on ? "none" : "";
      perPersonFields.style.display = on ? "flex" : "none";
    }
    applyModeVisibility();

    function renderChips() {
      rentersList.innerHTML = "";
      const renters = roomRenters(room.id);
      if (!renters.length) {
        const empty = document.createElement("span");
        empty.className = "room-renters-empty";
        empty.textContent = "No renters assigned yet.";
        rentersList.appendChild(empty);
      } else {
        renters.forEach(function (renter) {
          const chip = el.renterChipTpl.content.firstElementChild.cloneNode(true);
          chip.textContent = fullName(renter) || "(Unnamed)";
          rentersList.appendChild(chip);
        });
      }
    }
    renderChips();
    node._renderRoomChips = renderChips;

    name.addEventListener("input", function () {
      room.name = this.value;
      markDirty();
    });
    rent.addEventListener("input", function () {
      room.flat_rent = this.value === "" ? null : num(this.value);
      updateRoomResults(node, room);
      renderSummary();
      markDirty();
    });
    modeRoom.addEventListener("change", function () {
      if (!this.checked) return;
      room.rent_type = "flat";
      applyModeVisibility();
      updateRoomResults(node, room);
      renderSummary();
      renderPaymentsTab();
      markDirty();
    });
    modePerson.addEventListener("change", function () {
      if (!this.checked) return;
      room.rent_type = "per_person";
      applyModeVisibility();
      updateRoomResults(node, room);
      renderSummary();
      renderPaymentsTab();
      markDirty();
    });
    rate.addEventListener("input", function () {
      room.rate_per_person = this.value === "" ? null : num(this.value);
      updateRoomResults(node, room);
      renderSummary();
      markDirty();
    });
    prev.addEventListener("input", function () {
      room.prev_reading = this.value === "" ? null : num(this.value);
      updateRoomResults(node, room);
      renderSummary();
      updateHouseMeterResults();
      markDirty();
    });
    curr.addEventListener("input", function () {
      room.curr_reading = this.value === "" ? null : num(this.value);
      updateRoomResults(node, room);
      renderSummary();
      updateHouseMeterResults();
      markDirty();
    });

    addRenterBtn.addEventListener("click", function () {
      api("POST", "/api/renters", { room_id: room.id }).then(function (renter) {
        state.renters.push(renter);
        renderChips();
        recalcRooms();
        renderRenters();
        renderPaymentsTab();
        renderSummary();
        activateTab("renters");
        const inputs = el.renterList.querySelectorAll(".renter-card .r-first");
        if (inputs.length) inputs[inputs.length - 1].focus();
      }).catch(saveFailed);
    });

    node.querySelector(".remove-tenant").addEventListener("click", function () {
      const label = room.name || "this room";
      if (!confirm("Remove " + label + "? This cannot be undone.")) return;
      api("DELETE", "/api/rooms/" + room.id).then(function () {
        state.rooms = state.rooms.filter(function (r) { return r.id !== room.id; });
        state.renters.forEach(function (rt) {
          if (rt.room_id === room.id) rt.room_id = null;
        });
        renderRooms();
        renderRenters();
        renderSummary();
        updateHouseMeterResults();
        renderPaymentsTab();
        refreshCurrentMonthWidget();
      }).catch(saveFailed);
    });

    updateRoomResults(node, room);
    return node;
  }

  function updateRoomResults(node, room) {
    const used = roomKwh(room);
    const rentAmount = effectiveRent(room);
    const powerCharge = used * num(state.settings.rate);
    const internetCharge = roomInternet(room);
    const total = rentAmount + powerCharge + internetCharge;
    const countEl = node.querySelector(".t-person-count");
    const subtotal = node.querySelector(".t-subtotal");
    const count = roomRenters(room.id).length;
    if (countEl) countEl.textContent = count + (count === 1 ? " renter" : " renters");
    if (subtotal) subtotal.textContent = money(rentAmount);
    node.querySelector(".r-kwh").textContent = kwh(used);
    node.querySelector(".r-power").textContent = money(powerCharge);
    node.querySelector(".r-internet").textContent = money(internetCharge);
    node.querySelector(".r-total").textContent = money(total);
  }

  function recalcRooms() {
    const cards = el.tenantList.querySelectorAll(".tenant-card");
    cards.forEach(function (node, i) {
      node.querySelectorAll(".affix.cur").forEach(function (cur) {
        cur.textContent = state.settings.currency || "₱";
      });
      updateRoomResults(node, state.rooms[i]);
    });
  }

  document.getElementById("addTenantBtn").addEventListener("click", function () {
    api("POST", "/api/rooms", { name: "", rent_type: "flat" }).then(function (room) {
      state.rooms.push(room);
      renderRooms();
      renderRenters();
      renderSummary();
      renderPaymentsTab();
      const names = el.tenantList.querySelectorAll(".tenant-card .tenant-name");
      if (names.length) names[names.length - 1].focus();
    }).catch(saveFailed);
  });

  /* ---------------- Renters ---------------- */
  function populateRoomOptions(select, selectedId) {
    select.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— No room assigned —";
    select.appendChild(noneOpt);
    state.rooms.forEach(function (room) {
      const opt = document.createElement("option");
      opt.value = room.id;
      opt.textContent = room.name || "(Unnamed room)";
      select.appendChild(opt);
    });
    select.value = selectedId ? String(selectedId) : "";
  }

  function renderRenters() {
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
  }

  function buildRenterCard(renter) {
    const node = el.renterTpl.content.firstElementChild.cloneNode(true);
    const fields = {
      first: node.querySelector(".r-first"),
      middle: node.querySelector(".r-middle"),
      last: node.querySelector(".r-last"),
      room: node.querySelector(".r-room"),
      address: node.querySelector(".r-address"),
      contact: node.querySelector(".r-contact"),
      birthday: node.querySelector(".r-birthday"),
      ecName: node.querySelector(".r-ec-name"),
      ecRelation: node.querySelector(".r-ec-relation"),
      ecNumber: node.querySelector(".r-ec-number"),
      reason: node.querySelector(".r-reason"),
      since: node.querySelector(".r-since"),
      duration: node.querySelector(".r-duration"),
    };

    fields.first.value = renter.first_name || "";
    fields.middle.value = renter.middle_name || "";
    fields.last.value = renter.last_name || "";
    populateRoomOptions(fields.room, renter.room_id);
    fields.address.value = renter.address || "";
    fields.contact.value = renter.contact_number || "";
    fields.birthday.value = renter.birthday ? String(renter.birthday).slice(0, 10) : "";
    fields.ecName.value = renter.emergency_contact_name || "";
    fields.ecRelation.value = renter.emergency_contact_relation || "";
    fields.ecNumber.value = renter.emergency_contact_number || "";
    fields.reason.value = renter.reason_for_stay || "";
    fields.since.value = renter.stay_start_date ? String(renter.stay_start_date).slice(0, 10) : "";
    fields.duration.textContent = durationSince(renter.stay_start_date);

    function bindText(input, prop) {
      input.addEventListener("input", function () {
        renter[prop] = this.value;
        markDirty();
      });
    }
    bindText(fields.first, "first_name");
    bindText(fields.middle, "middle_name");
    bindText(fields.last, "last_name");
    bindText(fields.address, "address");
    bindText(fields.contact, "contact_number");
    bindText(fields.ecName, "emergency_contact_name");
    bindText(fields.ecRelation, "emergency_contact_relation");
    bindText(fields.ecNumber, "emergency_contact_number");
    bindText(fields.reason, "reason_for_stay");

    fields.room.addEventListener("change", function () {
      renter.room_id = this.value === "" ? null : Number(this.value);
      refreshRoomChips();
      renderPaymentsTab();
      renderSummary();
      markDirty();
    });
    fields.birthday.addEventListener("change", function () {
      renter.birthday = this.value || null;
      markDirty();
    });
    fields.since.addEventListener("change", function () {
      renter.stay_start_date = this.value || null;
      fields.duration.textContent = durationSince(renter.stay_start_date);
      markDirty();
    });

    node.querySelector(".remove-renter").addEventListener("click", function () {
      const label = fullName(renter) || "this renter";
      if (!confirm("Remove " + label + "? This cannot be undone.")) return;
      api("DELETE", "/api/renters/" + renter.id).then(function () {
        state.renters = state.renters.filter(function (r) { return r.id !== renter.id; });
        renderRenters();
        refreshRoomChips();
        renderPaymentsTab();
        renderSummary();
        refreshCurrentMonthWidget();
      }).catch(saveFailed);
    });

    return node;
  }

  document.getElementById("addRenterBtn").addEventListener("click", function () {
    api("POST", "/api/renters", {}).then(function (renter) {
      state.renters.push(renter);
      renderRenters();
      const names = el.renterList.querySelectorAll(".renter-card .r-first");
      if (names.length) names[names.length - 1].focus();
    }).catch(saveFailed);
  });

  /* ---------------- Expenses ---------------- */
  function renderExpenses() {
    el.expenseList.innerHTML = "";
    if (state.expenses.length === 0) {
      const empty = document.createElement("div");
      empty.className = "expense-empty";
      empty.textContent = "No expenses yet. Add one if you want to see your net rent.";
      el.expenseList.appendChild(empty);
      return;
    }
    state.expenses.forEach(function (e) {
      el.expenseList.appendChild(buildExpenseRow(e));
    });
  }

  function buildExpenseRow(expense) {
    const node = el.expenseTpl.content.firstElementChild.cloneNode(true);
    const name = node.querySelector(".e-name");
    const amount = node.querySelector(".e-amount");
    const cur = node.querySelector(".affix.cur");

    if (cur) cur.textContent = state.settings.currency || "₱";
    name.value = expense.name || "";
    amount.value = expense.amount == null ? "" : expense.amount;

    name.addEventListener("input", function () {
      expense.name = this.value;
      markDirty();
    });
    amount.addEventListener("input", function () {
      expense.amount = this.value === "" ? null : num(this.value);
      renderSummary();
      markDirty();
    });
    node.querySelector(".remove-expense").addEventListener("click", function () {
      api("DELETE", "/api/expenses/" + expense.id).then(function () {
        state.expenses = state.expenses.filter(function (e) { return e.id !== expense.id; });
        renderExpenses();
        renderSummary();
      }).catch(saveFailed);
    });
    return node;
  }

  document.getElementById("addExpenseBtn").addEventListener("click", function () {
    api("POST", "/api/expenses", { name: "", amount: null }).then(function (expense) {
      state.expenses.push(expense);
      renderExpenses();
      renderSummary();
      const rows = el.expenseList.querySelectorAll(".expense-row .e-name");
      if (rows.length) rows[rows.length - 1].focus();
    }).catch(saveFailed);
  });

  /* ---------------- Payments (current month, navigable) ---------------- */
  function renderPaymentsTab() {
    el.periodLabel.textContent = MONTH_NAMES[viewPeriod.month - 1] + " " + viewPeriod.year;
    el.paymentsList.innerHTML = "";
    const targets = paymentTargets();
    if (!targets.length) {
      const empty = document.createElement("div");
      empty.className = "payments-empty";
      empty.textContent = "No assigned renters yet. Add a renter and assign them to a room first.";
      el.paymentsList.appendChild(empty);
      return;
    }
    targets.forEach(function (t) {
      el.paymentsList.appendChild(buildPaymentRow(t));
    });
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

    renterCell.textContent = fullName(target.renter) || "(Unnamed renter)";
    roomCell.textContent = target.room.name || "(Unnamed room)";
    const due = dueDateObj(target.room, viewPeriod.year, viewPeriod.month);
    dueCell.textContent = formatDate(due);

    const current = effectivePayment(state.paymentsView, target, viewPeriod.year, viewPeriod.month);
    [
      ["Rent", current.rent_amount],
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
      markDirty();
    }

    paidCheckbox.addEventListener("change", function () {
      if (paidCheckbox.checked && !paidDateInput.value) paidDateInput.value = todayISO();
      stagePending();
    });
    paidDateInput.addEventListener("change", stagePending);

    return node;
  }

  function loadPaymentsView() {
    return api("GET", "/api/payments?year=" + viewPeriod.year + "&month=" + viewPeriod.month).then(function (rows) {
      state.paymentsView = rows;
      renderPaymentsTab();
    }).catch(saveFailed);
  }

  el.prevMonthBtn.addEventListener("click", function () {
    viewPeriod.month -= 1;
    if (viewPeriod.month < 1) { viewPeriod.month = 12; viewPeriod.year -= 1; }
    loadPaymentsView();
  });
  el.nextMonthBtn.addEventListener("click", function () {
    viewPeriod.month += 1;
    if (viewPeriod.month > 12) { viewPeriod.month = 1; viewPeriod.year += 1; }
    loadPaymentsView();
  });

  /* ---------------- Dashboard payments widget (always real current month) ---------------- */
  function renderDashboardWidget() {
    const targets = paymentTargets();
    el.dashPaymentsSummary.innerHTML = "";
    if (!targets.length) {
      el.dashPaymentsPeriod.textContent = MONTH_NAMES[currentPeriod.month - 1] + " " + currentPeriod.year + " — no rooms yet";
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
        : "Add a room and renter to start getting reminders for the 15th.";
      const ok = document.createElement("div");
      ok.className = "reminders-empty";
      ok.textContent = targets.length ? "✓ No overdue or upcoming payments." : "No rooms billed yet.";
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
    const assignedCount = state.renters.filter(function (r) { return r.room_id; }).length;

    el.wfRoomsCount.textContent = roomCount
      ? roomCount + (roomCount === 1 ? " room created" : " rooms created")
      : "No rooms yet — start here";
    el.wfRentersCount.textContent = renterCount
      ? assignedCount + " of " + renterCount + " renters assigned"
      : "No renters yet";
    el.wfBillingCount.textContent = roomCount
      ? "All bills due every 15th"
      : "Due every 15th";
  }

  function refreshCurrentMonthWidget() {
    return api("GET", "/api/payments?year=" + currentPeriod.year + "&month=" + currentPeriod.month).then(function (rows) {
      state.paymentsCurrent = rows;
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
    api("GET", "/api/payments").then(renderHistory).catch(saveFailed);
  }

  function renderHistory(rows) {
    el.historyList.innerHTML = "";
    if (!rows.length) {
      el.historyEmpty.style.display = "";
      return;
    }
    el.historyEmpty.style.display = "none";

    const groups = [];
    const byKey = {};
    rows.forEach(function (row) {
      const key = row.period_year + "-" + row.period_month;
      if (!byKey[key]) {
        byKey[key] = { year: row.period_year, month: row.period_month, rows: [] };
        groups.push(byKey[key]);
      }
      byKey[key].rows.push(row);
    });

    groups.forEach(function (group) {
      const wrap = document.createElement("div");

      const head = document.createElement("div");
      head.className = "history-group-head";
      const title = document.createElement("span");
      title.className = "history-group-title";
      title.textContent = MONTH_NAMES[group.month - 1] + " " + group.year;
      const total = group.rows.reduce(function (sum, r) { return sum + (r.paid ? num(r.amount) : 0); }, 0);
      const totalEl = document.createElement("span");
      totalEl.className = "history-group-total";
      totalEl.textContent = "Collected " + money(total);
      head.appendChild(title);
      head.appendChild(totalEl);
      wrap.appendChild(head);

      group.rows.forEach(function (row) {
        const rowEl = document.createElement("div");
        rowEl.className = "history-row";

        const roomCell = document.createElement("div");
        roomCell.className = "history-room";
        const renterName = [row.renter_first_name, row.renter_last_name].filter(Boolean).join(" ");
        if (renterName) {
          roomCell.textContent = renterName;
          const sub = document.createElement("span");
          sub.className = "p-room-sub";
          sub.textContent = row.room_name;
          roomCell.appendChild(sub);
        } else {
          roomCell.textContent = row.room_name;
        }

        const amountCell = document.createElement("div");
        amountCell.className = "history-amount";
        amountCell.setAttribute("data-label", "Amount");
        amountCell.textContent = money(row.amount);

        const statusCell = document.createElement("div");
        statusCell.className = "history-status";
        statusCell.setAttribute("data-label", "Status");
        const badge = document.createElement("span");
        badge.className = "status-badge" + (row.paid ? " paid" : "");
        badge.textContent = row.paid ? "Paid" : "Unpaid";
        statusCell.appendChild(badge);

        const dateCell = document.createElement("div");
        dateCell.className = "history-date";
        dateCell.setAttribute("data-label", "Paid on");
        dateCell.textContent = row.paid_date ? formatDate(new Date(String(row.paid_date).slice(0, 10) + "T00:00:00")) : "—";

        rowEl.appendChild(roomCell);
        rowEl.appendChild(amountCell);
        rowEl.appendChild(statusCell);
        rowEl.appendChild(dateCell);
        wrap.appendChild(rowEl);
      });

      el.historyList.appendChild(wrap);
    });
  }

  function loadMeterHistory() {
    return api("GET", "/api/meter-history").then(renderMeterHistory).catch(saveFailed);
  }

  function renderMeterHistory(data) {
    const roomRows = (data && data.rooms) || [];
    const houseRows = (data && data.house) || [];
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
      ["Meter", "Previous", "Current", "Usage", "Rate", "Charge"].forEach(function (label) {
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
  const BIZ_NAME = "Lauglaug";
  const BIZ_TAGLINE = "Renting & Electricity Business";
  let receiptControlsReady = false;

  // Self-contained styles written into the print iframe so the receipt looks
  // identical whether previewed on screen or sent to the printer / PDF.
  const RECEIPT_PRINT_CSS =
    '@page { size: A5; margin: 14mm; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #131a24; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    '.receipt { max-width: 560px; margin: 0 auto; }' +
    '.receipt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 16px; border-bottom: 2px solid #131a24; }' +
    '.receipt-brand { display: flex; align-items: center; gap: 12px; }' +
    '.receipt-logo { width: 44px; height: 44px; border-radius: 10px; background: #1d4ed8; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; }' +
    '.receipt-biz { font-size: 19px; font-weight: 800; letter-spacing: -0.2px; }' +
    '.receipt-biz-sub { font-size: 12px; font-weight: 600; color: #5b6572; }' +
    '.receipt-meta { text-align: right; }' +
    '.receipt-title { font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: #1d4ed8; }' +
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
    if (room) {
      if (room.rent_type === "per_person") {
        rentShare = num(room.rate_per_person);
        rentNote = "Per-person rate";
      } else {
        const full = num(room.flat_rent);
        rentShare = count > 1 ? full / count : full;
        rentNote = count > 1 ? ("Whole-room rent " + money(full) + " ÷ " + count + " renters") : "Whole-room rent";
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
      return {
        renter: renter,
        room: room,
        year: year,
        month: month,
        rentShare: rentShare,
        rentNote: rentNote,
        elecShare: elecShare,
        elecNote: elecNote,
        usedKwh: usedKwh,
        internetShare: internetShare,
        total: rentShare + elecShare + internetShare,
        paid: record ? !!record.paid : false,
        paidDate: record && record.paid_date ? String(record.paid_date).slice(0, 10) : null,
        dueDate: room ? dueDateObj(room, year, month) : null,
      };
    });
  }

  function receiptInnerHTML(m) {
    const receiptNo = "OR-" + m.year + String(m.month).padStart(2, "0") + "-" + String(m.renter.id).padStart(3, "0");
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
        '<div class="receipt-brand">' +
          '<div class="receipt-logo">L</div>' +
          '<div><div class="receipt-biz">' + escapeHtml(BIZ_NAME) + '</div>' +
          '<div class="receipt-biz-sub">' + escapeHtml(BIZ_TAGLINE) + '</div></div>' +
        '</div>' +
        '<div class="receipt-meta">' +
          '<div class="receipt-title">RENT RECEIPT</div>' +
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
          '<tr><td>Room rent</td><td class="receipt-note">' + escapeHtml(m.rentNote) + '</td><td class="ta-right">' + money(m.rentShare) + '</td></tr>' +
          '<tr><td>Electricity</td><td class="receipt-note">' + escapeHtml(m.elecNote) + '</td><td class="ta-right">' + money(m.elecShare) + '</td></tr>' +
          '<tr><td>Internet</td><td class="receipt-note">Monthly charge per renter</td><td class="ta-right">' + money(m.internetShare) + '</td></tr>' +
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

    let grossRent = 0;
    let totalKwh = 0;
    state.rooms.forEach(function (r) {
      grossRent += effectiveRent(r);
      totalKwh += roomKwh(r);
    });

    let rentExpenses = 0;
    state.expenses.forEach(function (e) {
      rentExpenses += num(e.amount);
    });

    const grossPower = totalKwh * rate;
    const powerCost = totalKwh * cost;
    const assignedRenters = state.renters.filter(function (r) { return r.room_id; }).length;
    const grossInternet = assignedRenters * internetRate;

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
    el.sumHousehold.textContent = kwh(Math.max(0, houseMeterKwh() - totalKwh));
    el.sumGrossInternet.textContent = money(grossInternet);
    el.sumInternetRate.textContent = money(internetRate);
    el.sumInternetPeople.textContent = String(assignedRenters);

    el.sumGrossTotal.textContent = money(grossTotal);
    el.sumNetTotal.textContent = money(netTotal);
  }

  /* ---------------- Save everything ---------------- */
  function saveAll() {
    showStatus("saving", "Saving changes…");
    saving = true;
    setSaveDisabled(true);
    updateDirtyIndicator();
    const tasks = [
      api("PUT", "/api/settings", state.settings),
      api("PUT", "/api/house-meter", state.houseMeter),
    ];
    state.rooms.forEach(function (r) { tasks.push(api("PUT", "/api/rooms/" + r.id, r)); });
    state.renters.forEach(function (r) { tasks.push(api("PUT", "/api/renters/" + r.id, r)); });
    state.expenses.forEach(function (e) { tasks.push(api("PUT", "/api/expenses/" + e.id, e)); });
    Object.keys(pendingPayments).forEach(function (key) {
      tasks.push(api("PUT", "/api/payments", pendingPayments[key]));
    });

    return Promise.all(tasks).then(function () {
      dirty = false;
      pendingPayments = {};
      showStatus("saving", "All changes saved", 2000);
      return Promise.all([loadPaymentsView(), refreshCurrentMonthWidget()]);
    }).catch(function (err) {
      saveFailed(err);
    }).finally(function () {
      saving = false;
      updateDirtyIndicator();
    });
  }

  saveButtons.forEach(function (b) { b.addEventListener("click", saveAll); });

  /* ---------------- Reset / print ---------------- */
  document.getElementById("resetBtn").addEventListener("click", function () {
    if (!confirm("This will erase all rooms, renters, readings, payments, expenses, and settings from the database. Are you sure?")) return;
    api("POST", "/api/reset").then(function () {
      viewPeriod = { year: currentPeriod.year, month: currentPeriod.month };
      pendingPayments = {};
      dirty = false;
      updateDirtyIndicator();
      return loadState();
    }).catch(saveFailed);
  });

  /* ---------------- Init ---------------- */
  function renderAll() {
    renderSettings();
    renderRooms();
    renderRenters();
    renderExpenses();
    renderHouseMeter();
    renderSummary();
    renderWorkflowGuide();
  }

  function loadState() {
    connStatus.textContent = "Loading…";
    connStatus.className = "conn-status";
    return api("GET", "/api/state").then(function (data) {
      state.settings = data.settings;
      state.rooms = data.rooms;
      state.renters = data.renters;
      state.houseMeter = data.houseMeter;
      state.expenses = data.expenses;
      renderAll();
      connStatus.textContent = "Connected";
      connStatus.className = "conn-status ok";
      statusBanner.className = "status-banner";
      dirty = false;
      updateDirtyIndicator();
      return Promise.all([loadPaymentsView(), refreshCurrentMonthWidget()]);
    }).catch(function (err) {
      connStatus.textContent = "Offline";
      connStatus.className = "conn-status err";
      showStatus("error", "Can't reach the database (" + err.message + "). Make sure the server is running and your .env file has the right connection details — see README.md.");
    });
  }

  loadState();
})();
