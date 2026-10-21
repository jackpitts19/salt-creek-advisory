/**
 * Buyer-list sign-ups: the form on /investors, posted here, delivered to HelmIQ.
 *
 * The browser posts multipart form data to BUYER_LIST_PATH on this origin: who
 * the buyer is, what they buy (sectors, size ranges, regions, fund; see
 * src/buyer-criteria.js), and optionally their one-pager (a PDF) or a short note.
 * This module checks it, signs it with a secret the public repository never
 * holds, and sends it to the firm's HelmIQ intake endpoint, where the buyer
 * lands on the buyer list with their criteria filled in and the one-pager
 * attached to their firm. If
 * HelmIQ is not configured yet, or does not answer, the fields go to the site's
 * existing Formspree form instead, so a sign-up is never lost.
 *
 * Wire contract v3 (HelmIQ side; v2 plus the typed `criteria` object): POST HELMIQ_INTAKE_URL as multipart with a
 * `payload` part (the JSON from buildIntakePayload) and an optional `onePager`
 * part (the PDF), and
 *   X-HelmIQ-Timestamp: unix seconds
 *   X-HelmIQ-Signature: sha256=<hex HMAC-SHA256(HELMIQ_SIGNING_SECRET, `${ts}.${payload}`)>
 * The file is covered by the signature through onePager.sha256 in the payload.
 *
 * Worker secrets, set with `wrangler secret put`, never in wrangler.toml:
 *   HELMIQ_INTAKE_URL     the full intake URL HelmIQ Settings shows
 *   HELMIQ_SIGNING_SECRET the signing secret shown beside it
 *   TURNSTILE_SECRET_KEY  Cloudflare Turnstile secret for this site
 *   IP_HASH_SALT          any long random string; visitor IPs are only ever sent hashed
 * Public variable, in wrangler.toml [vars]: TURNSTILE_SITE_KEY.
 *
 * The form accepts nothing until Turnstile is fully set up (site key AND secret).
 * Without it anyone could script sign-ups that put other people's addresses on
 * the list with consent recorded. ALLOW_NO_TURNSTILE = "true" lifts that for
 * local testing only; never set it in production.
 */

import { describeCriteria, validateCriteria } from "./buyer-criteria.js";

export const BUYER_LIST_PATH = "/api/buyer-list";

// Vercel, where HelmIQ runs, takes at most 4.5 MB per request; the file cap leaves
// room for the rest of the multipart body.
export const MAX_ONE_PAGER_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_ONE_PAGER_BYTES + 64 * 1024;
const HELMIQ_TIMEOUT_MS = 15000;
const HELMIQ_ATTEMPTS = 2;
const FALLBACK_ENDPOINT = "https://formspree.io/f/xzdqavol";
const SITE_ORIGIN = "https://saltcreekadvisory.com";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// The exact words beside the checkbox. Change both together, and bump the version:
// HelmIQ stores the version with every sign-up as the record of what was agreed to.
export const CONSENT_TEXT_VERSION = "2026-10-19";
export const CONSENT_TEXT =
  "Email me client opportunities that fit what I told you. I can unsubscribe at any time.";

// Value on the wire -> label the buyer saw. Order is the order on the form.
export const BUYER_TYPES = new Map([
  ["private_equity", "Private equity fund"],
  ["independent_sponsor", "Independent sponsor"],
  ["search_fund", "Search fund or searcher"],
  ["family_office", "Family office"],
  ["strategic", "Strategic or corporate acquirer"],
  ["holding_company", "Holding company"],
  ["other", "Other"],
]);

const LIMITS = { fullName: 120, email: 254, firmName: 160, firmWebsite: 200, whatYouBuy: 2000, filename: 200 };
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Single-line fields end up in an email subject on the fallback path, so line
// breaks and other control characters never survive into them.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
function line(value) {
  return text(value).replace(CONTROL_CHARS, " ").replace(/\s{2,}/g, " ").trim();
}

// A file name is shown to bankers and stored; keep only its last path segment.
function safeFilename(name) {
  const base = line(name).split(/[\\/]/).pop() || "one-pager.pdf";
  return base.slice(0, LIMITS.filename);
}

function isFile(value) {
  return value !== null && typeof value === "object" && typeof value.arrayBuffer === "function";
}

/**
 * Checks who the buyer is and returns either the clean fields or the first
 * problem, named by the form field it belongs to so the page can point at it.
 * What they buy is checked by validateCriteria, and the one-pager by
 * checkOnePager (reading it is asynchronous); both are optional extras here,
 * because the typed criteria are what HelmIQ matches deals on.
 * @param {Record<string, unknown>} raw the form's text fields
 * @returns {{ ok: true, fields: object } | { ok: false, field: string, error: string }}
 */
export function validateSignup(raw) {
  const bad = (field, error) => ({ ok: false, field, error });
  if (!raw || typeof raw !== "object") return bad("form", "Something went wrong. Please try again.");

  const fullName = line(raw.fullName);
  if (!fullName || fullName.length > LIMITS.fullName) return bad("fullName", "Please enter your name.");

  const email = line(raw.email).toLowerCase();
  if (!EMAIL_SHAPE.test(email) || email.length > LIMITS.email) return bad("email", "Please enter a valid work email.");

  const firmName = line(raw.firmName);
  if (!firmName || firmName.length > LIMITS.firmName) return bad("firmName", "Please enter your firm's name.");

  const firmWebsite = line(raw.firmWebsite);
  if (firmWebsite.length > LIMITS.firmWebsite) return bad("firmWebsite", "That website address is too long.");

  const buyerType = text(raw.buyerType);
  if (!BUYER_TYPES.has(buyerType)) return bad("buyerType", "Please choose what kind of buyer you are.");

  const whatYouBuy = text(raw.whatYouBuy);
  if (whatYouBuy.length > LIMITS.whatYouBuy) {
    return bad("whatYouBuy", `Please keep this under ${LIMITS.whatYouBuy} characters.`);
  }

  if (raw.consent !== "yes" && raw.consent !== true) {
    return bad("consent", "Please tick the box so we can email you opportunities.");
  }

  return { ok: true, fields: { fullName, email, firmName, firmWebsite, buyerType, whatYouBuy } };
}

/**
 * Reads and checks an uploaded one-pager: a real PDF (by its first bytes, not its
 * name), under the size cap.
 * @returns {Promise<{ ok: true, file: { bytes: Uint8Array, filename: string } | null } | { ok: false, status: number, field: string, error: string }>}
 */
export async function checkOnePager(value) {
  if (!isFile(value) || value.size === 0) return { ok: true, file: null };
  const tooBig = { ok: false, status: 413, field: "onePager", error: "That file is over 4 MB. Please upload a smaller PDF, or email it to us." };
  if (value.size > MAX_ONE_PAGER_BYTES) return tooBig;
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (bytes.length > MAX_ONE_PAGER_BYTES) return tooBig;
  if (!PDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return { ok: false, status: 400, field: "onePager", error: "Please upload your one-pager as a PDF." };
  }
  return { ok: true, file: { bytes, filename: safeFilename(value.name) } };
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/**
 * HMAC-SHA256 over `${timestamp}.${payload}`, the scheme HelmIQ verifies.
 * @returns {Promise<string>} lowercase hex
 */
export async function signBody(secret, timestamp, body) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

/**
 * The exact v3 payload HelmIQ's intake endpoint accepts. Optional keys are left
 * out rather than sent empty, because HelmIQ rejects unknown or malformed keys.
 * `fields.criteria` is the object validateCriteria returned.
 */
export function buildIntakePayload(fields, onePager, { submissionId, submittedAt, sourceUrl, ipHash }) {
  const payload = {
    version: 3,
    submissionId,
    submittedAt,
    sourceUrl,
    ipHash,
    consent: { given: true, textVersion: CONSENT_TEXT_VERSION, text: CONSENT_TEXT },
    contact: { fullName: fields.fullName, email: fields.email },
    firm: fields.firmWebsite ? { name: fields.firmName, website: fields.firmWebsite } : { name: fields.firmName },
    buyerType: fields.buyerType,
    buyerTypeLabel: BUYER_TYPES.get(fields.buyerType),
  };
  const extras = {
    ...(fields.criteria && Object.keys(fields.criteria).length > 0 && { criteria: fields.criteria }),
    ...(fields.whatYouBuy && { whatYouBuy: fields.whatYouBuy }),
    ...(onePager && { onePager }),
  };
  return { ...payload, ...extras };
}

async function postWithTimeout(url, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one signed sign-up to HelmIQ, retrying once on a server error or timeout
 * with the same submissionId (HelmIQ treats a repeat as a duplicate, not a second
 * sign-up). Returns "applied" on any 200, "invalid" on a 400, "failed" otherwise;
 * the caller sends anything but "applied" to the fallback.
 */
export async function deliverToHelmIQ(payload, file, env, fetchImpl = fetch, now = () => Date.now()) {
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= HELMIQ_ATTEMPTS; attempt += 1) {
    const timestamp = String(Math.floor(now() / 1000));
    const signature = await signBody(env.HELMIQ_SIGNING_SECRET, timestamp, body);
    // Built fresh per attempt: a FormData body is consumed by the request that sends it.
    const form = new FormData();
    form.append("payload", new Blob([body], { type: "application/json" }), "payload.json");
    if (file) form.append("onePager", new Blob([file.bytes], { type: "application/pdf" }), file.filename);
    let response;
    try {
      response = await postWithTimeout(env.HELMIQ_INTAKE_URL, {
        method: "POST",
        headers: { "x-helmiq-timestamp": timestamp, "x-helmiq-signature": `sha256=${signature}` },
        body: form,
      }, fetchImpl, HELMIQ_TIMEOUT_MS);
    } catch {
      continue;
    }
    if (response.status === 200) return "applied";
    if (response.status === 400) return "invalid";
    if (response.status < 500) return "failed";
  }
  return "failed";
}

/**
 * The safety net: the same fields to Formspree, which already receives the
 * contact and valuation forms and is already named in the privacy policy. The
 * free Formspree plan takes no attachments, so an uploaded one-pager is named in
 * the email for a banker to ask for, rather than silently dropped.
 */
export async function deliverToFallback(fields, file, submissionId, fetchImpl = fetch) {
  const body = {
    _subject: `Buyer list sign-up: ${fields.firmName}`,
    form: "buyer-list",
    submissionId,
    name: fields.fullName,
    email: fields.email,
    firm: fields.firmName,
    website: fields.firmWebsite,
    buyerType: BUYER_TYPES.get(fields.buyerType),
    criteria: fields.criteria ? describeCriteria(fields.criteria) : "",
    whatTheyBuy: fields.whatYouBuy,
    onePager: file
      ? `They uploaded a one-pager (${file.filename}, ${Math.ceil(file.bytes.length / 1024)} KB) that could not be forwarded here. Ask them to email it.`
      : "None uploaded.",
    consent: `${CONSENT_TEXT} (version ${CONSENT_TEXT_VERSION})`,
  };
  try {
    const response = await postWithTimeout(FALLBACK_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: SITE_ORIGIN,
        referer: `${SITE_ORIGIN}/investors`,
      },
      body: JSON.stringify(body),
    }, fetchImpl, HELMIQ_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

// The criteria answers as validateCriteria reads them: the two tick-box groups
// as lists, every other answer as the text typed.
const CRITERIA_TEXT_FIELDS = [
  "ebitdaMinM", "ebitdaMaxM", "revenueMinM", "revenueMaxM",
  "addOnEbitdaMinM", "addOnEbitdaMaxM", "currentFundSizeM", "currentFundVintage",
];
function criteriaFields(form) {
  const answers = Object.fromEntries(CRITERIA_TEXT_FIELDS.map((name) => [name, form.get(name) ?? ""]));
  return { ...answers, sectors: form.getAll("sectors"), geography: form.getAll("geography") };
}

function turnstileReady(env) {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

async function turnstilePasses(token, ip, env, fetchImpl) {
  if (!turnstileReady(env)) return env.ALLOW_NO_TURNSTILE === "true";
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const response = await postWithTimeout(TURNSTILE_VERIFY_URL, { method: "POST", body: form }, fetchImpl, HELMIQ_TIMEOUT_MS);
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}

/**
 * Handles GET (the public Turnstile site key the form needs) and POST (a sign-up).
 * `deps` lets the tests replace the network and the clock.
 */
export async function handleBuyerList(request, env, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.randomUUID ?? (() => crypto.randomUUID());

  if (request.method === "GET" || request.method === "HEAD") {
    return reply(200, { turnstileSiteKey: turnstileReady(env) ? env.TURNSTILE_SITE_KEY : null });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD, POST" } });
  }

  // Same-origin only. The browser always sends Origin on a fetch POST.
  if (request.headers.get("origin") !== SITE_ORIGIN) return reply(403, { ok: false, error: "Not allowed." });
  if (!(request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
    return reply(415, { ok: false, error: "Not allowed." });
  }

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (env.BUYER_LIST_LIMITER) {
    const { success } = await env.BUYER_LIST_LIMITER.limit({ key: ip || "unknown" });
    if (!success) return reply(429, { ok: false, error: "Too many attempts. Please wait a minute and try again." });
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REQUEST_BYTES) {
    return reply(413, { ok: false, field: "onePager", error: "That file is over 4 MB. Please upload a smaller PDF, or email it to us." });
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { ok: false, field: "form", error: "Something went wrong. Please try again." });
  }

  // The honeypot: a field people never see. A bot that fills it is told it worked.
  if (text(form.get("website_confirm"))) return reply(200, { ok: true });

  if (!turnstileReady(env) && env.ALLOW_NO_TURNSTILE !== "true") {
    return reply(503, { ok: false, field: "form", error: "The buyer list form is not open yet. Please email jack@saltcreekadvisory.com and we will add you." });
  }
  if (!(await turnstilePasses(form.get("turnstileToken"), ip, env, fetchImpl))) {
    return reply(400, { ok: false, field: "turnstile", error: "Please complete the check above the button and try again." });
  }

  const upload = form.get("onePager");
  const checked = validateSignup({
    fullName: form.get("fullName"),
    email: form.get("email"),
    firmName: form.get("firmName"),
    firmWebsite: form.get("firmWebsite"),
    buyerType: form.get("buyerType"),
    whatYouBuy: form.get("whatYouBuy"),
    consent: form.get("consent"),
  });
  if (!checked.ok) return reply(400, { ok: false, field: checked.field, error: checked.error });
  const wanted = validateCriteria(criteriaFields(form), checked.fields.buyerType, new Date(now()).getUTCFullYear());
  if (!wanted.ok) return reply(400, { ok: false, field: wanted.field, error: wanted.error });
  const fields = { ...checked.fields, criteria: wanted.criteria };

  const onePager = await checkOnePager(upload);
  if (!onePager.ok) return reply(onePager.status, { ok: false, field: onePager.field, error: onePager.error });
  const file = onePager.file;

  const submissionId = newId();
  // The salt is required: without it a hashed IPv4 address can be recovered by
  // trying all four billion, and the privacy policy says HelmIQ never gets it.
  const configured = Boolean(env.HELMIQ_INTAKE_URL && env.HELMIQ_SIGNING_SECRET && env.IP_HASH_SALT);
  if (configured) {
    const fileMeta = file
      ? { filename: file.filename, bytes: file.bytes.length, sha256: await sha256Hex(file.bytes), contentType: "application/pdf" }
      : null;
    const payload = buildIntakePayload(fields, fileMeta, {
      submissionId,
      submittedAt: new Date(now()).toISOString(),
      sourceUrl: `${SITE_ORIGIN}/investors`,
      ipHash: await sha256Hex(`${env.IP_HASH_SALT}${ip}`),
    });
    const outcome = await deliverToHelmIQ(payload, file, env, fetchImpl, now);
    // No names, emails or firms in logs: the id and the outcome are enough to trace.
    console.log(JSON.stringify({ event: "buyer_list_signup", submissionId, outcome, onePager: Boolean(file) }));
    if (outcome === "applied") return reply(200, { ok: true });
    // "invalid" means HelmIQ refused a sign-up this file already accepted: the two
    // validators have drifted, which is not the buyer's mistake. The fallback below
    // keeps the sign-up, and the logged outcome shows the drift.
  }

  const saved = await deliverToFallback(fields, file, submissionId, fetchImpl);
  console.log(JSON.stringify({ event: "buyer_list_signup", submissionId, outcome: saved ? "fallback" : "lost" }));
  if (saved) return reply(200, { ok: true });
  return reply(502, { ok: false, field: "form", error: "We could not send this just now. Please email jack@saltcreekadvisory.com instead." });
}
