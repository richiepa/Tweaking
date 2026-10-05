/* Tweaking — all data stays in this device's IndexedDB. No server, ever. */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_EDIT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_DELETE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  const ICON_MUSIC =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const ICON_PLAY =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6z"/><path d="M14 5h4v14h-4z"/></svg>';

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

  function rememberSession(id) {
    try {
      if (id) localStorage.setItem("tweaking-profile", id);
      else localStorage.removeItem("tweaking-profile");
    } catch (e) { /* private mode etc. */ }
  }
  function recallSession() {
    try { return localStorage.getItem("tweaking-profile"); } catch (e) { return null; }
  }

  // ---- Passwords (salted hash, on-device only; gates the UI, not encryption) ----
  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(salt + ":" + password);
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // insecure-context fallback (djb2) — still better than plain text
    let h = 5381;
    for (const b of data) h = ((h << 5) + h + b) | 0;
    return "djb2-" + (h >>> 0).toString(16);
  }

  async function checkPassword(profile, password) {
    if (!profile.passHash) return true; // legacy profile from before passwords
    return (await hashPassword(password, profile.passSalt)) === profile.passHash;
  }

  // ---- State ----
  let profiles = [];
  let activeProfileId = null; // signed-in profile, or null = auth screen
  let entries = []; // active profile's, newest first
  let editingId = null;
  let selectedId = null;
  let editingProfileId = null;
  let authMode = "login"; // or "register"
  let expanded = null; // {id, action: "switch" | "delete" | "setpw"} row expansion

  // the chart's visible time window: null = everything; pan/pinch sets it
  let viewStart = null;
  let viewEnd = null;

  function fullWindow() {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of entries) {
      if (e.createdAt < lo) lo = e.createdAt;
      if (e.createdAt > hi) hi = e.createdAt;
    }
    if (hi - lo < 60e3) {
      // one point (or a burst): pad so it doesn't sit on an edge
      lo -= 3600e3;
      hi += 3600e3;
    }
    return [lo, hi];
  }

  function visibleEntries() {
    if (viewStart == null) return entries;
    return entries.filter((e) => e.createdAt >= viewStart && e.createdAt <= viewEnd);
  }
  let pendingPhoto = null; // blob attached to the next log
  let pendingSong = null; // {title, artist, art, preview} for the next log
  let pendingRegPic = null; // blob for the register form

  // ---- Elements ----
  const $ = (id) => document.getElementById(id);
  const appEl = $("app");
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
  const panelNew = $("panel-new-account");
  const panelSignOut = $("panel-sign-out");
  const authEl = $("auth");
  const authHeading = $("auth-heading");
  const authLogin = $("auth-login");
  const authList = $("auth-list");
  const authRegister = $("auth-register");
  const regName = $("reg-name");
  const regPass = $("reg-pass");
  const regPicBtn = $("reg-pic-btn");
  const regPic = $("reg-pic");
  const regSubmit = $("reg-submit");
  const authToggle = $("auth-toggle");
  const authError = $("auth-error");
  const photoBtn = $("photo-btn");
  const photoInput = $("photo-input");
  const photoPreview = $("photo-preview");
  const photoThumb = $("photo-thumb");
  const photoRemove = $("photo-remove");
  const lightbox = $("lightbox");
  const lightboxImg = $("lightbox-img");
  const installGuide = $("install-guide");
  const installLink = $("install-link");
  const installAction = $("install-action");
  const installBtn = $("install-btn");
  const songBtn = $("song-btn");
  const songSearch = $("song-search");
  const songQuery = $("song-query");
  const songResults = $("song-results");
  const songAttached = $("song-attached");
  const songArt = $("song-art");
  const songLabel = $("song-label");
  const songPlay = $("song-play");
  const songRemove = $("song-remove");
  const trendWindow = $("trend-window");
  const trendReset = $("trend-reset");

  function renderTrendHead() {
    if (viewStart == null) {
      trendWindow.textContent = "drag to move · pinch to zoom";
      trendReset.hidden = true;
      return;
    }
    const spansDays = viewEnd - viewStart > 86400e3;
    const d = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const tm = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    trendWindow.textContent = spansDays
      ? d(viewStart) + " – " + d(viewEnd)
      : d(viewStart) + ", " + tm(viewStart) + " – " + tm(viewEnd);
    trendReset.hidden = false;
  }

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

  // ---- Notes grow with their text ----
  function autosize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }
  noteInput.addEventListener("input", () => autosize(noteInput));

  // ---- Songs (Instagram-notes style, via the iTunes Search API) ----
  // The catalog lookup and 30s previews come from Apple; only the search
  // text leaves the device — never the log itself.
  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = "itcb" + Date.now() + Math.floor(Math.random() * 1e6);
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("timeout"));
      }, timeoutMs || 8000);
      function cleanup() {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
      }
      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("network"));
      };
      script.src = url + "&callback=" + cb;
      document.head.appendChild(script);
    });
  }

  async function searchSongs(q) {
    const url = "https://itunes.apple.com/search?media=music&entity=song&limit=6&term=" + encodeURIComponent(q);
    let data;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error("http " + resp.status);
      data = await resp.json();
    } catch (err) {
      data = await jsonp(url); // fallback for engines that block the CORS fetch
    }
    return (data.results || []).map((r) => ({
      title: r.trackName || "",
      artist: r.artistName || "",
      art: r.artworkUrl100 || "",
      preview: r.previewUrl || "",
    }));
  }

  // one shared preview player; whichever button started it owns the icon
  const previewAudio = new Audio();
  let playingBtn = null;
  function resetPlayingBtn() {
    if (playingBtn) playingBtn.innerHTML = ICON_PLAY;
    playingBtn = null;
  }
  previewAudio.addEventListener("ended", resetPlayingBtn);
  previewAudio.addEventListener("pause", resetPlayingBtn);

  function togglePreview(song, btn) {
    if (!song.preview) return;
    if (playingBtn === btn && !previewAudio.paused) {
      previewAudio.pause();
      return;
    }
    previewAudio.pause();
    previewAudio.src = song.preview;
    previewAudio.play().then(() => {
      playingBtn = btn;
      btn.innerHTML = ICON_PAUSE;
    }).catch(() => {});
  }

  function songHint(text) {
    songResults.textContent = "";
    const li = document.createElement("li");
    li.className = "song-hint";
    li.textContent = text;
    songResults.appendChild(li);
  }

  function renderSongResults(songs) {
    songResults.textContent = "";
    if (!songs.length) {
      songHint("No matches.");
      return;
    }
    for (const song of songs) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const art = document.createElement("img");
      art.className = "song-art";
      art.alt = "";
      art.src = song.art;
      art.addEventListener("error", () => (art.hidden = true));
      const meta = document.createElement("span");
      meta.className = "song-meta";
      const title = document.createElement("span");
      title.className = "song-title";
      title.textContent = song.title;
      const artist = document.createElement("span");
      artist.className = "song-artist";
      artist.textContent = song.artist;
      meta.append(title, artist);
      btn.append(art, meta);
      btn.addEventListener("click", () => attachSong(song));
      li.appendChild(btn);
      songResults.appendChild(li);
    }
  }

  function attachSong(song) {
    pendingSong = song;
    songSearch.hidden = true;
    songQuery.value = "";
    songResults.textContent = "";
    songLabel.textContent = song.title + " · " + song.artist;
    songArt.src = song.art;
    songArt.hidden = !song.art;
    songPlay.innerHTML = ICON_PLAY;
    songAttached.hidden = false;
  }

  function clearPendingSong() {
    pendingSong = null;
    songAttached.hidden = true;
    songArt.removeAttribute("src");
    songLabel.textContent = "";
  }

  songBtn.addEventListener("click", () => {
    songSearch.hidden = !songSearch.hidden;
    if (!songSearch.hidden) songQuery.focus();
  });
  songPlay.addEventListener("click", () => {
    if (pendingSong) togglePreview(pendingSong, songPlay);
  });
  songRemove.addEventListener("click", clearPendingSong);

  let songTimer = null;
  songQuery.addEventListener("input", () => {
    clearTimeout(songTimer);
    const q = songQuery.value.trim();
    if (q.length < 2) {
      songResults.textContent = "";
      return;
    }
    songHint("Searching…");
    songTimer = setTimeout(async () => {
      try {
        renderSongResults(await searchSongs(q));
      } catch (err) {
        songHint("Couldn't reach song search — are you online?");
      }
    }, 400);
  });

  // ---- Auth ----
  function activeProfile() {
    return profiles.find((p) => p.id === activeProfileId) || null;
  }

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.hidden = !msg;
  }

  async function loadEntries() {
    const all = await dbGetAll(ENTRIES);
    return all.filter((e) => e.profileId === activeProfileId).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function signIn(id) {
    activeProfileId = id;
    rememberSession(id);
    editingId = null;
    selectedId = null;
    editingProfileId = null;
    expanded = null;
    viewStart = null;
    viewEnd = null;
    profilePanel.hidden = true;
    showAuthError("");
    entries = await loadEntries();
    render();
  }

  function signOut() {
    activeProfileId = null;
    rememberSession(null);
    entries = [];
    expanded = null;
    editingProfileId = null;
    profilePanel.hidden = true;
    authMode = profiles.length ? "login" : "register";
    showAuthError("");
    render();
  }

  async function registerAccount() {
    const name = regName.value.trim().slice(0, 30);
    const pass = regPass.value;
    if (!name) {
      showAuthError("Pick a username.");
      regName.focus();
      return;
    }
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      showAuthError("That username is taken on this device.");
      return;
    }
    if (pass.length < 4) {
      showAuthError("Password needs at least 4 characters.");
      regPass.focus();
      return;
    }
    const passSalt = newId();
    const passHash = await hashPassword(pass, passSalt);
    const p = { id: newId(), name, avatar: pendingRegPic, passSalt, passHash, createdAt: Date.now() };
    await dbPut(PROFILES, p);
    const firstAccount = profiles.length === 0;
    profiles.push(p);
    regName.value = "";
    regPass.value = "";
    pendingRegPic = null;
    regPicBtn.classList.remove("has-pic");
    if (firstAccount) {
      // adopt any entries from before accounts existed
      const all = await dbGetAll(ENTRIES);
      for (const en of all) {
        if (!en.profileId) {
          en.profileId = p.id;
          await dbPut(ENTRIES, en);
        }
      }
    }
    await signIn(p.id);
  }

  regSubmit.addEventListener("click", registerAccount);
  regPass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") registerAccount();
  });
  regPicBtn.addEventListener("click", () => regPic.click());
  regPic.addEventListener("change", async () => {
    const file = regPic.files && regPic.files[0];
    regPic.value = "";
    if (!file) return;
    const blob = await resizeImage(file, 256, 0.85);
    if (!blob) return;
    pendingRegPic = blob;
    regPicBtn.classList.add("has-pic");
  });

  authToggle.addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    expanded = null;
    showAuthError("");
    renderAuth();
  });

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

  // Expanded password prompt under a profile row. verb: button label;
  // danger: style the button red; onSubmit(password) does the work.
  function passwordPrompt(p, verb, danger, onSubmit) {
    const wrap = document.createElement("div");
    wrap.className = "row-action";
    const pass = document.createElement("input");
    pass.type = "password";
    pass.maxLength = 64;
    pass.placeholder = p.passHash ? "password" : "set a password";
    pass.setAttribute("aria-label", "Password for " + p.name);
    const go = document.createElement("button");
    go.className = "primary small" + (danger ? " danger-fill" : "");
    go.type = "button";
    go.textContent = p.passHash ? verb : "Set password & " + verb.toLowerCase();
    const submit = () => onSubmit(pass.value);
    go.addEventListener("click", submit);
    pass.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    wrap.append(pass, go);
    requestAnimationFrame(() => pass.focus());
    return wrap;
  }

  // A legacy profile (no password yet) sets one on its next sign-in.
  async function ensurePassword(p, password) {
    if (p.passHash) return;
    if (password.length < 4) throw new Error("Password needs at least 4 characters.");
    p.passSalt = newId();
    p.passHash = await hashPassword(password, p.passSalt);
    await dbPut(PROFILES, p);
  }

  async function trySignIn(p, password, errorTo) {
    try {
      if (!p.passHash) {
        await ensurePassword(p, password);
      } else if (!(await checkPassword(p, password))) {
        errorTo("Wrong password.");
        return;
      }
      await signIn(p.id);
    } catch (err) {
      errorTo(err.message || "Something went wrong.");
    }
  }

  function renderAuth() {
    revokeUrls();
    const registering = authMode === "register" || profiles.length === 0;
    let heading = registering ? "Create your account" : "Who's tweaking?";
    if (!registering && expanded) {
      const ep = profiles.find((p) => p.id === expanded.id);
      if (ep && !ep.passHash) heading = "Set a password to continue";
    }
    authHeading.textContent = heading;
    authLogin.hidden = registering;
    authRegister.hidden = !registering;
    authToggle.hidden = profiles.length === 0;
    authToggle.textContent = registering ? "Back to log in" : "New account";

    if (!registering) {
      authList.textContent = "";
      for (const p of profiles) {
        const li = document.createElement("li");
        li.className = "profile-row";
        const main = document.createElement("div");
        main.className = "profile-main";
        main.addEventListener("click", () => {
          expanded = expanded && expanded.id === p.id ? null : { id: p.id, action: "switch" };
          showAuthError("");
          renderAuth();
        });
        main.appendChild(avatarNode(p, "avatar-sm"));
        const name = document.createElement("span");
        name.className = "profile-name";
        name.textContent = p.name;
        main.appendChild(name);
        li.appendChild(main);
        if (expanded && expanded.id === p.id) {
          li.appendChild(passwordPrompt(p, "Log in", false, (pw) => trySignIn(p, pw, showAuthError)));
        }
        authList.appendChild(li);
      }
    }
  }

  // ---- Profile panel (signed in) ----
  profileBtn.addEventListener("click", () => {
    profilePanel.hidden = !profilePanel.hidden;
    if (!profilePanel.hidden) {
      editingProfileId = null;
      expanded = null;
      renderProfiles();
    }
  });

  panelNew.addEventListener("click", () => {
    signOut();
    authMode = "register";
    renderAuth();
  });

  panelSignOut.addEventListener("click", signOut);

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
    profileBtn.setAttribute("aria-label", "Accounts — signed in as " + (p.name || "?"));
  }

  function renderProfiles() {
    profileList.textContent = "";
    for (const p of profiles) {
      profileList.appendChild(profileRow(p));
    }
  }

  function panelError(li) {
    return (msg) => {
      let err = li.querySelector(".auth-error");
      if (!err) {
        err = document.createElement("p");
        err.className = "auth-error";
        li.appendChild(err);
      }
      err.textContent = msg;
      err.hidden = !msg;
    };
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
      if (p.id === activeProfileId) return;
      expanded = expanded && expanded.id === p.id && expanded.action === "switch" ? null : { id: p.id, action: "switch" };
      renderProfiles();
    });

    main.appendChild(avatarNode(p, "avatar-sm"));

    const name = document.createElement("span");
    name.className = "profile-name";
    name.textContent = p.name;
    main.appendChild(name);

    if (p.id === activeProfileId) {
      const dot = document.createElement("span");
      dot.className = "active-dot";
      dot.setAttribute("aria-label", "Signed in");
      main.appendChild(dot);

      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn";
      editBtn.type = "button";
      editBtn.setAttribute("aria-label", "Edit profile " + p.name);
      editBtn.innerHTML = ICON_EDIT;
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        editingProfileId = p.id;
        expanded = null;
        renderProfiles();
      });
      main.appendChild(editBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", "Delete account " + p.name);
    delBtn.innerHTML = ICON_DELETE;
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded = expanded && expanded.id === p.id && expanded.action === "delete" ? null : { id: p.id, action: "delete" };
      renderProfiles();
    });
    main.appendChild(delBtn);

    li.appendChild(main);

    if (expanded && expanded.id === p.id) {
      const errorTo = panelError(li);
      if (expanded.action === "switch") {
        li.appendChild(passwordPrompt(p, "Switch", false, (pw) => trySignIn(p, pw, errorTo)));
      } else if (expanded.action === "delete") {
        const label = document.createElement("p");
        label.className = "row-warning";
        label.textContent = "Deletes this account and its whole log. Password to confirm:";
        li.appendChild(label);
        li.appendChild(
          passwordPrompt(p, "Delete", true, async (pw) => {
            if (p.passHash && !(await checkPassword(p, pw))) {
              errorTo("Wrong password.");
              return;
            }
            const all = await dbGetAll(ENTRIES);
            for (const en of all) if (en.profileId === p.id) await dbDelete(ENTRIES, en.id);
            await dbDelete(PROFILES, p.id);
            profiles = profiles.filter((x) => x.id !== p.id);
            expanded = null;
            if (activeProfileId === p.id) {
              signOut();
            } else {
              renderProfiles();
            }
          })
        );
      }
    }
    return li;
  }

  function profileEditForm(p) {
    const form = document.createElement("div");
    form.className = "profile-edit";
    let newPic; // undefined = keep, blob = replace

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
    name.setAttribute("aria-label", "Username");

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
      if (n && !profiles.some((x) => x.id !== p.id && x.name.toLowerCase() === n.toLowerCase())) p.name = n;
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

  // ---- Logging ----
  let doneTimer = null;

  async function logEntry() {
    if (!activeProfileId) return;
    const entry = {
      id: newId(),
      profileId: activeProfileId,
      level: round1(Number(levelInput.value)),
      note: noteInput.value.trim().slice(0, 2000),
      photo: pendingPhoto,
      song: pendingSong,
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
    autosize(noteInput);
    levelInput.value = "5";
    clearPendingPhoto();
    clearPendingSong();
    songSearch.hidden = true;
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
    const vis = visibleEntries();
    if (entries.length && !vis.length) {
      const li = document.createElement("li");
      li.className = "range-empty";
      li.textContent = "Nothing logged in this range.";
      listEl.appendChild(li);
      return;
    }
    for (const entry of vis) {
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
    if (entry.song) {
      const songLine = document.createElement("button");
      songLine.className = "song-line";
      songLine.type = "button";
      songLine.setAttribute("aria-label", "Play song preview");
      const ico = document.createElement("span");
      ico.className = "song-ico";
      ico.innerHTML = ICON_MUSIC;
      const art = document.createElement("img");
      art.className = "song-art";
      art.alt = "";
      if (entry.song.art) art.src = entry.song.art;
      else art.hidden = true;
      art.addEventListener("error", () => (art.hidden = true));
      const label = document.createElement("span");
      label.className = "song-label";
      label.textContent = entry.song.title + " · " + entry.song.artist;
      const play = document.createElement("span");
      play.className = "song-ico";
      play.innerHTML = ICON_PLAY;
      if (entry.song.art) songLine.append(art, label, play);
      else songLine.append(ico, label, play);
      songLine.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePreview(entry.song, play);
      });
      body.appendChild(songLine);
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

    const note = document.createElement("textarea");
    note.maxLength = 2000;
    note.rows = 1;
    note.placeholder = "note (optional)";
    note.value = entry.note || "";
    note.addEventListener("input", () => autosize(note));
    requestAnimationFrame(() => autosize(note));

    let removePhoto = false;
    let removeSong = false;
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
    if (entry.song) {
      const dropSong = document.createElement("button");
      dropSong.className = "ghost small";
      dropSong.type = "button";
      dropSong.textContent = "Remove song";
      dropSong.addEventListener("click", () => {
        removeSong = !removeSong;
        dropSong.textContent = removeSong ? "Song will be removed" : "Remove song";
      });
      actions.appendChild(dropSong);
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
      entry.note = note.value.trim().slice(0, 2000);
      if (removePhoto) entry.photo = null;
      if (removeSong) entry.song = null;
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
  const MIN_SPAN = 30 * 60e3; // zoom floor: half an hour
  let chartGeom = null; // current svg metrics, for gesture math
  let chartApi = null; // tap-to-tooltip hook for the gesture layer

  function renderChart() {
    chartEl.textContent = "";
    const old = chartEl.parentElement.querySelector(".chart-tip");
    if (old) old.remove();
    chartGeom = null;
    chartApi = null;
    if (!entries.length) return;

    const [f0, f1] = fullWindow();
    const t0 = viewStart != null ? viewStart : f0;
    const t1 = viewStart != null ? viewEnd : f1;

    const pts = [...entries].sort((a, b) => a.createdAt - b.createdAt);
    const width = Math.max(chartEl.clientWidth || 320, 200);
    const plotW = width - M.left - M.right;
    const plotH = CHART_H - M.top - M.bottom;

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

    // clip marks to the plot area so panned-out points don't spill
    const clip = el("clipPath", { id: "plot-clip" });
    el("rect", { x: M.left - 8, y: 0, width: plotW + 16, height: M.top + plotH + 8 }, clip);
    const marks = el("g", { "clip-path": "url(#plot-clip)" });

    // indices inside the window (the line keeps one neighbor each side)
    const coords = pts.map((p) => [x(p.createdAt), y(p.level)]);
    let i0 = pts.findIndex((p) => p.createdAt >= t0);
    if (i0 === -1) i0 = pts.length;
    let i1 = pts.length - 1;
    while (i1 >= 0 && pts[i1].createdAt > t1) i1--;
    const winIdx = [];
    for (let i = i0; i <= i1; i++) winIdx.push(i);

    const a = Math.max(0, i0 - 1);
    const b = Math.min(pts.length - 1, i1 + 1);
    if (b > a) {
      const seg = coords.slice(a, b + 1);
      const line = seg.map((c, i) => (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" ");
      el("path", {
        d: `${line} L ${seg[seg.length - 1][0].toFixed(1)} ${y(1)} L ${seg[0][0].toFixed(1)} ${y(1)} Z`,
        fill: css("wash"),
      }, marks);
      el("path", {
        d: line,
        fill: "none",
        stroke: css("accent"),
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }, marks);
    }

    // dots (skip when dense, keep the endpoint)
    const dotIdx = winIdx.length <= 60 ? winIdx : [winIdx[winIdx.length - 1]];
    for (const i of dotIdx) {
      el("circle", { cx: coords[i][0], cy: coords[i][1], r: 4, fill: css("accent"), stroke: css("surface"), "stroke-width": 2 }, marks);
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

    // a selected list entry stays pinned on the chart (when in the window)
    const pinnedIdx = selectedId ? winIdx.find((i) => pts[i].id === selectedId) ?? -1 : -1;

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
      if (!winIdx.length) return -1;
      const rect = svg.getBoundingClientRect();
      const scale = width / rect.width;
      const px = (clientX - rect.left) * scale;
      let best = winIdx[0];
      for (const i of winIdx) {
        if (Math.abs(coords[i][0] - px) < Math.abs(coords[best][0] - px)) best = i;
      }
      return best;
    }

    function hide() {
      cross.setAttribute("visibility", "hidden");
      focusDot.setAttribute("visibility", "hidden");
      tip.hidden = true;
    }

    hit.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || activePtrs.size) return;
      const i = nearestIndex(e.clientX);
      if (i >= 0) showIndex(i);
    });
    hit.addEventListener("pointerleave", () => (pinnedIdx >= 0 ? showIndex(pinnedIdx) : hide()));

    chartEl.appendChild(svg);
    chartGeom = { svg, width, plotW, left: M.left, t0, t1 };
    chartApi = {
      tapAt: (clientX) => {
        const i = nearestIndex(clientX);
        if (i >= 0) showIndex(i);
      },
    };
    if (pinnedIdx >= 0) showIndex(pinnedIdx);
  }

  // ---- Chart gestures: drag to pan, pinch (or ctrl+wheel) to zoom ----
  const chartCard = document.querySelector(".chart-card");
  const activePtrs = new Map();
  let panMode = false;
  let panLastX = 0;
  let tapStart = null;
  let pinchLast = null;
  let listDirty = false;
  let chartRaf = false;
  let wheelTimer = null;

  function currentWindow() {
    return viewStart != null ? [viewStart, viewEnd] : fullWindow();
  }

  function setWindow(vs, ve) {
    const [f0, f1] = fullWindow();
    const extent = Math.max(f1 - f0, MIN_SPAN);
    let span = ve - vs;
    if (span < MIN_SPAN) {
      const c = (vs + ve) / 2;
      vs = c - MIN_SPAN / 2;
      ve = c + MIN_SPAN / 2;
      span = MIN_SPAN;
    }
    if (span > extent * 1.15) {
      const c = (vs + ve) / 2;
      span = extent * 1.15;
      vs = c - span / 2;
      ve = c + span / 2;
    }
    // keep the window's center over the data so you can always pan back
    const c = (vs + ve) / 2;
    if (c < f0) { vs += f0 - c; ve += f0 - c; }
    if (c > f1) { vs -= c - f1; ve -= c - f1; }
    if (vs <= f0 && ve >= f1) {
      viewStart = null;
      viewEnd = null;
    } else {
      viewStart = vs;
      viewEnd = ve;
    }
    listDirty = true;
    if (!chartRaf) {
      chartRaf = true;
      requestAnimationFrame(() => {
        chartRaf = false;
        renderChart();
        renderTrendHead();
      });
    }
  }

  function flushList() {
    if (!listDirty) return;
    listDirty = false;
    renderList();
  }

  // Read the SVG's box live each time — layout can shift between the render
  // that built the chart and the gesture that drives it.
  function timeAtClientX(clientX) {
    const g = chartGeom;
    const rect = g.svg.getBoundingClientRect();
    const [vs, ve] = currentWindow();
    const px = (clientX - rect.left) * (g.width / rect.width);
    return vs + ((px - g.left) / g.plotW) * (ve - vs);
  }

  function panByPx(dxClient) {
    const g = chartGeom;
    if (!g) return;
    const rect = g.svg.getBoundingClientRect();
    const [vs, ve] = currentWindow();
    const dt = (-(dxClient * (g.width / rect.width)) / g.plotW) * (ve - vs);
    setWindow(vs + dt, ve + dt);
  }

  function zoomAround(clientX, factor) { // factor > 1 zooms in
    if (!chartGeom) return;
    const [vs, ve] = currentWindow();
    const tc = timeAtClientX(clientX);
    setWindow(tc - (tc - vs) / factor, tc + (ve - tc) / factor);
  }

  function resetView() {
    viewStart = null;
    viewEnd = null;
    listDirty = false;
    render();
  }
  trendReset.addEventListener("click", resetView);
  chartCard.addEventListener("dblclick", resetView);

  function pinchState() {
    const [p, q] = [...activePtrs.values()];
    return { dist: Math.max(20, Math.hypot(p.x - q.x, p.y - q.y)), cx: (p.x + q.x) / 2 };
  }

  chartCard.addEventListener("pointerdown", (e) => {
    if (!chartGeom) return;
    chartCard.setPointerCapture(e.pointerId);
    activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePtrs.size === 1) {
      panMode = false;
      panLastX = e.clientX;
      tapStart = { x: e.clientX, y: e.clientY };
    } else if (activePtrs.size === 2) {
      pinchLast = pinchState();
      tapStart = null;
      panMode = false;
    }
  });

  chartCard.addEventListener("pointermove", (e) => {
    if (!activePtrs.has(e.pointerId)) return;
    activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePtrs.size === 2) {
      const now = pinchState();
      if (pinchLast) {
        panByPx(now.cx - pinchLast.cx);
        zoomAround(now.cx, now.dist / pinchLast.dist);
      }
      pinchLast = now;
    } else if (activePtrs.size === 1) {
      const dx = e.clientX - panLastX;
      if (!panMode && tapStart && Math.abs(e.clientX - tapStart.x) > 6) panMode = true;
      if (panMode) {
        panByPx(dx);
        panLastX = e.clientX;
      }
    }
  });

  function endPointer(e, maybeTap) {
    if (!activePtrs.has(e.pointerId)) return;
    activePtrs.delete(e.pointerId);
    if (activePtrs.size === 1) {
      pinchLast = null;
      const [p] = activePtrs.values();
      panLastX = p.x;
      panMode = true;
      tapStart = null;
    } else if (activePtrs.size === 0) {
      if (maybeTap && !panMode && tapStart && chartApi) chartApi.tapAt(tapStart.x);
      panMode = false;
      tapStart = null;
      pinchLast = null;
      flushList();
    }
  }
  chartCard.addEventListener("pointerup", (e) => endPointer(e, true));
  chartCard.addEventListener("pointercancel", (e) => endPointer(e, false));

  chartCard.addEventListener("wheel", (e) => {
    if (!chartGeom || !e.ctrlKey) return; // plain scroll keeps scrolling the page
    e.preventDefault();
    zoomAround(e.clientX, Math.exp(-e.deltaY * 0.005));
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(flushList, 200);
  }, { passive: false });

  // ---- Render ----
  function render() {
    const authed = !!activeProfile();
    authEl.hidden = authed;
    appEl.hidden = !authed;
    profileBtn.hidden = !authed;
    if (!authed) {
      renderAuth();
      return;
    }
    const has = entries.length > 0;
    historyEl.hidden = !has;
    emptyEl.hidden = has;
    renderTrendHead();
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
  setInterval(() => {
    if (activeProfile()) renderList(); // keep relative times fresh
  }, 60e3);

  // ---- Boot ----
  (async () => {
    try {
      profiles = await dbGetAll(PROFILES);
      // adopt any entries from before accounts existed
      if (profiles.length) {
        const all = await dbGetAll(ENTRIES);
        for (const en of all) {
          if (!en.profileId) {
            en.profileId = profiles[0].id;
            await dbPut(ENTRIES, en);
          }
        }
      }
      const remembered = recallSession();
      const rememberedProfile = profiles.find((p) => p.id === remembered);
      if (rememberedProfile && rememberedProfile.passHash) {
        activeProfileId = remembered;
        entries = await loadEntries();
      } else {
        activeProfileId = null;
        authMode = profiles.length ? "login" : "register";
        // an account from before passwords existed must set one right now,
        // not on some later sign-out — drop it on its set-password prompt
        if (rememberedProfile) expanded = { id: rememberedProfile.id, action: "switch" };
      }
    } catch (err) {
      profiles = [];
      entries = [];
      activeProfileId = null;
      authMode = "register";
    }
    render();
  })();

  // ---- Add to home screen ----
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    installAction.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    installAction.hidden = true;
    installGuide.hidden = true;
  });
  installLink.addEventListener("click", () => {
    installGuide.hidden = !installGuide.hidden;
    if (!installGuide.hidden) installGuide.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  // already on the home screen — nothing to add
  if ((window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone) {
    installLink.hidden = true;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
