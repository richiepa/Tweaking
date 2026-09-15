/* Tweaking — all data stays in this device's IndexedDB. No server, ever. */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_EDIT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_DELETE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  // ---- Storage (IndexedDB) ----
  const DB_NAME = "tweaking";
  const STORE = "entries";
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function dbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(entry) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function newId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  // ---- State ----
  let entries = []; // newest first
  let editingId = null;
  let selectedId = null;

  // ---- Level formatting & severity ----
  const round1 = (v) => Math.round(v * 10) / 10;
  const fmt = (v) => round1(v).toFixed(1);

  // green -> amber -> orange -> red as the level climbs
  const SEV_STOPS = [
    [1, [20, 151, 92]],
    [4.5, [217, 144, 0]],
    [7, [224, 96, 42]],
    [10, [208, 47, 61]],
  ];

  function sevRgb(v) {
    if (v <= SEV_STOPS[0][0]) return SEV_STOPS[0][1];
    for (let i = 1; i < SEV_STOPS.length; i++) {
      const [stop, c] = SEV_STOPS[i];
      const [prev, pc] = SEV_STOPS[i - 1];
      if (v <= stop) {
        const t = (v - prev) / (stop - prev);
        return pc.map((ch, j) => Math.round(ch + (c[j] - ch) * t));
      }
    }
    return SEV_STOPS[SEV_STOPS.length - 1][1];
  }

  const sevColor = (v) => `rgb(${sevRgb(v).join(",")})`;
  const sevTint = (v) => `rgba(${sevRgb(v).join(",")},0.16)`;

  // ---- Elements ----
  const $ = (id) => document.getElementById(id);
  const levelInput = $("level");
  const levelValue = $("level-value");
  const noteInput = $("note");
  const logBtn = $("log-btn");
  const historyEl = $("history");
  const chartEl = $("chart");
  const listEl = $("entries");
  const emptyEl = $("empty");

  // ---- Slider ----
  function syncSlider(input, valueEl) {
    const v = Number(input.value);
    const pct = ((v - input.min) / (input.max - input.min)) * 100;
    const sev = sevColor(v);
    input.style.setProperty("--pct", pct + "%");
    input.style.setProperty("--sev", sev);
    valueEl.style.setProperty("--sev", sev);
    valueEl.textContent = fmt(v);
  }

  // the readout shakes past 7 and pulses red past 9
  function applyScary(v) {
    const amp = v >= 7 ? ((v - 7) / 3) * 3 : 0;
    levelValue.style.setProperty("--amp", amp.toFixed(2) + "px");
    levelValue.classList.toggle("danger", v >= 9);
    levelValue.classList.toggle("shaking", v >= 7 && v < 9);
  }

  function syncMainSlider() {
    syncSlider(levelInput, levelValue);
    applyScary(Number(levelInput.value));
  }

  levelInput.addEventListener("input", syncMainSlider);
  syncMainSlider();

  // ---- Logging ----
  let doneTimer = null;

  async function logEntry() {
    const entry = {
      id: newId(),
      level: round1(Number(levelInput.value)),
      note: noteInput.value.trim().slice(0, 200),
      createdAt: Date.now(),
      updatedAt: null,
    };
    try {
      await dbPut(entry);
    } catch (err) {
      alert("Couldn't save — this browser may be blocking storage.");
      return;
    }
    entries.unshift(entry);
    noteInput.value = "";
    levelInput.value = "5";
    syncMainSlider();
    render();
    logBtn.textContent = "Logged";
    logBtn.classList.add("done");
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      logBtn.textContent = "Log";
      logBtn.classList.remove("done");
    }, 1200);
  }

  logBtn.addEventListener("click", logEntry);
  noteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") logEntry();
  });

  // ---- Time formatting ----
  function timeLabel(ts) {
    const diff = Date.now() - ts;
    if (diff < 60e3) return "just now";
    if (diff < 3600e3) return Math.floor(diff / 60e3) + "m ago";
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + "h ago";
    const d = new Date(ts);
    const opts = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return (
      d.toLocaleDateString(undefined, opts) +
      ", " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    );
  }

  function tickLabel(ts, spansDays) {
    const d = new Date(ts);
    return spansDays
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // ---- Entries list ----
  function renderList() {
    listEl.textContent = "";
    for (const entry of entries) {
      listEl.appendChild(entryRow(entry));
    }
  }

  function entryRow(entry) {
    const li = document.createElement("li");
    li.className = "entry" + (selectedId === entry.id ? " selected" : "");

    const main = document.createElement("div");
    main.className = "entry-main";
    main.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectedId = selectedId === entry.id ? null : entry.id;
      render();
      if (selectedId) {
        const card = document.querySelector(".chart-card");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = fmt(entry.level);
    chip.style.background = sevTint(entry.level);

    const body = document.createElement("div");
    body.className = "entry-body";
    if (entry.note) {
      const note = document.createElement("span");
      note.className = "entry-note";
      note.textContent = entry.note;
      note.title = entry.note;
      body.appendChild(note);
    }
    const time = document.createElement("span");
    time.className = "entry-time";
    time.textContent = timeLabel(entry.createdAt) + (entry.updatedAt ? " · edited" : "");
    body.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.type = "button";
    editBtn.setAttribute("aria-label", "Edit entry");
    editBtn.innerHTML = ICON_EDIT;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // keep the row's select handler out of it
      editingId = editingId === entry.id ? null : entry.id;
      renderList();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", "Delete entry");
    delBtn.innerHTML = ICON_DELETE;
    let confirmTimer = null;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!delBtn.classList.contains("confirm")) {
        delBtn.classList.add("confirm");
        delBtn.textContent = "Sure?";
        confirmTimer = setTimeout(() => {
          delBtn.classList.remove("confirm");
          delBtn.innerHTML = ICON_DELETE;
        }, 3000);
        return;
      }
      clearTimeout(confirmTimer);
      await dbDelete(entry.id);
      entries = entries.filter((e) => e.id !== entry.id);
      if (editingId === entry.id) editingId = null;
      if (selectedId === entry.id) selectedId = null;
      render();
    });

    actions.append(editBtn, delBtn);
    main.append(chip, body, actions);
    li.appendChild(main);

    if (editingId === entry.id) li.appendChild(editForm(entry));
    return li;
  }

  function editForm(entry) {
    const form = document.createElement("div");
    form.className = "edit-form";

    const levelRow = document.createElement("div");
    levelRow.className = "edit-level";
    const out = document.createElement("output");
    out.textContent = fmt(entry.level);
    const range = document.createElement("input");
    range.type = "range";
    range.min = "1";
    range.max = "10";
    range.step = "0.1";
    range.value = String(entry.level);
    range.setAttribute("aria-label", "Tweak level from 1 to 10");
    range.addEventListener("input", () => syncSlider(range, out));
    levelRow.append(out, range);

    const note = document.createElement("input");
    note.type = "text";
    note.maxLength = 200;
    note.placeholder = "note (optional)";
    note.value = entry.note || "";

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    const cancel = document.createElement("button");
    cancel.className = "ghost small";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      editingId = null;
      renderList();
    });
    const save = document.createElement("button");
    save.className = "primary small";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      entry.level = round1(Number(range.value));
      entry.note = note.value.trim().slice(0, 200);
      entry.updatedAt = Date.now();
      await dbPut(entry);
      editingId = null;
      render();
    });
    actions.append(cancel, save);

    form.append(levelRow, note, actions);
    requestAnimationFrame(() => syncSlider(range, out));
    return form;
  }

  // ---- Trend chart ----
  const M = { top: 14, right: 14, bottom: 26, left: 28 };
  const CHART_H = 190;

  function renderChart() {
    chartEl.textContent = "";
    const old = chartEl.parentElement.querySelector(".chart-tip");
    if (old) old.remove();
    if (!entries.length) return;

    const pts = [...entries].sort((a, b) => a.createdAt - b.createdAt);
    const width = Math.max(chartEl.clientWidth || 320, 200);
    const plotW = width - M.left - M.right;
    const plotH = CHART_H - M.top - M.bottom;

    let t0 = pts[0].createdAt;
    let t1 = pts[pts.length - 1].createdAt;
    if (t1 - t0 < 60e3) {
      // one point (or a burst): pad the domain so it doesn't sit on an edge
      t0 -= 3600e3;
      t1 += 3600e3;
    }
    const x = (t) => M.left + ((t - t0) / (t1 - t0)) * plotW;
    const y = (v) => M.top + (1 - (v - 1) / 9) * plotH;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${CHART_H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Tweak level over time; values are listed under Entries");

    const el = (name, attrs, parent) => {
      const node = document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      (parent || svg).appendChild(node);
      return node;
    };
    const css = (name) => `var(--${name})`;

    // gridlines + y labels (2..10), baseline at 1
    for (const v of [2, 4, 6, 8, 10]) {
      el("line", { x1: M.left, x2: width - M.right, y1: y(v), y2: y(v), stroke: css("grid"), "stroke-width": 1 });
      const lbl = el("text", { x: M.left - 8, y: y(v) + 3.5, "text-anchor": "end", "font-size": 11, fill: css("muted") });
      lbl.textContent = String(v);
    }
    el("line", { x1: M.left, x2: width - M.right, y1: y(1), y2: y(1), stroke: css("axis"), "stroke-width": 1 });
    const one = el("text", { x: M.left - 8, y: y(1) + 3.5, "text-anchor": "end", "font-size": 11, fill: css("muted") });
    one.textContent = "1";

    // x tick labels: first, last, middle if there's room
    const spansDays = t1 - t0 > 86400e3;
    const ticks = [t0, t1];
    if (plotW > 280) ticks.splice(1, 0, (t0 + t1) / 2);
    ticks.forEach((t, i) => {
      const anchor = i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle";
      const tx = i === 0 ? M.left : i === ticks.length - 1 ? width - M.right : x(t);
      const lbl = el("text", { x: tx, y: CHART_H - 8, "text-anchor": anchor, "font-size": 11, fill: css("muted") });
      lbl.textContent = tickLabel(t, spansDays);
    });

    // area wash + line
    const coords = pts.map((p) => [x(p.createdAt), y(p.level)]);
    if (coords.length > 1) {
      const line = coords.map((c, i) => (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" ");
      el("path", {
        d: `${line} L ${coords[coords.length - 1][0].toFixed(1)} ${y(1)} L ${coords[0][0].toFixed(1)} ${y(1)} Z`,
        fill: css("wash"),
      });
      el("path", {
        d: line,
        fill: "none",
        stroke: css("accent"),
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      });
    }

    // dots (skip when dense, keep the endpoint)
    const dotPts = coords.length <= 60 ? coords : [coords[coords.length - 1]];
    for (const [cx, cy] of dotPts) {
      el("circle", { cx, cy, r: 4, fill: css("accent"), stroke: css("surface"), "stroke-width": 2 });
    }

    // hover: crosshair + tooltip snapping to the nearest entry
    const cross = el("line", { y1: M.top, y2: M.top + plotH, stroke: css("axis"), "stroke-width": 1, visibility: "hidden" });
    const focusDot = el("circle", { r: 6, fill: css("accent"), stroke: css("surface"), "stroke-width": 2, visibility: "hidden" });

    const card = chartEl.parentElement;
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    const tipValue = document.createElement("span");
    tipValue.className = "tip-value";
    const tipTime = document.createElement("span");
    const tipNote = document.createElement("span");
    tipNote.className = "tip-note";
    tip.append(tipValue, document.createElement("br"), tipTime, tipNote);
    card.appendChild(tip);

    const hit = el("rect", { x: 0, y: 0, width, height: CHART_H, fill: "transparent" });
    hit.style.touchAction = "pan-y";

    // a selected list entry stays pinned on the chart
    const pinnedIdx = selectedId ? pts.findIndex((p) => p.id === selectedId) : -1;

    function showIndex(i) {
      const rect = svg.getBoundingClientRect();
      const scale = width / rect.width;
      const p = pts[i];
      const [cx, cy] = coords[i];
      cross.setAttribute("x1", cx);
      cross.setAttribute("x2", cx);
      cross.setAttribute("visibility", "visible");
      focusDot.setAttribute("cx", cx);
      focusDot.setAttribute("cy", cy);
      focusDot.setAttribute("visibility", "visible");

      tipValue.textContent = fmt(p.level) + " / 10";
      tipTime.textContent = " " + timeLabel(p.createdAt);
      tipNote.textContent = p.note || "";
      tip.hidden = false;
      const cardRect = card.getBoundingClientRect();
      const tipW = tip.offsetWidth;
      let left = rect.left - cardRect.left + cx / scale - tipW / 2;
      left = Math.min(Math.max(left, 4), cardRect.width - tipW - 4);
      tip.style.left = left + "px";
      tip.style.top = rect.top - cardRect.top + cy / scale - tip.offsetHeight - 14 + "px";
    }

    function nearestIndex(clientX) {
      const rect = svg.getBoundingClientRect();
      const scale = width / rect.width;
      const px = (clientX - rect.left) * scale;
      let best = 0;
      for (let i = 1; i < coords.length; i++) {
        if (Math.abs(coords[i][0] - px) < Math.abs(coords[best][0] - px)) best = i;
      }
      return best;
    }

    function hide() {
      cross.setAttribute("visibility", "hidden");
      focusDot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    }

    hit.addEventListener("pointermove", (e) => showIndex(nearestIndex(e.clientX)));
    hit.addEventListener("pointerdown", (e) => showIndex(nearestIndex(e.clientX)));
    hit.addEventListener("pointerleave", () => (pinnedIdx >= 0 ? showIndex(pinnedIdx) : hide()));

    chartEl.appendChild(svg);
    if (pinnedIdx >= 0) showIndex(pinnedIdx);
  }

  // ---- Render ----
  function render() {
    const has = entries.length > 0;
    historyEl.hidden = !has;
    emptyEl.hidden = has;
    renderList();
    renderChart();
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 150);
  });
  setInterval(renderList, 60e3); // keep relative times fresh

  // ---- Boot ----
  (async () => {
    try {
      entries = (await dbGetAll()).sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      entries = [];
    }
    render();
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
