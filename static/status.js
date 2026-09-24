(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const REFRESH_MS = 5000;

  // Element bauen; Texte immer als textContent (Gerätenamen kommen von außen)
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function row(label, value, cls) {
    const r = el("div", "row");
    r.append(el("span", "label", label), el("span", "value " + (cls || ""), value));
    return r;
  }

  function pill(text, kind) {
    return el("span", "pill " + kind, text);
  }

  function signalBars(percent) {
    const bars = el("span", "bars");
    const level = percent >= 75 ? 4 : percent >= 50 ? 3 : percent >= 25 ? 2 : 1;
    for (let i = 1; i <= 4; i++) bars.append(el("i", i <= level ? "on" : ""));
    return bars;
  }

  // dBm (Hotspot-Geräte) grob in Prozent umrechnen
  const dbmToPercent = (dbm) => Math.max(0, Math.min(100, 2 * (dbm + 100)));

  function duration(sec) {
    if (sec == null) return "–";
    const d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60;
    if (d) return `${d} T ${h} Std`;
    if (h) return `${h} Std ${m} Min`;
    return `${m} Min`;
  }

  const gb = (bytes) => (bytes / 1e9).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " GB";

  let toastTimer;
  function toast(msg, type = "") {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast " + type;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  function setCardState(id, kind) {
    $(id).dataset.state = kind;
  }

  // ---------------------------------------------------------------------
  // WLAN
  // ---------------------------------------------------------------------

  function renderWifi(w) {
    const box = $("wifi");
    box.replaceChildren();
    if (!w.available) {
      setCardState("wifiCard", "unknown");
      box.append(pill("unbekannt", "grey"), el("p", "muted", w.message));
      return;
    }

    const head = el("div", "headline");
    if (w.mode === "hotspot") {
      setCardState("wifiCard", "ok");
      head.append(pill("Hotspot aktiv", "green"));
    } else if (w.mode === "client") {
      setCardState("wifiCard", "ok");
      head.append(pill("Mit WLAN verbunden", "green"));
    } else {
      setCardState("wifiCard", w.ethernet ? "warn" : "bad");
      head.append(pill("WLAN aus", w.ethernet ? "orange" : "red"));
    }
    box.append(head);
    box.append(renderSwitch(w));
    if (w.hotspot_ssid != null) box.append(renderHotspotAccess(w));

    if (w.ssid && w.mode !== "hotspot") box.append(row("WLAN-Name", w.ssid, "strong"));
    if (w.channel) box.append(row("Kanal", w.channel));
    if (w.mode === "client" && w.signal != null) {
      const r = row("Signal", `${w.signal} %`);
      r.querySelector(".value").prepend(signalBars(w.signal));
      box.append(r);
    }

    const host = (lastStatus && lastStatus.system.hostname ? lastStatus.system.hostname : "photobox") + ".local";
    box.append(row("Photobox-Adresse", "https://" + host, "strong"));
    const ips = w.addresses[w.interface] || [];
    if (ips.length) box.append(row("IP-Adresse", ips.map((ip) => "https://" + ip).join("  ·  ")));
    box.append(row("LAN-Kabel", w.ethernet ? "verbunden" : "nicht verbunden"));
    if (w.message) box.append(el("p", "muted", w.message));

    if (w.mode === "hotspot") {
      const list = el("div", "list");
      list.append(el("h3", "", `Verbundene Geräte (${w.clients.length})`));
      if (!w.clients.length) list.append(el("p", "muted", "Noch kein Gerät verbunden"));
      for (const c of w.clients) {
        const item = el("div", "item");
        const name = el("div", "item-main");
        name.append(el("strong", "", c.name || "Unbekanntes Gerät"), el("span", "muted", c.ip || c.mac));
        const meta = el("div", "item-meta");
        if (c.signal != null) meta.append(signalBars(dbmToPercent(c.signal)), el("span", "muted", `${c.signal} dBm`));
        if (c.connected != null) meta.append(el("span", "muted", duration(c.connected)));
        item.append(name, meta);
        list.append(item);
      }
      box.append(list);
    }
  }

  // ---------------------------------------------------------------------
  // Umschalter Hotspot / WLAN
  // ---------------------------------------------------------------------

  let lastStatus = null;
  let switching = false;

  function renderSwitch(w) {
    const wrap = el("div", "wifi-switch");
    const seg = el("div", "segmented");
    const hs = el("button", w.mode === "hotspot" ? "active" : "", "Hotspot");
    const cl = el("button", w.mode === "client" ? "active" : "", "WLAN");
    hs.type = cl.type = "button";
    seg.append(hs, cl);
    wrap.append(seg);

    let hint = "";
    if (!w.switch_available) hint = "Umschalten nicht eingerichtet – auf dem Pi ./setup-wifi-switch.sh ausführen.";
    else if (!w.hotspot_ssid) hint = "Kein Hotspot eingerichtet – auf dem Pi ./setup-hotspot.sh ausführen.";
    else if (!w.known.length) hint = "Kein normales WLAN gespeichert.";

    hs.disabled = switching || !w.switch_available || !w.hotspot_ssid || w.mode === "hotspot";
    cl.disabled = switching || !w.switch_available || !w.known.length || w.mode === "client";
    hs.onclick = () => askSwitch("hotspot");
    cl.onclick = () => askSwitch("client");

    if (hint) wrap.append(el("p", "muted", hint));
    else if (w.known.length) wrap.append(el("p", "muted", "Bekannte WLANs: " + w.known.map((n) => n.ssid).join(", ")));
    if (w.switch_log && w.switch_log.length) {
      const details = el("details", "switch-log");
      details.append(el("summary", "", "Letzte Umschaltung: " + w.switch_log[0]));
      details.append(el("pre", "", w.switch_log.join("\n")));
      wrap.append(details);
    }
    return wrap;
  }

  // ---------------------------------------------------------------------
  // Hotspot-Zugang (Name + Passwort anzeigen/ändern)
  // ---------------------------------------------------------------------

  let showPassword = false;

  function renderHotspotAccess(w) {
    const wrap = el("div", "hotspot-access");
    wrap.append(el("h3", "", "Hotspot-Zugang"));
    wrap.append(row("Name", w.hotspot_ssid, "strong"));

    const pwRow = row("Passwort", "");
    const value = pwRow.querySelector(".value");
    if (w.hotspot_password == null) {
      value.textContent = "nicht lesbar";
      value.classList.add("muted");
    } else {
      value.append(el("code", "password", showPassword ? w.hotspot_password : "••••••••"));
      const toggle = el("button", "btn small", showPassword ? "Verbergen" : "Anzeigen");
      toggle.type = "button";
      toggle.onclick = () => { showPassword = !showPassword; renderWifi(lastStatus.wifi); };
      value.append(toggle);
    }
    wrap.append(pwRow);

    if (w.switch_available) {
      const change = el("button", "btn small", "Passwort ändern");
      change.type = "button";
      change.onclick = () => askPassword(w);
      const actions = el("div", "actions");
      actions.append(change);
      wrap.append(actions);
    }
    return wrap;
  }

  function askPassword(w) {
    const input = $("pwInput");
    input.value = "";
    $("pwError").hidden = true;
    $("pwNote").textContent = w.mode === "hotspot"
      ? "Der Hotspot startet danach neu. Alle Geräte – auch dieses iPad – werden kurz getrennt und müssen sich mit dem neuen Passwort wieder verbinden."
      : "Das neue Passwort gilt beim nächsten Einschalten des Hotspots.";
    $("pwModal").hidden = false;
    setTimeout(() => input.focus(), 50);
  }

  async function savePassword() {
    const pw = $("pwInput").value;
    const err = $("pwError");
    if (pw.length < 8 || pw.length > 63 || /[^\x20-\x7e]/.test(pw)) {
      err.textContent = "8 bis 63 Zeichen, keine Umlaute.";
      err.hidden = false;
      return;
    }
    $("pwSave").disabled = true;
    try {
      const res = await fetch("/api/wifi/hotspot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      $("pwModal").hidden = true;
      showPassword = true;
      toast(data.restarted
        ? "Passwort geändert – Hotspot startet neu, gleich mit dem neuen Passwort verbinden"
        : "Passwort geändert", "ok");
      refresh();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      $("pwSave").disabled = false;
    }
  }

  function askSwitch(mode) {
    const w = lastStatus.wifi;
    const host = (lastStatus.system.hostname || "raspberrypi") + ".local";
    const modal = $("switchModal");
    const text = $("switchText");
    text.replaceChildren();
    if (mode === "client") {
      const nets = w.known.map((n) => "„" + n.ssid + "“").join(" oder ");
      $("switchTitle").textContent = "Ins normale WLAN wechseln?";
      text.append(
        el("p", "", `Die Photobox verbindet sich mit ${nets}. Der Hotspot wird dabei ausgeschaltet, das iPad verliert kurz die Verbindung.`),
        el("p", "", "Danach am iPad:"),
        list([`Einstellungen → WLAN → ${nets} wählen`, `Die Photobox-App öffnen (bzw. https://${host} in Safari)`]),
        el("p", "muted", "Ist kein bekanntes WLAN erreichbar, schaltet die Photobox nach etwa einer Minute automatisch zurück auf den Hotspot."),
      );
    } else {
      $("switchTitle").textContent = "Auf Hotspot umschalten?";
      text.append(
        el("p", "", `Die Photobox trennt sich vom WLAN „${w.ssid}“ und startet ihren eigenen Hotspot. Das iPad verliert kurz die Verbindung.`),
        el("p", "", "Danach am iPad:"),
        list([`Einstellungen → WLAN → „${w.hotspot_ssid}“ wählen`, `Die Photobox-App öffnen (bzw. https://${host} in Safari)`]),
      );
    }
    $("switchConfirm").onclick = () => doSwitch(mode);
    modal.hidden = false;
  }

  function list(items) {
    const ol = el("ol");
    for (const i of items) ol.append(el("li", "", i));
    return ol;
  }

  async function doSwitch(mode) {
    $("switchModal").hidden = true;
    switching = true;
    try {
      const res = await fetch("/api/wifi/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      toast(mode === "client" ? "Wechsle ins WLAN … jetzt das iPad umstellen" : "Starte Hotspot … jetzt das iPad umstellen", "ok");
    } catch (err) {
      // Bricht die Verbindung schon während der Anfrage ab, hat das Umschalten begonnen
      if (err instanceof TypeError) toast("Umschalten läuft – jetzt das iPad umstellen", "ok");
      else toast(err.message, "error");
    } finally {
      setTimeout(() => { switching = false; }, 60000);
    }
  }

  // ---------------------------------------------------------------------
  // Drucker
  // ---------------------------------------------------------------------

  const STATE_TEXT = { idle: "Bereit", printing: "Druckt", stopped: "Angehalten" };

  async function printerAction(name, action, button) {
    button.disabled = true;
    try {
      const res = await fetch(`/api/printers/${encodeURIComponent(name)}/${action}`, { method: "POST", credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      toast(action === "resume" ? "Drucker fortgesetzt" : "Aufträge abgebrochen", "ok");
      refresh();
    } catch (err) {
      toast(err.message, "error");
      button.disabled = false;
    }
  }

  function renderPrinter(p, jobs) {
    const box = $("printer");
    box.replaceChildren();
    if (!p.available) {
      setCardState("printerCard", "bad");
      box.append(pill("nicht erreichbar", "red"), el("p", "muted", p.message));
      return;
    }
    if (!p.printers.length) {
      setCardState("printerCard", "bad");
      box.append(pill("Kein Drucker", "red"), el("p", "muted", "In CUPS ist noch kein Drucker eingerichtet."));
    }

    const selected = p.printers.find((x) => x.selected);
    setCardState("printerCard", !p.printers.length ? "bad" : !selected ? "warn" : selected.ok ? "ok" : "bad");

    for (const pr of p.printers) {
      const block = el("div", "printer-block" + (pr.selected ? " selected" : ""));
      const head = el("div", "headline");
      const kind = !pr.enabled ? "red" : pr.alerts.length ? "orange" : pr.state === "printing" ? "blue" : "green";
      head.append(pill(STATE_TEXT[pr.state] || pr.state, kind));
      if (pr.selected) head.append(pill("Photobox-Drucker", "outline"));
      else if (pr.default) head.append(pill("Standard", "outline"));
      block.append(head);

      block.append(row("Name", pr.description || pr.name, "strong"));
      if (pr.device) {
        const conn = pr.device.split(":")[0];
        const label = { usb: "USB", ipp: "Netzwerk (IPP)", ipps: "Netzwerk (IPPS)", dnssd: "Netzwerk", socket: "Netzwerk", lpd: "Netzwerk" }[conn] || conn;
        block.append(row("Anschluss", label));
      }
      if (pr.job) block.append(row("Aktueller Auftrag", pr.job));
      for (const a of pr.alerts) block.append(el("p", "alert", "⚠️ " + a));
      if (pr.message) block.append(el("p", "muted", pr.message));

      const actions = el("div", "actions");
      if (!pr.enabled) {
        const b = el("button", "btn primary small", "Drucker fortsetzen");
        b.onclick = () => printerAction(pr.name, "resume", b);
        actions.append(b);
      }
      if (jobs.some((j) => j.printer === pr.name)) {
        const b = el("button", "btn small", "Alle Aufträge abbrechen");
        b.onclick = () => { if (confirm("Alle wartenden Druckaufträge abbrechen?")) printerAction(pr.name, "cancel", b); };
        actions.append(b);
      }
      if (actions.children.length) block.append(actions);
      box.append(block);
    }

    if (p.configured && !selected) {
      box.append(el("p", "alert", `⚠️ Der eingestellte Drucker „${p.configured}“ existiert nicht.`));
    } else if (p.printers.length && !selected) {
      box.append(el("p", "alert", "⚠️ Kein Standarddrucker festgelegt."));
    }

    const cups = el("a", "btn small", "Drucker verwalten (CUPS)");
    cups.href = `https://${location.hostname}:8631/printers/`;
    cups.target = "_blank";
    const links = el("div", "actions");
    links.append(cups);
    box.append(links);
  }

  function renderJobs(p) {
    const box = $("jobs");
    box.replaceChildren();
    const jobs = (p.available && p.jobs) || [];
    if (!jobs.length) {
      box.append(el("p", "muted", "Keine wartenden Aufträge"));
      return;
    }
    const list = el("div", "list");
    for (const j of jobs) {
      const item = el("div", "item");
      const main = el("div", "item-main");
      main.append(el("strong", "", j.id), el("span", "muted", j.time));
      item.append(main, el("span", "muted", (j.size / 1024).toFixed(0) + " KB"));
      list.append(item);
    }
    box.append(list);
  }

  // ---------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------

  function renderSystem(s) {
    const box = $("system");
    box.replaceChildren();
    box.append(row("Fotos in der Galerie", String(s.photos), "strong"));
    if (s.archived != null) box.append(row("Fotos im Archiv", String(s.archived)));
    if (s.disk_free != null) {
      const pct = Math.round((1 - s.disk_free / s.disk_total) * 100);
      const r = row("Speicher", `${gb(s.disk_free)} frei von ${gb(s.disk_total)}`, s.disk_free < 1e9 ? "warn" : "");
      box.append(r);
      const meter = el("div", "meter");
      const fill = el("i");
      fill.style.width = pct + "%";
      if (pct > 90) fill.className = "bad";
      meter.append(fill);
      box.append(meter);
    }
    if (s.temperature != null) {
      box.append(row("CPU-Temperatur", s.temperature.toFixed(0) + " °C", s.temperature >= 75 ? "warn" : ""));
    }
    if (s.undervoltage) box.append(el("p", "alert", "⚠️ Unterspannung – bitte ein stärkeres Netzteil verwenden"));
    box.append(row("Laufzeit", duration(s.uptime)));
    box.append(row("Uhrzeit Pi", new Date(s.time).toLocaleString("de-DE")));
    box.append(row("Gerätename", s.hostname));
  }

  // ---------------------------------------------------------------------

  async function refresh() {
    try {
      const res = await fetch("/api/status", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const data = await res.json();
      lastStatus = data;
      renderWifi(data.wifi);
      renderPrinter(data.printer, (data.printer.available && data.printer.jobs) || []);
      renderJobs(data.printer);
      renderSystem(data.system);
      $("updated").textContent = "Aktualisiert " + new Date().toLocaleTimeString("de-DE");
      $("updated").classList.remove("stale");
    } catch (err) {
      $("updated").textContent = "Photobox nicht erreichbar";
      $("updated").classList.add("stale");
    }
  }

  $("switchCancel").onclick = () => { $("switchModal").hidden = true; };
  $("pwCancel").onclick = () => { $("pwModal").hidden = true; };
  $("pwSave").onclick = savePassword;
  $("pwInput").addEventListener("keydown", (e) => { if (e.key === "Enter") savePassword(); });
  $("pwInput").addEventListener("input", () => { $("pwError").hidden = true; });

  refresh();
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, REFRESH_MS);
})();
