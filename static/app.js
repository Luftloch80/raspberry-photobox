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
  const copiesEl = $("copies");
  const printBtn = $("printBtn");
  const retryUploadBtn = $("retryUploadBtn");
  const deleteBtn = $("deleteBtn");
  const toastEl = $("toast");
  const maxCopies = (window.PHOTOBOX && window.PHOTOBOX.maxCopies) || 4;

  // ---------------------------------------------------------------------
  // Einstellungen (pro Gerät gespeichert)
  // ---------------------------------------------------------------------

  const defaults = { camera: "user", countdown: 3, mirror: true, autoPrint: false };
  const settings = Object.assign({}, defaults, loadSettings());

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

  async function startCamera() {
    const hint = $("cameraHint");
    const hintText = $("cameraHintText");
    const retry = $("cameraRetry");
    shutter.disabled = true;
    hint.hidden = false;
    retry.hidden = true;
    hintText.textContent = "Kamera wird gestartet …";

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hintText.textContent = "Die Kamera funktioniert nur über HTTPS. Bitte die Photobox über die https://-Adresse öffnen.";
      return;
    }

    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: settings.camera,
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });
      } catch (err) {
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw err;
        // Manche Geräte mögen die Auflösungswünsche nicht – ohne Vorgaben erneut versuchen
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: settings.camera } })
          .catch(() => navigator.mediaDevices.getUserMedia({ audio: false, video: true }));
      }
      video.srcObject = stream;
      video.classList.toggle("mirror", settings.mirror);
      await playVideo();
    } catch (err) {
      console.error(err);
      const name = err && err.name;
      hintText.textContent = name === "NotAllowedError"
        ? "Kamerazugriff wurde verweigert. Bitte erlauben: aA in der Adressleiste → Website-Einstellungen → Kamera → Erlauben. Danach neu laden."
        : name === "NotReadableError"
          ? "Die Kamera wird gerade von einer anderen App benutzt. Bitte andere Apps schließen."
          : "Kamera konnte nicht gestartet werden: " + ((err && (name ? name + " – " : "") + err.message) || err);
      retry.textContent = "Erneut versuchen";
      retry.onclick = startCamera;
      retry.hidden = false;
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

  async function takePhoto() {
    if (busy || shutter.disabled) return;
    busy = true;
    shutter.disabled = true;
    requestWakeLock();
    try {
      if (settings.countdown > 0) await runCountdown(settings.countdown);
      const blob = await grabFrame();
      flash.classList.remove("on");
      void flash.offsetWidth;
      flash.classList.add("on");
      if (!blob) throw new Error("Foto konnte nicht erstellt werden");

      openViewer({ localUrl: URL.createObjectURL(blob), blob, isNew: true });
      await uploadCurrent();
    } catch (err) {
      toast(err.message || String(err), "error");
    } finally {
      countdownEl.hidden = true;
      busy = false;
      shutter.disabled = false;
    }
  }

  shutter.addEventListener("click", takePhoto);

  // Auslösen auch per Bluetooth-Fernauslöser / Tastatur (Leertaste, Enter, Lautstärke-Tasten senden oft Enter)
  document.addEventListener("keydown", (e) => {
    if (!viewer.hidden || !$("settings").hidden) return;
    if (e.key === " " || e.key === "Enter" || e.key === "AudioVolumeUp") {
      e.preventDefault();
      takePhoto();
    }
  });

  // ---------------------------------------------------------------------
  // Galerie
  // ---------------------------------------------------------------------

  let photos = [];
  let newestId = null;

  async function loadPhotos() {
    try {
      photos = await api("/api/photos");
      renderThumbs();
    } catch (err) {
      toast("Fotos konnten nicht geladen werden: " + err.message, "error");
    }
  }

  function renderThumbs() {
    $("photoCount").textContent = photos.length ? `(${photos.length})` : "";
    thumbs.innerHTML = "";
    if (!photos.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Noch keine Fotos – los geht's! 📸";
      thumbs.appendChild(empty);
      return;
    }
    for (const p of photos) {
      const btn = document.createElement("button");
      if (p.id === newestId) btn.className = "new";
      const img = document.createElement("img");
      img.src = p.thumb;
      img.loading = "lazy";
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", () => openViewer({ photo: p }));
      thumbs.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------------
  // Großansicht, Speichern & Drucken
  // ---------------------------------------------------------------------

  let current = null; // { photo?, blob?, localUrl?, isNew }
  let copies = 1;
  let idleTimer;

  function setCopies(n) {
    copies = Math.max(1, Math.min(maxCopies, n));
    copiesEl.textContent = copies;
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    // Nach 45 s ohne Bedienung zurück zur Kamera
    idleTimer = setTimeout(closeViewer, 45000);
  }

  function updateViewerButtons() {
    const saved = !!(current && current.photo);
    printBtn.disabled = !saved;
    deleteBtn.disabled = !saved;
    retryUploadBtn.hidden = saved || !current || !current.uploadFailed;
  }

  function openViewer(item) {
    if (current && current.localUrl && current !== item) URL.revokeObjectURL(current.localUrl);
    current = item;
    viewerImg.src = item.localUrl || item.photo.url;
    $("viewerTitle").textContent = item.isNew ? "Super Foto! 🎉" : "Foto";
    setCopies(1);
    updateViewerButtons();
    viewer.hidden = false;
    resetIdle();
  }

  function closeViewer() {
    clearTimeout(idleTimer);
    viewer.hidden = true;
    if (current && current.localUrl) URL.revokeObjectURL(current.localUrl);
    current = null;
  }

  async function uploadCurrent() {
    const item = current;
    if (!item || !item.blob) return;
    item.uploadFailed = false;
    updateViewerButtons();
    const form = new FormData();
    form.append("photo", item.blob, "photo.jpg");
    try {
      const photo = await api("/api/photos", { method: "POST", body: form });
      item.photo = photo;
      item.blob = null;
      newestId = photo.id;
      photos.unshift(photo);
      renderThumbs();
      if (current === item) {
        updateViewerButtons();
        if (settings.autoPrint) printCurrent();
      }
    } catch (err) {
      item.uploadFailed = true;
      if (current === item) updateViewerButtons();
      toast("Foto konnte nicht gespeichert werden: " + err.message, "error", 6000);
    }
  }

  async function printCurrent() {
    if (!current || !current.photo) return;
    resetIdle();
    printBtn.disabled = true;
    try {
      const res = await api(`/api/photos/${encodeURIComponent(current.photo.id)}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copies }),
      });
      toast(res.copies > 1 ? `${res.copies} Abzüge werden gedruckt 🖨️` : "Wird gedruckt 🖨️", "ok");
      setTimeout(refreshPrinter, 1500);
    } catch (err) {
      toast("Drucken fehlgeschlagen: " + err.message, "error", 6000);
    } finally {
      // Kurze Sperre gegen versehentliches Doppel-Tippen
      setTimeout(updateViewerButtons, 2500);
    }
  }

  async function deleteCurrent() {
    if (!current || !current.photo) return;
    if (!confirm("Dieses Foto wirklich löschen?")) return;
    try {
      await api(`/api/photos/${encodeURIComponent(current.photo.id)}`, { method: "DELETE" });
      const id = current.photo.id;
      photos = photos.filter((p) => p.id !== id);
      renderThumbs();
      closeViewer();
      toast("Foto gelöscht");
    } catch (err) {
      toast("Löschen fehlgeschlagen: " + err.message, "error");
    }
  }

  printBtn.addEventListener("click", printCurrent);
  retryUploadBtn.addEventListener("click", uploadCurrent);
  deleteBtn.addEventListener("click", deleteCurrent);
  $("closeViewer").addEventListener("click", closeViewer);
  $("copiesMinus").addEventListener("click", () => { setCopies(copies - 1); resetIdle(); });
  $("copiesPlus").addEventListener("click", () => { setCopies(copies + 1); resetIdle(); });
  viewer.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });

  // ---------------------------------------------------------------------
  // Druckerstatus
  // ---------------------------------------------------------------------

  async function refreshPrinter() {
    const el = $("printerStatus");
    try {
      const s = await api("/api/printer");
      el.className = "printer " + (s.ok ? "ok" : "bad");
      el.querySelector("span").textContent = s.status;
    } catch (err) {
      el.className = "printer bad";
      el.querySelector("span").textContent = "Server nicht erreichbar";
    }
  }

  // ---------------------------------------------------------------------
  // Einstellungsdialog
  // ---------------------------------------------------------------------

  const settingsModal = $("settings");
  $("settingsBtn").addEventListener("click", () => {
    $("setCamera").value = settings.camera;
    $("setCountdown").value = String(settings.countdown);
    $("setMirror").checked = settings.mirror;
    $("setAutoPrint").checked = settings.autoPrint;
    settingsModal.hidden = false;
  });
  $("closeSettings").addEventListener("click", () => {
    const cameraChanged = $("setCamera").value !== settings.camera;
    settings.camera = $("setCamera").value;
    settings.countdown = parseInt($("setCountdown").value, 10) || 0;
    settings.mirror = $("setMirror").checked;
    settings.autoPrint = $("setAutoPrint").checked;
    saveSettings();
    video.classList.toggle("mirror", settings.mirror);
    settingsModal.hidden = true;
    if (cameraChanged) startCamera();
  });

  // iOS: Pinch-Zoom verhindern (Doppeltipp-Zoom verhindert touch-action im CSS)
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  startCamera();
  loadPhotos();
  refreshPrinter();
  setInterval(refreshPrinter, 30000);
  setInterval(loadPhotosIfIdle, 60000);
  requestWakeLock();

  // Fotos, die auf anderen Geräten gemacht wurden, regelmäßig nachladen
  function loadPhotosIfIdle() {
    if (viewer.hidden && !busy) loadPhotos();
  }
})();
