import { Hono } from "hono";

const app = new Hono();

// === Config externe (paste.rs HTML / Airtable / 360dialog) ===
const HTML_URL = "https://paste.rs/mEvFZ";
const INBOX_URL = "https://paste.rs/Qu8Os"; // PWA-ready
const AT_PAT = (typeof process !== "undefined" && process.env && process.env.AT_PAT) || "";
const AT_BASE = "app32pzg9VDq1h6bb";
const AT_TBL_MSG = "tblAqvqY4OBAYxWGX";
const AT_TBL_LEADS = "tblBnnxygWJCq8qTg";
const D360_KEY = (typeof process !== "undefined" && process.env && process.env.D360_KEY) || "";
const D360_BASE = "https://waba-v2.360dialog.io";
const DIR_OUT = "📤 Outbound";
const DIR_IN = "📥 Inbound";



// === Anti-slug guard : refuse firstName that looks like a Skool slug ===
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+-\d{2,5}$/i;
function sanitizeFirstName(raw: any): string {
  const v = (typeof raw === "string" ? raw : "").trim();
  if (!v) return "là";
  if (SLUG_RE.test(v)) {
    console.log("FIRSTNAME_GUARD_SLUG_BLOCKED:", v);
    return "là";
  }
  // also block if starts with prefix patterns
  if (/^\[(bot|auto)/i.test(v)) {
    console.log("FIRSTNAME_GUARD_PREFIX_BLOCKED:", v);
    return "là";
  }
  return v;
}

// === Web Push (VAPID + ECE via web-push npm package) ===
import webpush from "web-push";
const VAPID_PUBLIC_KEY = (typeof process !== "undefined" && process.env && process.env.VAPID_PUBLIC_KEY) || "BG6vfxlVnGMMOa4o7fsA2afeoW_7KNQ8k6nYzDMxHDa3J-06JkD86Gjnet6FKU1vF2_8j_xZazryxdg_EfA6kTY";
const VAPID_PRIVATE_KEY = (typeof process !== "undefined" && process.env && process.env.VAPID_PRIVATE_KEY) || "";
const VAPID_SUBJECT = "mailto:delmas.maxence.pro@gmail.com";
const MAXENCE_PUSH_SUBSCRIPTION = (typeof process !== "undefined" && process.env && process.env.MAXENCE_PUSH_SUBSCRIPTION) || "";
if (VAPID_PRIVATE_KEY && VAPID_PUBLIC_KEY) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); } catch (e) { console.error("VAPID setup error:", String(e)); }
}
async function firePushToMaxence(title: string, body: string, url: string = "/inbox", tag: string = "whatsapp-inbound") {
  if (!MAXENCE_PUSH_SUBSCRIPTION || !VAPID_PRIVATE_KEY) {
    console.log("PUSH_SKIP: missing subscription or private key");
    return { sent: false, reason: "missing_config" };
  }
  try {
    const subscription = JSON.parse(MAXENCE_PUSH_SUBSCRIPTION);
    const payload = JSON.stringify({ title: title.slice(0, 80), body: body.slice(0, 200), url, tag });
    const res = await webpush.sendNotification(subscription, payload, { TTL: 3600 });
    console.log("PUSH_SENT:", title, "status=" + res.statusCode);
    return { sent: true, status: res.statusCode };
  } catch (e: any) {
    console.error("PUSH_ERROR:", e && e.message ? e.message : String(e));
    return { sent: false, error: e && e.message ? e.message : String(e) };
  }
}

// === PWA static assets (inline pour éviter dépendance externe) ===
const MANIFEST_JSON = JSON.stringify({
  name: "ALPHA AI Messagerie",
  short_name: "ALPHA AI",
  start_url: "/inbox",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#000000",
  theme_color: "#000000",
  description: "Messagerie WhatsApp ALPHA AI",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]
});

const SW_JS = `
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'Nouveau message', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Nouveau message WhatsApp';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'whatsapp-inbound',
    renotify: true,
    data: { url: data.url || '/inbox' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/inbox';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if (c.url.includes('/inbox') && 'focus' in c) { c.navigate(url); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
`;

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000000"/><text x="256" y="335" font-family="-apple-system,BlinkMacSystemFont,\'SF Pro Display\',Arial Black,sans-serif" font-size="230" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="-8">AI</text></svg>';

// === Cache HTML pages ===
const cache: any = { dash: null, dashAt: 0, inbox: null, inboxAt: 0 };

// === CORS pour les APIs ===
app.use("/api/*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, X-Skool-Secret");
  if (c.req.method === "OPTIONS") return c.text("", 204);
  await next();
});

// === Helpers ===
async function fetchHtml(url: string, key: string): Promise<string> {
  const atKey = key + "At";
  if (cache[key] && Date.now() - cache[atKey] < 60000) return cache[key];
  const r = await fetch(url);
  cache[key] = await r.text();
  cache[atKey] = Date.now();
  return cache[key];
}

async function fetchAllAirtable(url: string, headers: any): Promise<any[]> {
  let all: any[] = [];
  let offset = "";
  for (let i = 0; i < 20; i++) {
    const u = url + (offset ? "&offset=" + encodeURIComponent(offset) : "");
    const r = await fetch(u, { headers });
    const d: any = await r.json();
    all = all.concat(d.records || []);
    if (!d.offset) break;
    offset = d.offset;
  }
  return all;
}

// === Pages HTML ===
app.get("/", async (c) => c.html(await fetchHtml(HTML_URL, "dash")));
app.get("/inbox", async (c) => {
  let html = await fetchHtml(INBOX_URL, "inbox");
  // Inject apple-touch-icon (iOS Safari uses this in priority for PWA install)
  const appleLinks = '<link rel="apple-touch-icon" href="/icon-192.png" /><link rel="apple-touch-icon" sizes="180x180" href="/icon-192.png" /><link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png" />';
  if (html.includes("</head>")) html = html.replace("</head>", appleLinks + "</head>");
  // Mobile UX fix : closeMobileChat must clear inline display:block on detailPanel + chatArea
  // (renderDetail sets detailPanel.style.display = 'block' which can persist after back button on iOS PWA)
  const mobileFixScript = `<script>
(function(){
  function clearChatInlineStyles(){
    var d = document.getElementById('detailPanel');
    if (d) { d.style.display = ''; d.style.visibility = ''; }
    var c = document.getElementById('chatArea');
    if (c) { c.style.display = ''; }
    document.body.classList.remove('view-chat');
  }
  function patchCloseMobileChat(){
    if (typeof window.closeMobileChat === 'function') {
      var orig = window.closeMobileChat;
      window.closeMobileChat = function(){
        try { orig(); } catch(e){}
        clearChatInlineStyles();
      };
    } else {
      setTimeout(patchCloseMobileChat, 50);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchCloseMobileChat);
  } else {
    patchCloseMobileChat();
  }
  // Also handle browser back / PWA visibility return
  window.addEventListener('popstate', clearChatInlineStyles);
  window.addEventListener('pageshow', function(e){ if (e.persisted) clearChatInlineStyles(); });
})();
</script>`;
  if (html.includes("</body>")) html = html.replace("</body>", mobileFixScript + "</body>");
  else html += mobileFixScript;
  return c.html(html);
});
app.get("/api/health", (c) => c.json({ status: "ok", ts: Date.now() }));

// === PWA endpoints ===
app.get("/manifest.json", () => new Response(MANIFEST_JSON, { headers: { "Content-Type": "application/manifest+json" } }));
app.get("/sw.js", () => new Response(SW_JS, { headers: { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" } }));
// PNG icons: read binary files from repo (Bun.file()), serve with image/png
app.get("/icon-192.png", async () => { const f: any = (globalThis as any).Bun ? (globalThis as any).Bun.file("./icon-192.png") : null; const buf = f ? await f.arrayBuffer() : new ArrayBuffer(0); return new Response(buf, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } }); });
app.get("/icon-512.png", async () => { const f: any = (globalThis as any).Bun ? (globalThis as any).Bun.file("./icon-512.png") : null; const buf = f ? await f.arrayBuffer() : new ArrayBuffer(0); return new Response(buf, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } }); });
// Keep legacy SVG endpoints as fallback
app.get("/icon-192.svg", () => new Response(ICON_SVG, { headers: { "Content-Type": "image/svg+xml" } }));
app.get("/icon-512.svg", () => new Response(ICON_SVG, { headers: { "Content-Type": "image/svg+xml" } }));

app.post("/api/push-subscribe", async (c) => {
  const body = await c.req.json();
  console.log("PUSH_SUB_JSON:", JSON.stringify(body));
  return c.json({ ok: true, note: "Subscription logged. Copy from Railway logs to env var MAXENCE_PUSH_SUBSCRIPTION." });
});

// === API : data (with pagination) ===
app.get("/api/data", async (c) => {
  const headers = { Authorization: "Bearer " + AT_PAT };
  const u1 = "https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG + "?sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&pageSize=100";
  const u2 = "https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_LEADS + "?fields%5B%5D=Phone&fields%5B%5D=Nom&fields%5B%5D=Closer+Status&fields%5B%5D=Date+du+call&pageSize=100";
  const [msgs, leads] = await Promise.all([fetchAllAirtable(u1, headers), fetchAllAirtable(u2, headers)]);
  const leadsByPhone: any = {};
  for (const r of leads) {
    const p = String((r.fields && r.fields.Phone) || "").replace(/\D/g, "");
    if (p) leadsByPhone[p] = Object.assign({ id: r.id }, r.fields);
  }
  return c.json({
    messages: msgs.map((r: any) => Object.assign({ id: r.id, createdTime: r.createdTime }, r.fields)),
    leads: leadsByPhone
  });
});

// === API : send WhatsApp (text or template) ===
app.post("/api/send", async (c) => {
  const body: any = await c.req.json();
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (!phone) return c.json({ ok: false, error: "phone manquant" });
  let payload: any;
  if (body.type === "template") {
    const params: any[] = [];
    if (body.var1) params.push({ type: "text", text: body.var1 });
    if (body.var2) params.push({ type: "text", text: body.var2 });
    payload = {
      messaging_product: "whatsapp", to: phone, type: "template",
      template: { name: body.template, language: { code: "fr" }, components: params.length ? [{ type: "body", parameters: params }] : [] }
    };
  } else {
    payload = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: body.text || "" } };
  }
  const r = await fetch(D360_BASE + "/messages", {
    method: "POST",
    headers: { "D360-API-KEY": D360_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data: any = await r.json();
  if (!r.ok) return c.json({ ok: false, error: data.error || JSON.stringify(data) });
  const msgId = (data.messages && data.messages[0] && data.messages[0].id) || null;
  if (msgId) {
    let content = "", type = "Text", templateName = "";
    if (body.type === "template") {
      content = '[Template "' + body.template + '"] ' + (body.var1 || "") + ' ' + (body.var2 || "");
      content = content.trim();
      type = "Template";
      templateName = body.template;
    } else {
      content = body.text || "";
    }
    try {
      await fetch("https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG, {
        method: "POST",
        headers: { Authorization: "Bearer " + AT_PAT, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { "Message ID": msgId, "Phone": "+" + phone, "Direction": DIR_OUT, "Timestamp": new Date().toISOString(), "Type": type, "Content": content, "Status": "Sent", "Template Name": templateName } })
      });
    } catch (e) {}
  }
  return c.json({ ok: true, id: msgId });
});

// === API : auto-relance opt-in iClosed ===
app.post("/api/iclosed-relance", async (c) => {
  const body: any = await c.req.json();
  const phone = String(body.phone || "").replace(/\D/g, "");
  const firstName = sanitizeFirstName(body.firstName);
  const iclosedId = body.iclosedId || "";
  if (!phone || phone.length < 8) return c.json({ ok: false, error: "phone invalide" });
  const ts7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const dedupFormula = encodeURIComponent('AND(SEARCH("' + phone + '",{Phone}),SEARCH("' + DIR_OUT + '",{Direction}),SEARCH("relance_optin",{Template Name}),IS_AFTER({Timestamp},"' + ts7d + '"))');
  const dedupUrl = "https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG + "?filterByFormula=" + dedupFormula + "&maxRecords=1";
  const dedupRes = await fetch(dedupUrl, { headers: { Authorization: "Bearer " + AT_PAT } });
  const dedupData: any = await dedupRes.json();
  if ((dedupData.records || []).length > 0) {
    return c.json({ ok: true, skipped: "dedup", recentMsg: dedupData.records[0].id });
  }
  const r = await fetch(D360_BASE + "/messages", {
    method: "POST",
    headers: { "D360-API-KEY": D360_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: phone, type: "template",
      template: { name: "relance_optin_v2", language: { code: "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: firstName }] }] }
    })
  });
  const data: any = await r.json();
  if (!r.ok) return c.json({ ok: false, error: data.error || JSON.stringify(data) });
  const msgId = (data.messages && data.messages[0] && data.messages[0].id) || null;
  try {
    await fetch("https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG, {
      method: "POST",
      headers: { Authorization: "Bearer " + AT_PAT, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: {
        "Message ID": msgId, "Phone": "+" + phone, "Direction": DIR_OUT,
        "Timestamp": new Date().toISOString(), "Type": "Template",
        "Content": '[Auto-relance opt-in] ' + firstName + (iclosedId ? ' (iclosedId=' + iclosedId + ')' : ''),
        "Status": "Sent", "Template Name": "relance_optin_v2"
      } })
    });
  } catch (e) {}
  return c.json({ ok: true, sent: true, id: msgId, phone, firstName });
});

// === API : auto-relance Skool (lead qui ghoste après 3 messages bot) ===
app.post("/api/skool-relance", async (c) => {
  const SKOOL_SECRET = (typeof process !== "undefined" && process.env && process.env.SKOOL_SECRET) || "";
  const provided = c.req.header("X-Skool-Secret");
  if (!SKOOL_SECRET || provided !== SKOOL_SECRET) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const body: any = await c.req.json();
  const phone = String(body.phone || "").replace(/\D/g, "");
  const firstName = sanitizeFirstName(body.firstName);
  const skoolUsername = body.skoolUsername || "";
  if (!phone || phone.length < 8) return c.json({ ok: false, error: "phone invalide" }, 400);
  // Dedup 7 jours
  const ts7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const dedupFormula = encodeURIComponent('AND(SEARCH("' + phone + '",{Phone}),SEARCH("' + DIR_OUT + '",{Direction}),SEARCH("relance_skool",{Template Name}),IS_AFTER({Timestamp},"' + ts7d + '"))');
  const dedupUrl = "https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG + "?filterByFormula=" + dedupFormula + "&maxRecords=1";
  const dedupRes = await fetch(dedupUrl, { headers: { Authorization: "Bearer " + AT_PAT } });
  const dedupData: any = await dedupRes.json();
  if ((dedupData.records || []).length > 0) {
    return c.json({ ok: true, skipped: "dedup", recentMsg: dedupData.records[0].id });
  }
  // Hash phone → variant A/B/C
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = ((hash << 5) - hash + phone.charCodeAt(i)) | 0;
  const variants = ["A", "B", "C"];
  const variant = variants[Math.abs(hash) % 3];
  const templateName = "relance_skool_v1_" + variant.toLowerCase();
  // Send template
  const r = await fetch(D360_BASE + "/messages", {
    method: "POST",
    headers: { "D360-API-KEY": D360_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: phone, type: "template",
      template: { name: templateName, language: { code: "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: firstName }] }] }
    })
  });
  const data: any = await r.json();
  if (!r.ok) return c.json({ ok: false, error: data.error || JSON.stringify(data), variant, templateName });
  const msgId = (data.messages && data.messages[0] && data.messages[0].id) || null;
  try {
    await fetch("https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG, {
      method: "POST",
      headers: { Authorization: "Bearer " + AT_PAT, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: {
        "Message ID": msgId, "Phone": "+" + phone, "Direction": DIR_OUT,
        "Timestamp": new Date().toISOString(), "Type": "Template",
        "Content": firstName + (skoolUsername ? " (@" + skoolUsername + ")" : ""),
        "Status": "Sent", "Template Name": templateName
      } })
    });
  } catch (e) {}
  return c.json({ ok: true, sent: true, id: msgId, phone, firstName, variant });
});

// === Webhook 360dialog : GET (challenge) ===
app.get("/api/webhook/d360", (c) => {
  const ch = c.req.query("hub.challenge") || c.req.query("challenge");
  if (ch) return c.text(ch);
  return c.json({ ok: true, info: "d360 webhook ready" });
});

// === Webhook 360dialog : POST (parse + dedup + log + relais Skool + dispatch) ===
app.post("/api/webhook/d360", async (c) => {
  const SKOOL_SECRET = (typeof process !== "undefined" && process.env && process.env.SKOOL_SECRET) || "";
  const SKOOL_BOT_URL = (typeof process !== "undefined" && process.env && process.env.SKOOL_BOT_REPLY_URL) || "https://skool-setter-bot-production.up.railway.app/api/whatsapp-reply";
  const LEGACY_URL = (typeof process !== "undefined" && process.env && process.env.LEGACY_AIRTABLE_WEBHOOK_URL) || "";

  let body: any;
  try { body = await c.req.json(); } catch (e) { return c.json({ ok: false, error: "invalid json" }, 400); }

  // Optional cascade vers legacy Airtable webhook
  if (LEGACY_URL && LEGACY_URL.startsWith("http")) {
    try { fetch(LEGACY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}); } catch (e) {}
  }

  let messages: any[] = [];
  let contacts: any[] = [];
  if (body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0]) {
    const value = body.entry[0].changes[0].value || {};
    messages = value.messages || [];
    contacts = value.contacts || [];
  }
  if (body.messages) { messages = body.messages; contacts = body.contacts || []; }
  if (messages.length === 0) return c.json({ ok: true, skipped: "no messages" });

  const results: any[] = [];
  for (const msg of messages) {
    try {
      const phone = String(msg.from || "").replace(/\D/g, "");
      const msgId = msg.id || "";
      const ts = msg.timestamp ? parseInt(msg.timestamp) * 1000 : Date.now();
      let text = "";
      if (msg.type === "text") text = (msg.text && msg.text.body) || "";
      else if (msg.type === "button") text = (msg.button && msg.button.text) || "";
      else if (msg.type === "interactive") text = JSON.stringify(msg.interactive || {});
      else text = "[" + (msg.type || "media") + "]";

      const contact = (contacts || []).find((x: any) => x.wa_id === msg.from) || {};
      const firstName = (contact.profile && contact.profile.name) || "";

      // Dedup msg.id (idempotence)
      const dedupUrl = "https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG + "?filterByFormula=" + encodeURIComponent('{Message ID}="' + msgId + '"') + "&maxRecords=1";
      const dedupRes = await fetch(dedupUrl, { headers: { Authorization: "Bearer " + AT_PAT } });
      const dedupData: any = await dedupRes.json();
      if ((dedupData.records || []).length > 0) {
        results.push({ phone, skipped: "duplicate_msg_id", msgId });
        continue;
      }

      // Log Airtable Inbound
      try {
        await fetch("https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG, {
          method: "POST",
          headers: { Authorization: "Bearer " + AT_PAT, "Content-Type": "application/json" },
          body: JSON.stringify({ fields: {
            "Message ID": msgId, "Phone": "+" + phone, "Direction": DIR_IN,
            "Timestamp": new Date(ts).toISOString(), "Type": msg.type === "text" ? "Text" : "Media",
            "Content": text, "Status": "Received"
          } })
        });
      } catch (e) {}

      // Fire Web Push notif to Maxence (fire-and-forget, non-blocking)
      try {
        const pushTitle = firstName ? (firstName + " · WhatsApp") : ("WhatsApp +" + phone.slice(-4));
        const pushBody = text || "[Nouveau message]";
        firePushToMaxence(pushTitle, pushBody, "/inbox", "wa-" + phone).catch((e) => console.error("PUSH_FAIL:", String(e)));
      } catch (e) { console.error("PUSH_SCHED_FAIL:", String(e)); }

      // Build conversation_history depuis Airtable
      const histUrl = "https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG + "?filterByFormula=" + encodeURIComponent('SEARCH("' + phone + '",{Phone})') + "&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=20";
      const histRes = await fetch(histUrl, { headers: { Authorization: "Bearer " + AT_PAT } });
      const histData: any = await histRes.json();
      const conversation_history = ((histData.records || []).map((r: any) => ({
        direction: (r.fields.Direction || "").indexOf("Inbound") >= 0 ? "in" : "out",
        body: r.fields.Content || "",
        ts: Math.floor(new Date(r.fields.Timestamp || r.createdTime).getTime() / 1000)
      }))).reverse();

      // POST chez Skool
      if (!SKOOL_SECRET) {
        results.push({ phone, error: "SKOOL_SECRET not set" });
        continue;
      }
      const skoolHeaders: any = { "X-Skool-Secret": SKOOL_SECRET, "Content-Type": "application/json" };
      if (Date.now() - ts > 3600000) skoolHeaders["X-Inbound-Ts"] = String(Math.floor(ts / 1000));

      const skoolRes = await fetch(SKOOL_BOT_URL, {
        method: "POST",
        headers: skoolHeaders,
        body: JSON.stringify({ phone: "+" + phone, body: text, first_name: firstName, conversation_history })
      });
      const skoolData: any = await skoolRes.json();
      const action = skoolData.action || "skip";

      if (action === "send" && skoolData.draft) {
        const sendRes = await fetch(D360_BASE + "/messages", {
          method: "POST",
          headers: { "D360-API-KEY": D360_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: skoolData.draft } })
        });
        const sendData: any = await sendRes.json();
        const sentMsgId = (sendData.messages && sendData.messages[0] && sendData.messages[0].id) || null;
        if (sentMsgId) {
          try {
            await fetch("https://api.airtable.com/v0/" + AT_BASE + "/" + AT_TBL_MSG, {
              method: "POST",
              headers: { Authorization: "Bearer " + AT_PAT, "Content-Type": "application/json" },
              body: JSON.stringify({ fields: {
                "Message ID": sentMsgId, "Phone": "+" + phone, "Direction": DIR_OUT,
                "Timestamp": new Date().toISOString(), "Type": "Text",
                "Content": skoolData.draft, "Status": "Sent"
              } })
            });
          } catch (e) {}
        }
        results.push({ phone, action: "send", sentMsgId, phase: skoolData.phase });
      } else if (action === "human_required") {
        results.push({ phone, action: "human_required", reason: skoolData.reason });
      } else {
        results.push({ phone, action: "skip", reason: skoolData.reason });
      }
    } catch (e) {
      results.push({ error: String(e) });
    }
  }

  return c.json({ ok: true, processed: results.length, results });
});

// === Test endpoint : ping Skool bot ===
app.get("/api/test-skool-bot", async (c) => {
  const SKOOL_SECRET = (typeof process !== "undefined" && process.env && process.env.SKOOL_SECRET) || "";
  const SKOOL_BOT_URL = (typeof process !== "undefined" && process.env && process.env.SKOOL_BOT_REPLY_URL) || "https://skool-setter-bot-production.up.railway.app/api/whatsapp-reply";
  if (!SKOOL_SECRET) return c.json({ error: "SKOOL_SECRET not set", endpoint: SKOOL_BOT_URL }, 500);
  try {
    const r = await fetch(SKOOL_BOT_URL, {
      method: "POST",
      headers: { "X-Skool-Secret": SKOOL_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+33611111111", body: "salut, ca parle de quoi votre truc", first_name: "TestPing" })
    });
    const text = await r.text();
    let data: any;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return c.json({ status: r.status, endpoint: SKOOL_BOT_URL, data });
  } catch (e) {
    return c.json({ error: String(e), endpoint: SKOOL_BOT_URL }, 500);
  }
});

export default app;
