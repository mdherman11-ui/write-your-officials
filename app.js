/* Write Your Officials: static, client-only app.
   Lookup chain: OpenStreetMap geocode -> U.S. Census districts -> Congress list
   -> Open States (optional key) -> Cicero (optional key) -> community directory.
   Sending: Google Identity Services token + Gmail API, one message per recipient. */
(function () {
  "use strict";

  const CFG = window.REP_MAILER_CONFIG || {};
  const LS = "repMailer.settings";
  const $ = (id) => document.getElementById(id);
  const LEVELS = [
    ["federal", "Federal"],
    ["state", "State"],
    ["county", "County"],
    ["local", "City and local"],
    ["manual", "Added by you"]
  ];
  const STATE_ABBR = {"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY","puerto rico":"PR"};

  const state = {
    officials: [],     // {id, name, title, email, form, level, source, checked}
    place: null,       // {label, city, county, state, lat, lon}
    directory: null,
    token: null,
    tokenExpires: 0,
    sender: "",
    stop: false,
    tokenClient: null
  };

  // ---------- settings ----------
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }
  function setting(key) {
    const s = loadSettings();
    return (s[key] && String(s[key]).trim()) || CFG[key] || "";
  }

  // ---------- small helpers ----------
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isEmail = (e) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(String(e || "").trim());
  let uid = 0;
  // "Max L. Miller" and "Max Miller" are the same person; offices like "Office of the Governor" stay whole.
  function nameKey(n) {
    const t = norm(n).split(" ").filter((w) => w.length > 1 && !/^(jr|sr|ii|iii|iv|hon|dr|mr|mrs|ms)$/.test(w));
    return t.length > 2 && !/^(office|city|county|state)$/.test(t[0]) ? t[0] + " " + t[t.length - 1] : t.join(" ");
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function status(html) { $("locStatus").innerHTML = html; }

  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(url.split("?")[0] + " returned " + r.status);
    return r.json();
  }

  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = "__census_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      const s = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeoutMs || 12000);
      function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error("network")); };
      s.src = url + (url.includes("?") ? "&" : "?") + "format=jsonp&callback=" + cb;
      document.head.appendChild(s);
    });
  }

  function addOfficial(o) {
    if (!o || !o.name) return;
    const email = isEmail(o.email) ? o.email.trim() : "";
    const key = nameKey(o.name);
    const existing = state.officials.find((x) => nameKey(x.name) === key);
    if (existing) {
      if (!existing.email && email) existing.email = email;
      if (!existing.form && o.form) existing.form = o.form;
      if (existing.source.indexOf(o.source) === -1) existing.source += ", " + o.source;
      return;
    }
    state.officials.push({
      id: "o" + (++uid),
      name: o.name.trim(),
      title: (o.title || "").trim(),
      email: email,
      form: o.form || "",
      level: o.level || "local",
      source: o.source || "",
      checked: !!email
    });
  }

  // ---------- lookups ----------
  async function geocode(q) {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=1&q=" + encodeURIComponent(q);
    const res = await getJSON(url, { headers: { "Accept-Language": "en" } });
    if (!res.length) throw new Error("Could not find that location. Try adding the state, like \"Springfield, IL\".");
    const r = res[0], a = r.address || {};
    let st = (a["ISO3166-2-lvl4"] || "").replace("US-", "");
    if (!st && a.state) st = STATE_ABBR[a.state.toLowerCase()] || "";
    const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || "";
    const county = (a.county || "").replace(/\s+(County|Parish|Borough)$/i, "");
    return {
      lat: +r.lat, lon: +r.lon, state: st, city: city, county: county,
      precise: !!(a.house_number || a.road),
      label: [city, st].filter(Boolean).join(", ") || r.display_name
    };
  }

  async function censusDistricts(lat, lon) {
    const url = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=" + lon + "&y=" + lat +
      "&benchmark=Public_AR_Current&vintage=Current_Current&layers=all";
    const data = await jsonp(url, 12000);
    const g = (data && data.result && data.result.geographies) || {};
    const out = {};
    Object.keys(g).forEach((k) => {
      const row = g[k] && g[k][0];
      if (!row) return;
      if (/Congressional Districts/i.test(k)) {
        const cdKey = Object.keys(row).find((f) => /^CD\d+$/.test(f));
        out.cd = parseInt(cdKey ? row[cdKey] : row.BASENAME, 10);
        if (/at large/i.test(row.NAME || "")) out.cd = 0;
      } else if (/Legislative Districts - Upper/i.test(k)) out.upper = row.BASENAME;
      else if (/Legislative Districts - Lower/i.test(k)) out.lower = row.BASENAME;
      else if (/^Counties$/i.test(k)) out.county = row.BASENAME;
      else if (/Incorporated Places/i.test(k)) out.place = row.BASENAME;
      else if (/County Subdivisions/i.test(k)) out.subdivision = row.BASENAME;
    });
    return out;
  }

  let congressCache = null;
  async function federal(st, cd) {
    if (!congressCache) {
      congressCache = await getJSON("https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages/legislators-current.json");
    }
    const found = [];
    congressCache.forEach((p) => {
      const t = p.terms[p.terms.length - 1];
      if (t.state !== st) return;
      const name = p.name.official_full || (p.name.first + " " + p.name.last);
      if (t.type === "sen") {
        found.push({ name, title: "U.S. Senator for " + st, form: t.contact_form || t.url, level: "federal", source: "Congress" });
      } else if (t.type === "rep" && typeof cd === "number" && !isNaN(cd) && (t.district === cd || (cd === 0 && t.district === 0))) {
        found.push({ name, title: "U.S. Representative, " + st + "-" + (t.district || "At large"), form: t.contact_form || t.url, level: "federal", source: "Congress" });
      }
    });
    return found;
  }

  async function openStates(lat, lon, key) {
    const data = await getJSON("https://v3.openstates.org/people.geo?lat=" + lat + "&lng=" + lon + "&apikey=" + encodeURIComponent(key));
    return (data.results || []).map((p) => {
      const role = p.current_role || {};
      const jur = (p.jurisdiction && p.jurisdiction.classification) || "";
      const level = jur === "country" ? "federal" : jur === "municipality" ? "local" : "state";
      const chamber = role.org_classification === "upper" ? "State Senate" : role.org_classification === "lower" ? "State House" : "";
      const title = [role.title, chamber && level === "state" ? chamber : "", role.district ? "District " + role.district : ""].filter(Boolean).join(", ");
      const link = (p.links && p.links[0] && p.links[0].url) || "";
      return { name: p.name, title, email: p.email, form: link, level, source: "Open States" };
    });
  }

  async function cicero(lat, lon, key) {
    const data = await getJSON("https://app.cicerodata.com/v3.1/official?lat=" + lat + "&lon=" + lon + "&max=200&format=json&key=" + encodeURIComponent(key));
    const errs = data.response && data.response.errors;
    if (errs && errs.length) throw new Error("Cicero: " + errs.join("; "));
    return ((data.response && data.response.results && data.response.results.officials) || []).map((o) => {
      const dt = (o.office && o.office.district && o.office.district.district_type) || "";
      const level = /^NATIONAL/.test(dt) ? "federal" : /^STATE/.test(dt) ? "state" : /COUNTY/.test(dt) ? "county" : "local";
      const fn = o.preferred_name || o.first_name;
      const where = (o.office && (o.office.representing_city || (o.office.district && o.office.district.label))) || "";
      const title = [(o.office && o.office.title) || "", where].filter(Boolean).join(", ");
      return { name: fn + " " + o.last_name, title, email: (o.email_addresses || [])[0] || "", form: o.web_form_url || (o.urls || [])[0] || "", level, source: "Cicero" };
    });
  }

  async function loadDirectory() {
    if (state.directory) return state.directory;
    try { state.directory = await getJSON("data/directory.json"); }
    catch (e) { state.directory = { places: [] }; }
    return state.directory;
  }

  function directoryMatches(place) {
    const dir = state.directory || { places: [] };
    const city = norm(place.city), county = norm(place.county), st = (place.state || "").toUpperCase();
    return dir.places.filter((p) => {
      if ((p.state || "").toUpperCase() !== st) return false;
      if (p.scope === "state") return true;
      if (p.scope === "county") return norm(p.county) === county;
      if (p.scope === "city") return (p.match || [p.name]).some((m) => norm(m) === city);
      return false;
    });
  }

  function addPlaceOfficials(p) {
    (p.officials || []).forEach((o) => addOfficial({
      name: o.name, title: o.title, email: o.email, form: o.form,
      level: p.level || (p.scope === "state" ? "state" : p.scope === "county" ? "county" : "local"),
      source: "Directory"
    }));
  }

  async function findOfficials(q) {
    state.officials = state.officials.filter((o) => o.level === "manual");
    const notes = [];
    $("findBtn").disabled = true;
    status("Finding the location...");
    try {
      await loadDirectory();
      const place = await geocode(q);
      state.place = place;
      status("Found " + esc(place.label) + ". Looking up districts and officials...");

      let districts = {};
      try {
        districts = await censusDistricts(place.lat, place.lon);
        if (districts.place && !place.city) place.city = districts.place;
        if (districts.county && !place.county) place.county = districts.county;
      } catch (e) {
        notes.push("<span class='warn'>Census district lookup did not respond, so the U.S. House member may be missing.</span>");
      }

      const jobs = [];
      jobs.push(federal(place.state, districts.cd).then((r) => r.forEach(addOfficial))
        .catch(() => notes.push("<span class='warn'>Could not load the list of members of Congress.</span>")));

      const osKey = setting("openStatesKey");
      if (osKey) {
        jobs.push(openStates(place.lat, place.lon, osKey).then((r) => r.forEach(addOfficial))
          .catch((e) => notes.push("<span class='warn'>Open States lookup failed (" + esc(e.message) + ").</span>")));
      } else {
        notes.push("Add a free Open States key in Settings to include state legislators automatically.");
      }
      const cKey = setting("ciceroKey");
      if (cKey) {
        jobs.push(cicero(place.lat, place.lon, cKey).then((r) => r.forEach(addOfficial))
          .catch((e) => notes.push("<span class='warn'>Cicero lookup failed (" + esc(e.message) + ").</span>")));
      }
      await Promise.all(jobs);

      const matched = directoryMatches(place);
      matched.forEach(addPlaceOfficials);
      if (!matched.some((p) => p.scope === "city") && !cKey) {
        notes.push("No city officials on file for " + esc(place.city || "this place") + " yet. Add them manually below, or add the city to the directory so everyone gets them.");
      }
      if (!place.precise) notes.push("Using the center of " + esc(place.label) + ". For exact districts, enter a street address.");

      const n = state.officials.length, withEmail = state.officials.filter((o) => o.email).length;
      status("<strong>" + n + " officials found for " + esc(place.label) + "</strong>, " + withEmail + " with email." +
        (notes.length ? "<br>" + notes.join("<br>") : ""));
      fillExtraPlaces();
      render();
      ["step2", "step3", "step4"].forEach((s) => { $(s).hidden = false; });
      updateSummary();
    } catch (e) {
      status("<span class='err'>" + esc(e.message) + "</span>");
    } finally {
      $("findBtn").disabled = false;
    }
  }

  function fillExtraPlaces() {
    const sel = $("extraPlace");
    const places = (state.directory && state.directory.places) || [];
    sel.innerHTML = places.map((p) => "<option value='" + esc(p.id) + "'>" + esc(p.name + " (" + p.state + ")") + "</option>").join("");
    $("extraPlacesWrap").hidden = !places.length;
  }

  // ---------- rendering ----------
  function render() {
    const box = $("results");
    const html = LEVELS.map(([lvl, label]) => {
      const list = state.officials.filter((o) => o.level === lvl && o.email);
      if (!list.length) return "";
      return "<div class='group'><h3>" + label + "</h3>" + list.map((o) =>
        "<label class='person'><input type='checkbox' data-id='" + o.id + "'" + (o.checked ? " checked" : "") + ">" +
        "<span><span class='name'>" + esc(o.name) + "</span><span class='src'>" + esc(o.source) + "</span><br>" +
        "<span class='meta'>" + esc(o.title) + (o.title ? " · " : "") + esc(o.email) + "</span></span></label>"
      ).join("") + "</div>";
    }).join("");
    box.innerHTML = html || "<p class='empty'>No email addresses found yet. Add recipients manually, or add API keys in Settings.</p>";

    const formOnly = state.officials.filter((o) => !o.email);
    $("formOnly").innerHTML = formOnly.length ? (
      "<div class='form-only'><h3>Contact form only (" + formOnly.length + ")</h3>" +
      "<p class='hint'>These offices do not publish an email address. Members of Congress and most governors only accept messages through their website. Use <em>Copy message</em>, then paste it into their form.</p><ul>" +
      formOnly.map((o) => "<li><strong>" + esc(o.name) + "</strong>, " + esc(o.title) +
        (o.form ? " · <a href='" + esc(o.form) + "' target='_blank' rel='noopener'>Open contact page</a>" : "") +
        " · <a href='#' data-copy='" + o.id + "'>Copy message</a></li>").join("") +
      "</ul></div>") : "";
  }

  function selected() {
    return state.officials.filter((o) => o.email && o.checked);
  }

  function fillTemplate(text, o) {
    const place = state.place ? state.place.label : "";
    return String(text || "")
      .replace(/\{\{\s*name\s*\}\}/gi, o ? o.name : "")
      .replace(/\{\{\s*title\s*\}\}/gi, o ? o.title : "")
      .replace(/\{\{\s*place\s*\}\}/gi, place);
  }

  function updateSummary() {
    const n = selected().length;
    const max = CFG.maxRecipientsPerSend || 150;
    $("sendSummary").innerHTML = n
      ? "<strong>" + n + "</strong> separate email" + (n === 1 ? "" : "s") + " will be sent" +
        (state.sender ? " from <strong>" + esc(state.sender) + "</strong>." : ". Connect Gmail to send, or open each one in Gmail.") +
        (n > max ? " <span class='err'>That is over the limit of " + max + " per send.</span>" : "")
      : "Select at least one recipient above.";
    $("sendBtn").disabled = !n || n > max;
    $("manualSendBtn").disabled = !n;
  }

  // ---------- Gmail auth ----------
  function ensureTokenClient() {
    const cid = setting("googleClientId");
    if (!cid) return null;
    if (!(window.google && google.accounts && google.accounts.oauth2)) return null;
    if (!state.tokenClient || state.tokenClient._cid !== cid) {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
        callback: () => {}
      });
      state.tokenClient._cid = cid;
    }
    return state.tokenClient;
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const tc = ensureTokenClient();
      if (!tc) {
        reject(new Error(setting("googleClientId")
          ? "Google sign-in is still loading. Try again in a second."
          : "One-click sending is not set up on this site yet (no Google Client ID). Use \"Open each in Gmail instead\", or add a Client ID in Settings."));
        return;
      }
      tc.callback = async (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, "https://www.googleapis.com/auth/gmail.send")) {
          reject(new Error("Gmail send permission was not granted. Please tick the box allowing the app to send email."));
          return;
        }
        state.token = resp.access_token;
        state.tokenExpires = Date.now() + (resp.expires_in - 60) * 1000;
        try {
          const me = await getJSON("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + state.token } });
          state.sender = me.email || "";
        } catch (e) { state.sender = "your Gmail"; }
        $("whoami").textContent = "Sending as " + state.sender;
        $("whoami").hidden = false;
        $("connectBtn").textContent = "Switch account";
        updateSummary();
        resolve();
      };
      tc.requestAccessToken({ prompt: state.token ? "select_account" : "" });
    });
  }

  async function ensureToken() {
    if (state.token && Date.now() < state.tokenExpires) return;
    await connect();
  }

  // ---------- MIME + send ----------
  function b64utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function encodeHeader(v) {
    return /^[\x20-\x7e]*$/.test(v) ? v : "=?UTF-8?B?" + b64utf8(v) + "?=";
  }
  function buildRaw(to, subject, body, bcc) {
    const lines = [
      "To: " + to,
      bcc ? "Bcc: " + bcc : null,
      "Subject: " + encodeHeader(subject),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "Content-Transfer-Encoding: base64",
      "",
      b64utf8(body).replace(/(.{76})/g, "$1\r\n")
    ].filter((l) => l !== null);
    return btoa(lines.join("\r\n")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function gmailSend(raw) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw })
    });
    if (r.status === 401) { state.token = null; throw new Error("auth"); }
    if (!r.ok) {
      let msg = r.status + "";
      try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return r.json();
  }

  function logLine(html, cls) {
    const li = document.createElement("li");
    if (cls) li.className = cls;
    li.innerHTML = html;
    $("log").appendChild(li);
    li.scrollIntoView({ block: "nearest" });
    return li;
  }

  function validateMessage() {
    const subject = $("subject").value.trim(), body = $("body").value.trim();
    if (!subject || !body) { toast("Add a subject and a message first."); (subject ? $("body") : $("subject")).focus(); return null; }
    return { subject, body };
  }

  async function sendAll() {
    const msg = validateMessage();
    if (!msg) return;
    const list = selected();
    if (!list.length) return;
    try { await ensureToken(); } catch (e) { toast(e.message); return; }

    const first = list[0];
    $("confirmText").innerHTML = "<p>This sends <strong>" + list.length + "</strong> separate email" + (list.length === 1 ? "" : "s") +
      " from <strong>" + esc(state.sender) + "</strong>. Preview of the first one, to " + esc(first.name) + ":</p>";
    $("previewBox").textContent = "Subject: " + fillTemplate(msg.subject, first) + "\n\n" + fillTemplate(msg.body, first);
    const ok = await new Promise((res) => {
      const d = $("confirmDlg");
      d.onclose = () => res(d.returnValue === "ok");
      d.returnValue = "";
      d.showModal();
    });
    if (!ok) return;

    state.stop = false;
    $("log").innerHTML = "";
    $("progressWrap").hidden = false;
    $("sendBtn").disabled = true; $("stopBtn").hidden = false;
    const bcc = $("ccSelf").checked && state.sender.indexOf("@") > 0 ? state.sender : "";
    const delay = Math.max(1, +(CFG.sendDelaySeconds || 2)) * 1000;
    let sent = 0, failed = 0;

    for (let i = 0; i < list.length; i++) {
      if (state.stop) { logLine("Stopped. " + (list.length - i) + " not sent."); break; }
      const o = list[i];
      const raw = buildRaw(o.email, fillTemplate(msg.subject, o), fillTemplate(msg.body, o), bcc);
      try {
        try { await gmailSend(raw); }
        catch (e) {
          if (e.message !== "auth") throw e;
          await ensureToken();
          await gmailSend(raw);
        }
        sent++;
        o.checked = false;
        logLine("Sent to " + esc(o.name) + " &lt;" + esc(o.email) + "&gt;", "ok");
      } catch (e) {
        failed++;
        logLine("Failed for " + esc(o.name) + ": " + esc(e.message), "bad");
      }
      $("bar").style.width = Math.round(((i + 1) / list.length) * 100) + "%";
      if (i < list.length - 1 && !state.stop) await sleep(delay);
    }
    logLine("<strong>Done. " + sent + " sent" + (failed ? ", " + failed + " failed" : "") + ".</strong> Check your Gmail Sent folder.");
    $("stopBtn").hidden = true;
    render(); updateSummary();
  }

  function manualSend() {
    const msg = validateMessage();
    if (!msg) return;
    const list = selected();
    $("log").innerHTML = "";
    $("progressWrap").hidden = true;
    logLine("Click each link. Gmail opens a filled-in draft; press Send there. Links turn green once opened.");
    list.forEach((o) => {
      const url = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(o.email) +
        "&su=" + encodeURIComponent(fillTemplate(msg.subject, o)) +
        "&body=" + encodeURIComponent(fillTemplate(msg.body, o));
      const li = logLine("<a href='" + esc(url) + "' target='_blank' rel='noopener'>Open draft to " + esc(o.name) + "</a> (" + esc(o.email) + ")");
      li.querySelector("a").addEventListener("click", () => { li.className = "ok"; });
    });
  }

  // ---------- share link ----------
  function shareLink() {
    const p = new URLSearchParams();
    if ($("locInput").value.trim()) p.set("loc", $("locInput").value.trim());
    if ($("subject").value.trim()) p.set("s", $("subject").value.trim());
    if ($("body").value.trim()) p.set("b", $("body").value.trim());
    const url = location.origin + location.pathname + "#" + p.toString();
    const done = () => toast("Link copied. Whoever opens it connects their own Gmail.");
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("Copy this link:", url));
    else prompt("Copy this link:", url);
  }

  function readShareLink() {
    if (!location.hash || location.hash.length < 2) return;
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("s")) $("subject").value = p.get("s");
    if (p.get("b")) $("body").value = p.get("b");
    if (p.get("loc")) { $("locInput").value = p.get("loc"); findOfficials(p.get("loc")); }
  }

  // ---------- events ----------
  function wire() {
    $("locForm").addEventListener("submit", (e) => { e.preventDefault(); findOfficials($("locInput").value.trim()); });
    $("results").addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      const o = state.officials.find((x) => x.id === id);
      if (o) { o.checked = e.target.checked; updateSummary(); }
    });
    $("formOnly").addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-copy");
      if (!id) return;
      e.preventDefault();
      const o = state.officials.find((x) => x.id === id);
      const text = fillTemplate($("subject").value, o) + "\n\n" + fillTemplate($("body").value, o);
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Message copied for " + o.name));
    });
    $("selAll").addEventListener("click", () => { state.officials.forEach((o) => { if (o.email) o.checked = true; }); render(); updateSummary(); });
    $("selNone").addEventListener("click", () => { state.officials.forEach((o) => { o.checked = false; }); render(); updateSummary(); });
    $("manualForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("mEmail").value.trim();
      if (!isEmail(email)) { toast("That email address does not look right."); return; }
      addOfficial({ name: $("mName").value, title: $("mTitle").value, email, level: "manual", source: "You" });
      e.target.reset(); render(); updateSummary();
    });
    $("addPlaceBtn").addEventListener("click", () => {
      const p = state.directory.places.find((x) => x.id === $("extraPlace").value);
      if (p) { addPlaceOfficials(p); render(); updateSummary(); toast("Added " + p.name); }
    });
    $("connectBtn").addEventListener("click", () => connect().catch((e) => toast(e.message)));
    $("sendBtn").addEventListener("click", sendAll);
    $("manualSendBtn").addEventListener("click", manualSend);
    $("stopBtn").addEventListener("click", () => { state.stop = true; });
    $("shareBtn").addEventListener("click", shareLink);
    $("settingsBtn").addEventListener("click", () => {
      const s = loadSettings();
      $("sClient").value = s.googleClientId || "";
      $("sOpen").value = s.openStatesKey || "";
      $("sCicero").value = s.ciceroKey || "";
      $("settingsDlg").showModal();
    });
    $("settingsDlg").addEventListener("close", () => {
      if ($("settingsDlg").returnValue !== "save") return;
      saveSettings({ googleClientId: $("sClient").value.trim(), openStatesKey: $("sOpen").value.trim(), ciceroKey: $("sCicero").value.trim() });
      state.tokenClient = null;
      toast("Settings saved");
    });
    $("ccSelf").addEventListener("change", updateSummary);
  }

  wire();
  readShareLink();
  if (!setting("googleClientId")) $("connectBtn").title = "One-click sending needs a Google Client ID (see README). You can still open each email in Gmail.";
})();
