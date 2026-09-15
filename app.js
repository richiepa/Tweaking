/* Tweaking — all data stays in this device's IndexedDB. No server, ever. */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_EDIT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_DELETE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  const ICON_CAMERA =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

  // ---- Storage (IndexedDB) ----
  const DB_NAME = "tweaking";
  const ENTRIES = "entries";
  const PROFILES = "profiles";
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "id" });
          if (!db.objectStoreNames.contains(PROFILES)) db.createObjectStore(PROFILES, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function dbGetAll(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(store, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(store, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function newId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function rememberProfile(id) {
    try { localStorage.setItem("tweaking-profile", id); } catch (e) { /* private mode etc. */ }
  }
  function recallProfile() {
    try { return localStorage.getItem("tweaking-profile"); } catch (e) { return null; }
  }

  // ---- State ----
  let profiles = [];
  let activeProfileId = null;
  let entries = []; // active profile's, newest first
  let editingId = null;
  let selectedId = null;
  let editingProfileId = null;
  let pendingPhoto = null; // blob attached to the next log
  let pendingProfilePic = null; // blob for the new-profile form

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
  const profileBtn = $("profile-btn");
  const profileAvatar = $("profile-avatar");
  const profileInitial = $("profile-initial");
  const profilePanel = $("profile-panel");
  const profileList = $("profile-list");
  const newProfileName = $("new-profile-name");
  const newProfilePicBtn = $("new-profile-pic-btn");
  const newProfilePic = $("new-profile-pic");
  const newProfileAdd = $("new-profile-add");
  const photoBtn = $("photo-btn");
  const photoInput = $("photo-input");
  const photoPreview = $("photo-preview");
  const photoThumb = $("photo-thumb");
  const photoRemove = $("photo-remove");
  const lightbox = $("lightbox");
  const lightboxImg = $("lightbox-img");

  // ---- Object URL bookkeeping ----
  const liveUrls = [];
  function blobUrl(blob) {
    const url = URL.createObjectURL(blob);
    liveUrls.push(url);
    return url;
  }
  function revokeUrls() {
    while (liveUrls.length) URL.revokeObjectURL(liveUrls.pop());
  }

  // ---- Level formatting & severity ----
  const round1 = (v) => Math.round(v * 10) / 10;
  const fmt = (v) => round1(v).toFixed(1);

  // quiet tan -> orange -> red as the level climbs
  const SEV_STOPS = [
    [1, [168, 154, 132]],
    [4.5, [229, 121, 62]],
    [7, [224, 90, 43]],
    [10, [224, 59, 48]],
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

  // ---- Photos ----
  function resizeImage(file, maxDim, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => resolve(b || null), "image/jpeg", quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function openLightbox(blob) {
    lightboxImg.src = blobUrl(blob);
    lightbox.hidden = false;
  }
  lightbox.addEventListener("click", () => {
    lightbox.hidden = true;
    lightboxImg.removeAttribute("src");
  });

  photoBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = "";
    if (!file) return;
    const blob = await resizeImage(file, 800, 0.8);
    if (!blob) return;
    pendingPhoto = blob;
    photoThumb.src = URL.createObjectURL(blob);
    photoPreview.hidden = false;
  });
  photoRemove.addEventListener("click", () => clearPendingPhoto());

  function clearPendingPhoto() {
    pendingPhoto = null;
    if (photoThumb.src) URL.revokeObjectURL(photoThumb.src);
    photoThumb.removeAttribute("src");
    photoPreview.hidden = true;
  }

  // ---- Profiles ----
  function activeProfile() {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0];
  }

  function renderHeader() {
    const p = activeProfile();
    if (!p) return;
    if (p.avatar) {
      profileAvatar.src = blobUrl(p.avatar);
      profileAvatar.hidden = false;
      profileInitial.hidden = true;
    } else {
      profileAvatar.hidden = true;
      profileAvatar.removeAttribute("src");
      profileInitial.hidden = false;
      profileInitial.textContent = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
    }
    profileBtn.setAttribute("aria-label", "Profiles — signed in as " + (p.name || "?"));
  }

  async function loadEntries() {
    const all = await dbGetAll(ENTRIES);
    return all.filter((e) => e.profileId === activeProfileId).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function switchProfile(id) {
    activeProfileId = id;
    rememberProfile(id);
    editingId = null;
    selectedId = null;
    entries = await loadEntries();
    profilePanel.hidden = true;
    render();
  }

  function avatarNode(p, size) {
    if (p.avatar) {
      const img = document.createElement("img");
      img.className = size;
      img.alt = "";
      img.src = blobUrl(p.avatar);
      return img;
    }
    const span = document.createElement("span");
    span.className = size + " avatar-initial";
    span.textContent = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
    return span;
  }

  function renderProfiles() {
    profileList.textContent = "";
    for (const p of profiles) {
      profileList.appendChild(profileRow(p));
    }
  }

  function profileRow(p) {
    const li = document.createElement("li");
    li.className = "profile-row" + (p.id === activeProfileId ? " active" : "");

    if (editingProfileId === p.id) {
      li.appendChild(profileEditForm(p));
      return li;
    }

    const main = document.createElement("div");
    main.className = "profile-main";
    main.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      switchProfile(p.id);
    });

    main.appendChild(avatarNode(p, "avatar-sm"));

    const name = document.createElement("span");
    name.className = "profile-name";
    name.textContent = p.name;
    main.appendChild(name);

    if (p.id === activeProfileId) {
      const dot = document.createElement("span");
      dot.className = "active-dot";
      dot.setAttribute("aria-label", "Current profile");
      main.appendChild(dot);
    }

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.type = "button";
    editBtn.setAttribute("aria-label", "Edit profile " + p.name);
    editBtn.innerHTML = ICON_EDIT;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      editingProfileId = editingProfileId === p.id ? null : p.id;
      renderProfiles();
    });
    main.appendChild(editBtn);

    if (profiles.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn";
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", "Delete profile " + p.name);
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
        const all = await dbGetAll(ENTRIES);
        for (const en of all) if (en.profileId === p.id) await dbDelete(ENTRIES, en.id);
        await dbDelete(PROFILES, p.id);
        profiles = profiles.filter((x) => x.id !== p.id);
        if (editingProfileId === p.id) editingProfileId = null;
        if (activeProfileId === p.id) {
          await switchProfile(profiles[0].id);
          profilePanel.hidden = false;
        }
        renderProfiles();
        renderHeader();
      });
      main.appendChild(delBtn);
    }

    li.appendChild(main);
    return li;
  }

  function profileEditForm(p) {
    const form = document.createElement("div");
    form.className = "profile-edit";
    let newPic; // undefined = keep, null = removed, blob = replace

    const picBtn = document.createElement("button");
    picBtn.className = "avatar-btn avatar-pick";
    picBtn.type = "button";
    picBtn.setAttribute("aria-label", "Change profile picture");
    picBtn.appendChild(avatarNode(p, "avatar-sm"));
    const picInput = document.createElement("input");
    picInput.type = "file";
    picInput.accept = "image/*";
    picInput.hidden = true;
    picBtn.addEventListener("click", () => picInput.click());
    picInput.addEventListener("change", async () => {
      const file = picInput.files && picInput.files[0];
      picInput.value = "";
      if (!file) return;
      const blob = await resizeImage(file, 256, 0.85);
      if (!blob) return;
      newPic = blob;
      picBtn.textContent = "";
      const img = document.createElement("img");
      img.className = "avatar-sm";
      img.alt = "";
      img.src = blobUrl(blob);
      picBtn.appendChild(img);
    });

    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 30;
    name.value = p.name;
    name.setAttribute("aria-label", "Profile name");

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    const cancel = document.createElement("button");
    cancel.className = "ghost small";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      editingProfileId = null;
      renderProfiles();
    });
    const save = document.createElement("button");
    save.className = "primary small";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      const n = name.value.trim().slice(0, 30);
      if (n) p.name = n;
      if (newPic !== undefined) p.avatar = newPic;
      await dbPut(PROFILES, p);
      editingProfileId = null;
      renderProfiles();
      renderHeader();
    });
    actions.append(cancel, save);

    const top = document.createElement("div");
    top.className = "profile-main";
    top.append(picBtn, name);
    form.append(top, picInput, actions);
    return form;
  }

  profileBtn.addEventListener("click", () => {
    profilePanel.hidden = !profilePanel.hidden;
    if (!profilePanel.hidden) {
      editingProfileId = null;
      renderProfiles();
    }
  });

  newProfilePicBtn.addEventListener("click", () => newProfilePic.click());
  newProfilePic.addEventListener("change", async () => {
    const file = newProfilePic.files && newProfilePic.files[0];
    newProfilePic.value = "";
    if (!file) return;
    const blob = await resizeImage(file, 256, 0.85);
    if (!blob) return;
    pendingProfilePic = blob;
    newProfilePicBtn.classList.add("has-pic");
  });

  newProfileAdd.addEventListener("click", async () => {
    const name = newProfileName.value.trim().slice(0, 30);
    if (!name) {
      newProfileName.focus();
      return;
    }
    const p = { id: newId(), name, avatar: pendingProfilePic, createdAt: Date.now() };
    await dbPut(PROFILES, p);
    profiles.push(p);
    newProfileName.value = "";
    pendingProfilePic = null;
    newProfilePicBtn.classList.remove("has-pic");
    await switchProfile(p.id);
  });

  // ---- Logging ----
  let doneTimer = null;

  async function logEntry() {
    const entry = {
      id: newId(),
      profileId: activeProfileId,
      level: round1(Number(levelInput.value)),
      note: noteInput.value.trim().slice(0, 200),
      photo: pendingPhoto,
      createdAt: Date.now(),
      updatedAt: null,
    };
    try {
      await dbPut(ENTRIES, entry);
    } catch (err) {
      alert("Couldn't save — this browser may be blocking storage.");
      return;
    }
    entries.unshift(entry);
    noteInput.value = "";
    levelInput.value = "5";
    clearPendingPhoto();
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
    revokeUrls(); // loaded imgs keep displaying; this only frees the handles
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
      body.appendChild(note);
    }
    const time = document.createElement("span");
    time.className = "entry-time";
    time.textContent = timeLabel(entry.createdAt) + (entry.updatedAt ? " · edited" : "");
    body.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    if (entry.photo) {
      const thumbBtn = document.createElement("button");
      thumbBtn.className = "thumb-btn";
      thumbBtn.type = "button";
      thumbBtn.setAttribute("aria-label", "View photo");
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = "";
      img.src = blobUrl(entry.photo);
      thumbBtn.appendChild(img);
      thumbBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openLightbox(entry.photo);
      });
      actions.appendChild(thumbBtn);
    }

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
      await dbDelete(ENTRIES, entry.id);
      entries = entries.filter((e2) => e2.id !== entry.id);
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

    let removePhoto = false;
    const actions = document.createElement("div");
    actions.className = "edit-actions";
    if (entry.photo) {
      const dropPic = document.createElement("button");
      dropPic.className = "ghost small";
      dropPic.type = "button";
      dropPic.textContent = "Remove photo";
      dropPic.addEventListener("click", () => {
        removePhoto = !removePhoto;
        dropPic.textContent = removePhoto ? "Photo will be removed" : "Remove photo";
      });
      actions.appendChild(dropPic);
    }
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
      if (removePhoto) entry.photo = null;
      entry.updatedAt = Date.now();
      await dbPut(ENTRIES, entry);
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
    renderHeader();
    if (!profilePanel.hidden) renderProfiles();
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
      profiles = await dbGetAll(PROFILES);
      if (!profiles.length) {
        const p = { id: newId(), name: "Me", avatar: null, createdAt: Date.now() };
        await dbPut(PROFILES, p);
        profiles = [p];
      }
      const remembered = recallProfile();
      activeProfileId = profiles.some((p) => p.id === remembered) ? remembered : profiles[0].id;
      // adopt any entries from before profiles existed
      const all = await dbGetAll(ENTRIES);
      for (const en of all) {
        if (!en.profileId) {
          en.profileId = profiles[0].id;
          await dbPut(ENTRIES, en);
        }
      }
      entries = all
        .filter((e) => e.profileId === activeProfileId)
        .sort((a, b) => b.createdAt - a.createdAt);
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
