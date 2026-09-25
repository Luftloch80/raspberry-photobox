(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const video = $("video");
  const shutter = $("shutter");
  const countdownEl = $("countdown");
  const flash = $("flash");
  const thumbs = $("thumbs");
  const viewer = $("viewer");
  const viewerImg = $("viewerImg");
  const printBtn = $("printBtn");
  const retryUploadBtn = $("retryUploadBtn");
  const toastEl = $("toast");

  // ---------------------------------------------------------------------
  // Einstellungen (pro Gerät gespeichert)
  // ---------------------------------------------------------------------

  const defaults = { countdown: 3, mirror: true, autoPrint: false };
  const SERIES = 4;              // immer 4 Fotos hintereinander
  const TIMERS = [3, 5];         // wählbarer Countdown in Sekunden
  const REVIEW_MS = 2000;        // Fotos nach der Serie so lange zeigen, bevor die Druckansicht kommt
  const settings = Object.assign({}, defaults, loadSettings());
  const FACING = "user"; // immer die Frontkamera (Selfie)
  delete settings.camera; // frühere Einstellungen, nicht mehr verwendet
  delete settings.clearOld;
  delete settings.burst;
  if (!TIMERS.includes(settings.countdown)) settings.countdown = 3;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem("photobox-settings")) || {}; }
    catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem("photobox-settings", JSON.stringify(settings)); }
    catch (e) { /* privates Surfen – egal */ }
  }

  // ---------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------

  let toastTimer;
  function toast(msg, type = "", ms = 3500) {
    toastEl.textContent = msg;
    toastEl.className = "toast " + type;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, Object.assign({ credentials: "same-origin" }, options));
    let data = null;
    try { data = await res.json(); } catch (e) { /* kein JSON */ }
    if (!res.ok) throw new Error((data && data.error) || `Fehler ${res.status}`);
    return data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------
  // Kamera
  // ---------------------------------------------------------------------

  let stream = null;

  // Als App vom Home-Bildschirm gestartet?
  const standalone = window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;

  let cameraRun = 0; // verhindert, dass ein älterer Startversuch einen neueren überschreibt

  function requestStream() {
    const tries = [
      { audio: false, video: { facingMode: FACING, width: { ideal: 1920 }, height: { ideal: 1440 } } },
      { audio: false, video: { facingMode: FACING } },
      { audio: false, video: true },
    ];
    // Nacheinander probieren; abgelehnte Berechtigung sofort weitergeben
    return tries.reduce((p, c) => p.catch((err) => {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw err;
      return navigator.mediaDevices.getUserMedia(c);
    }), Promise.reject(new Error("start")));
  }

  function showCameraButton(text, label, action) {
    $("cameraHintText").textContent = text;
    const retry = $("cameraRetry");
    retry.textContent = label;
    retry.onclick = action;
    retry.hidden = false;
  }

  async function startCamera() {
    const run = ++cameraRun;
    const hint = $("cameraHint");
    const hintText = $("cameraHintText");
    shutter.disabled = true;
    hint.hidden = false;
    $("cameraRetry").hidden = true;
    hintText.textContent = "Kamera wird gestartet …";

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hintText.textContent = "Die Kamera funktioniert nur über HTTPS. Bitte die Photobox über die https://-Adresse öffnen.";
      return;
    }

    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;

    // iPadOS-Web-Apps vom Home-Bildschirm beantworten die Kamera-Anfrage beim
    // Start manchmal nie. Dann nach kurzer Zeit einen Knopf anbieten – ein
    // Tippen darauf startet die Anfrage neu.
    const timer = setTimeout(() => {
      if (run === cameraRun && !stream) {
        showCameraButton("Die Kamera braucht einen Fingertipp zum Starten.", "📷 Kamera starten", startCamera);
      }
    }, 3000);

    try {
      const s = await requestStream();
      clearTimeout(timer);
      if (run !== cameraRun) {
        s.getTracks().forEach((t) => t.stop()); // ein neuerer Versuch ist schon unterwegs
        return;
      }
      stream = s;
      video.srcObject = stream;
      video.classList.toggle("mirror", settings.mirror);
      await playVideo();
    } catch (err) {
      clearTimeout(timer);
      if (run !== cameraRun) return;
      console.error(err);
      const name = err && err.name;
      const denied = standalone
        ? "Kamerazugriff wurde verweigert. Die Photobox-App schließen (vom unteren Rand hochwischen) und neu öffnen, dann bei der Frage „Erlauben“ tippen."
        : "Kamerazugriff wurde verweigert. Bitte erlauben: aA in der Adressleiste → Website-Einstellungen → Kamera → Erlauben. Danach neu laden.";
      showCameraButton(
        name === "NotAllowedError" ? denied
          : name === "NotReadableError" ? "Die Kamera wird gerade von einer anderen App benutzt. Bitte andere Apps schließen."
          : "Kamera konnte nicht gestartet werden: " + ((err && (name ? name + " – " : "") + err.message) || err),
        "Erneut versuchen", startCamera);
    }
  }

  // Video abspielen; blockiert Safari den automatischen Start, per Tippen starten
  async function playVideo() {
    const hint = $("cameraHint");
    const retry = $("cameraRetry");
    try {
      await video.play();
    } catch (err) {
      $("cameraHintText").textContent = "Zum Starten der Kamera tippen";
      retry.textContent = "Kamera starten";
      retry.onclick = () => playVideo();
      retry.hidden = false;
      return;
    }
    // Warten, bis tatsächlich Bilder ankommen
    for (let i = 0; i < 50 && !video.videoWidth; i++) await sleep(100);
    if (!video.videoWidth) {
      $("cameraHintText").textContent = "Die Kamera liefert kein Bild.";
      retry.textContent = "Erneut versuchen";
      retry.onclick = startCamera;
      retry.hidden = false;
      return;
    }
    hint.hidden = true;
    shutter.disabled = false;
  }


  // Beim Zurückkehren in den Tab (z. B. nach Sperrbildschirm) Kamera neu starten
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const live = stream && stream.getVideoTracks().some((t) => t.readyState === "live");
      if (!live) startCamera();
      requestWakeLock();
    }
  });

  // Bildschirm eingeschaltet lassen (Safari ab iPadOS 16.4)
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) { /* nicht unterstützt */ }
  }

  // ---------------------------------------------------------------------
  // Aufnahme
  // ---------------------------------------------------------------------

  let busy = false;

  async function runCountdown(seconds) {
    countdownEl.hidden = false;
    for (let i = seconds; i > 0; i--) {
      countdownEl.textContent = i;
      countdownEl.classList.remove("tick");
      void countdownEl.offsetWidth; // Animation neu starten
      countdownEl.classList.add("tick");
      await sleep(1000);
    }
    countdownEl.hidden = true;
  }

  function grabFrame() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (settings.mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  }

  // Fotos der vorherigen Gäste endgültig löschen, bevor eine neue Serie beginnt
  async function deleteOldPhotos() {
    await deletePhotos(photos.map((p) => p.id));
  }

  function showShotLabel(text) {
    const el = $("shotLabel");
    el.textContent = text || "";
    el.hidden = !text;
  }

  // Ein Foto bzw. eine Serie von bis zu 4 Fotos aufnehmen
  async function takePhoto() {
    if (busy || shutter.disabled) return;
    busy = true;
    shutter.disabled = true;
    document.body.classList.add("shooting");
    requestWakeLock();
    const total = SERIES;
    const items = [];
    try {
      await deleteOldPhotos();
      for (let i = 0; i < total; i++) {
        if (total > 1) showShotLabel(`Foto ${i + 1} von ${total}`);
        await runCountdown(settings.countdown);
        const blob = await grabFrame();
        flash.classList.remove("on");
        void flash.offsetWidth;
        flash.classList.add("on");
        if (!blob) throw new Error("Foto konnte nicht erstellt werden");
        const item = { localUrl: URL.createObjectURL(blob), blob, isNew: true };
        items.push(item);
        uploadItem(item); // speichert im Hintergrund, während die Serie weiterläuft
        if (i < total - 1) await sleep(800);
      }
      // Die fertigen Fotos erst ein paar Sekunden in der Galerie zeigen
      showShotLabel("");
      if (items.length) await sleep(REVIEW_MS);
    } catch (err) {
      toast(err.message || String(err), "error");
    } finally {
      showShotLabel("");
      countdownEl.hidden = true;
      document.body.classList.remove("shooting");
      busy = false;
      shutter.disabled = false;
    }
    if (items.length) {
      openViewer(items, 0);
      if (settings.autoPrint) autoPrint(items);
    }
  }

  shutter.addEventListener("click", takePhoto);

  // Auslösen auch per Bluetooth-Fernauslöser / Tastatur (Leertaste, Enter, Lautstärke-Tasten senden oft Enter)
  // Tasten, die Bluetooth-Auslöser, Präsentations-Fernbedienungen und Fußpedale senden.
  // (Die Lauter-Taste von Kamera-Auslösern kommt unter iPadOS nicht bei Webseiten an.)
  const TRIGGER_KEYS = new Set([
    " ", "Enter", "PageDown", "PageUp", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp",
    "MediaPlayPause", "MediaTrackNext", "AudioVolumeUp", "AudioVolumeDown", "b", "B", ".",
  ]);

  document.addEventListener("keydown", (e) => {
    const isTrigger = TRIGGER_KEYS.has(e.key);
    if (!$("settings").hidden) {
      // Tastentest in den Einstellungen
      const t = $("keyTest");
      t.textContent = `Erkannt: „${e.key === " " ? "Leertaste" : e.key}“ – ` +
        (isTrigger ? "löst ein Foto aus ✓" : "wird nicht als Auslöser verwendet");
      t.className = "key-test " + (isTrigger ? "ok" : "no");
      return;
    }
    if (!isTrigger || e.repeat) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.preventDefault();
    if (busy) return;
    if (!$("guide").hidden) closeGuide();
    // In der Fotoansicht: zurück zur Kamera und gleich das nächste Foto
    if (!viewer.hidden) closeViewer();
    takePhoto();
  });

  // ---------------------------------------------------------------------
  // Galerie
  // ---------------------------------------------------------------------

  let photos = [];

  async function loadPhotos() {
    try {
      photos = await api("/api/photos");
      renderThumbs();
    } catch (err) {
      toast("Fotos konnten nicht geladen werden: " + err.message, "error");
    }
  }

  function renderThumbs() {
    thumbs.innerHTML = "";
    for (const p of [...photos].reverse()) {
      const btn = document.createElement("button");
      const img = document.createElement("img");
      img.src = p.thumb;
      img.loading = "lazy";
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", () => openViewer([{ photo: p }], 0));
      thumbs.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------------
  // Großansicht, Speichern & Drucken
  // ---------------------------------------------------------------------

  let series = [];   // Fotos in der Großansicht: [{ photo?, blob?, localUrl?, isNew, uploadFailed? }]
  let current = null; // gerade angezeigtes Foto aus series
  let idleTimer;
  let printing = null; // laufender Druckauftrag (Promise)
  const strip = $("viewerStrip");

  // Nach 30 s zurück zur Kamera (läuft durch, auch beim Drucken) – Countdown links neben „Drucken“
  const VIEWER_SECONDS = 30;
  const RING = 2 * Math.PI * 28; // Umfang des Countdown-Rings
  let idleLeft = VIEWER_SECONDS;

  function renderIdle() {
    $("viewerCountdownNum").textContent = idleLeft;
    $("viewerCountdownRing").style.strokeDashoffset = RING * (1 - idleLeft / VIEWER_SECONDS);
    $("viewerCountdown").setAttribute("aria-label", `Zurück zur Kamera in ${idleLeft} Sekunden`);
  }

  function resetIdle() {
    clearInterval(idleTimer);
    idleLeft = VIEWER_SECONDS;
    renderIdle();
    idleTimer = setInterval(() => {
      idleLeft -= 1;
      renderIdle();
      if (idleLeft <= 0) closeViewer();
    }, 1000);
  }

  // Gedruckt wird immer die ganze Serie (1 Abzug je Foto)
  function updateViewerButtons() {
    const printed = series.length && series.every((it) => it.printed);
    printBtn.disabled = printed || !series.length || !series.every((it) => it.photo);
    $("printLabel").textContent = printed ? "Gedruckt ✓" : "Drucken";
    retryUploadBtn.hidden = !series.some((it) => it.uploadFailed && !it.photo);
  }

  function renderStrip() {
    strip.replaceChildren();
    series.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      if (it === current) b.className = "active";
      const img = document.createElement("img");
      img.src = it.localUrl || it.photo.thumb;
      img.alt = `Foto ${i + 1}`;
      b.appendChild(img);
      b.addEventListener("click", () => showItem(i));
      strip.appendChild(b);
    });
  }

  function showItem(i) {
    current = series[i];
    viewerImg.src = current.localUrl || current.photo.url;
    renderStrip();
    updateViewerButtons();
  }

  function openViewer(items, index = 0) {
    releaseSeries();
    series = items;
    showItem(index);
    viewer.hidden = false;
    resetIdle();
  }

  function releaseSeries() {
    for (const it of series) if (it.localUrl && it.photo) { URL.revokeObjectURL(it.localUrl); it.localUrl = null; }
  }

  function closeViewer() {
    clearInterval(idleTimer);
    viewer.hidden = true;
    // Neu aufgenommene Fotos werden beim Verlassen gelöscht – ob gedruckt oder nicht
    const taken = series.filter((it) => it.isNew);
    for (const it of taken) it.discard = true; // noch nicht hochgeladene: nach dem Upload löschen
    const ids = taken.filter((it) => it.photo).map((it) => it.photo.id);
    // Läuft gerade ein Druckauftrag, erst danach löschen (der Server braucht die Fotos noch)
    Promise.resolve(printing).finally(() => deletePhotos(ids));
    releaseSeries();
    series = [];
    current = null;
  }

  // Fotos auf dem Pi endgültig löschen und aus der Galerie nehmen
  async function deletePhotos(ids) {
    if (!ids.length) return;
    photos = photos.filter((p) => !ids.includes(p.id));
    renderThumbs();
    try {
      await api("/api/photos/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      console.warn("Fotos konnten nicht gelöscht werden", err);
    }
  }

  async function uploadItem(item) {
    if (!item || !item.blob) return;
    item.uploadFailed = false;
    if (series.includes(item)) updateViewerButtons();
    const form = new FormData();
    form.append("photo", item.blob, "photo.jpg");
    try {
      const photo = await api("/api/photos", { method: "POST", body: form });
      item.photo = photo;
      item.blob = null;
      if (item.discard) {
        // Ansicht wurde ohne Drucken verlassen, bevor das Foto gespeichert war
        deletePhotos([photo.id]);
        return;
      }
      photos.unshift(photo);
      renderThumbs();
      if (series.includes(item)) updateViewerButtons();
    } catch (err) {
      item.uploadFailed = true;
      if (series.includes(item)) updateViewerButtons();
      toast("Foto konnte nicht gespeichert werden: " + err.message, "error", 6000);
    }
  }

  // Automatisch drucken, sobald alle Fotos der Serie gespeichert sind
  async function autoPrint(items) {
    for (let i = 0; i < 60 && !items.every((it) => it.photo || it.uploadFailed); i++) await sleep(250);
    if (items.every((it) => it.photo) && !items.every((it) => it.printed)) printItems(items);
  }

  // Die ganze Serie als Fotostreifen drucken (ein Druckauftrag)
  function printItems(items) {
    printing = sendPrint(items).finally(() => { printing = null; });
    return printing;
  }

  async function sendPrint(items) {
    const saved = items.filter((it) => it.photo);
    if (!saved.length) return;
    printBtn.disabled = true;
    try {
      await api("/api/print-strip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: saved.map((it) => it.photo.id) }),
      });
      for (const it of saved) it.printed = true;
      toast("Wird gedruckt 🖨️", "ok");
    } catch (err) {
      toast("Drucken fehlgeschlagen: " + err.message, "error", 6000);
    }
    updateViewerButtons();
  }


  printBtn.addEventListener("click", () => printItems(series.filter((it) => !it.printed)));
  retryUploadBtn.addEventListener("click", () => series.filter((it) => it.uploadFailed && !it.photo).forEach(uploadItem));
  $("closeViewer").addEventListener("click", closeViewer);
  viewer.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });

  // ---------------------------------------------------------------------
  // Einstellungsdialog
  // ---------------------------------------------------------------------

  const settingsModal = $("settings");
  $("settingsBtn").addEventListener("click", () => {
    $("setMirror").checked = settings.mirror;
    $("setAutoPrint").checked = settings.autoPrint;
    settingsModal.hidden = false;
  });
  $("closeSettings").addEventListener("click", () => {
    settings.mirror = $("setMirror").checked;
    settings.autoPrint = $("setAutoPrint").checked;
    saveSettings();
    video.classList.toggle("mirror", settings.mirror);
    settingsModal.hidden = true;
  });

  // ---------------------------------------------------------------------
  // Anleitung für Gäste: Timer und Anzahl Fotos
  // ---------------------------------------------------------------------

  const guide = $("guide");

  function renderGuide() {
    for (const b of $("guideTimer").children) b.classList.toggle("active", Number(b.dataset.v) === settings.countdown);
  }

  function closeGuide() {
    guide.hidden = true;
  }

  for (const [id, key] of [["guideTimer", "countdown"]]) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      settings[key] = Number(b.dataset.v);
      saveSettings();
      renderGuide();
    });
  }
  $("guideBtn").addEventListener("click", () => { renderGuide(); guide.hidden = false; });
  $("guideClose").addEventListener("click", closeGuide);
  $("guideShutter").addEventListener("click", () => {
    if (shutter.disabled && !busy) {
      toast("Die Kamera ist noch nicht bereit", "error");
      return;
    }
    closeGuide();
    takePhoto();
  });
  guide.addEventListener("click", (e) => { if (e.target === guide) closeGuide(); });
  renderGuide();

  // iOS: Pinch-Zoom verhindern (Doppeltipp-Zoom verhindert touch-action im CSS)
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  startCamera();
  loadPhotos();
  setInterval(loadPhotosIfIdle, 60000);
  requestWakeLock();

  // Fotos, die auf anderen Geräten gemacht wurden, regelmäßig nachladen
  function loadPhotosIfIdle() {
    if (viewer.hidden && !busy) loadPhotos();
  }
})();
