// Tests for the buyer list form's Worker route (src/buyer-intake.js).
//
//   node tools/test_buyer_intake.mjs
//
// The network is replaced by a recording fake, so nothing here reaches HelmIQ,
// Formspree or Cloudflare. The signature test recomputes the HMAC with Node's own
// crypto, which is what HelmIQ's verifier does, so a scheme drift fails here first.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../src/index.js";
import {
  BUYER_LIST_PATH, BUYER_TYPES, CONSENT_TEXT, CONSENT_TEXT_VERSION, MAX_ONE_PAGER_BYTES,
  NEWS_CONSENT_TEXT, NEWS_CONSENT_TEXT_VERSION, handleBuyerList, normalizePhone, validateSignup,
} from "../src/buyer-intake.js";
import { GEOGRAPHY, SECTORS, describeCriteria, parseMillions, validateCriteria } from "../src/buyer-criteria.js";

const ORIGIN = "https://saltcreekadvisory.com";
const INTAKE_URL = "https://helmiq.example/api/webhooks/buyer-intake/org_1/tok_1";
const SECRET = "test-signing-secret";
const FORMSPREE = "https://formspree.io/f/xzdqavol";
const NOW = Date.UTC(2026, 9, 19, 17, 0, 0);
const UUID = "11111111-2222-4333-8444-555555555555";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

const VALID = {
  fullName: "Pat Buyer",
  email: "Pat@Example-Capital.com",
  title: "Partner",
  phone: "(312) 555-0123",
  firmName: "Example Capital",
  firmWebsite: "example-capital.com",
  buyerType: "private_equity",
  sectors: ["Healthcare", "Business Services"],
  ebitdaMinM: "3",
  ebitdaMaxM: "15",
  whatYouBuy: "",
  consent: "yes",
  website_confirm: "",
  turnstileToken: "",
};

function fakeNetwork(script) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const next = script(url, calls.length);
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

const ok = (body = { ok: true, status: "applied" }) => new Response(JSON.stringify(body), { status: 200 });
const status = (code) => new Response(JSON.stringify({ ok: false }), { status: code });

function post(fields = {}, { file = PDF, filename = "Example Capital one-pager.pdf", headers = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...VALID, ...fields })) {
    for (const item of [value].flat()) form.append(key, item);
  }
  if (file) form.append("onePager", new Blob([file], { type: "application/pdf" }), filename);
  return new Request(`${ORIGIN}${BUYER_LIST_PATH}`, {
    method: "POST",
    headers: { origin: ORIGIN, "cf-connecting-ip": "203.0.113.7", ...headers },
    body: form,
  });
}

// What HelmIQ receives: the multipart body re-parsed, the way its route will.
async function received(call) {
  const form = await new Response(call.init.body).formData();
  const payloadPart = form.get("payload");
  const payloadText = await payloadPart.text();
  const file = form.get("onePager");
  return {
    payloadText,
    payload: JSON.parse(payloadText),
    payloadType: payloadPart.type,
    file: file ? new Uint8Array(await file.arrayBuffer()) : null,
    filename: file ? file.name : null,
    fileType: file ? file.type : null,
  };
}

const OPEN = { ALLOW_NO_TURNSTILE: "true" };
const CONFIGURED = { ...OPEN, HELMIQ_INTAKE_URL: INTAKE_URL, HELMIQ_SIGNING_SECRET: SECRET, IP_HASH_SALT: "salt" };
const deps = (fetchImpl) => ({ fetch: fetchImpl, now: () => NOW, randomUUID: () => UUID });

test("GET hands the form the site key only when the check can actually be completed", async () => {
  const get = (env) => handleBuyerList(new Request(`${ORIGIN}${BUYER_LIST_PATH}`), env).then((r) => r.json());
  assert.deepEqual(await get({}), { turnstileSiteKey: null });
  assert.deepEqual(await get({ TURNSTILE_SITE_KEY: "0xAAA" }), { turnstileSiteKey: null });
  assert.deepEqual(await get({ TURNSTILE_SITE_KEY: "0xAAA", TURNSTILE_SECRET_KEY: "s" }), { turnstileSiteKey: "0xAAA" });
});

test("without the bot check set up, the form is closed and nothing is sent anywhere", async () => {
  for (const env of [{}, { TURNSTILE_SECRET_KEY: "s" }, { TURNSTILE_SITE_KEY: "0xAAA" },
    { HELMIQ_INTAKE_URL: INTAKE_URL, HELMIQ_SIGNING_SECRET: SECRET, IP_HASH_SALT: "salt" }]) {
    const { calls, fetchImpl } = fakeNetwork(() => ok());
    const response = await handleBuyerList(post(), env, deps(fetchImpl));
    assert.equal(response.status, 503, JSON.stringify(Object.keys(env)));
    assert.match((await response.json()).error, /email/);
    assert.equal(calls.length, 0);
  }
});

test("a POST from another origin, or not as form data, is refused before anything is sent", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const foreign = await handleBuyerList(post({}, { headers: { origin: "https://evil.example" } }), CONFIGURED, deps(fetchImpl));
  assert.equal(foreign.status, 403);
  const json = new Request(`${ORIGIN}${BUYER_LIST_PATH}`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(VALID),
  });
  assert.equal((await handleBuyerList(json, CONFIGURED, deps(fetchImpl))).status, 415);
  assert.equal(calls.length, 0);
});

test("a filled honeypot is told it worked and nothing is sent", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const response = await handleBuyerList(post({ website_confirm: "http://spam" }), CONFIGURED, deps(fetchImpl));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 0);
});

test("a bad field comes back as a 400 naming that field, and nothing is sent", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const cases = [
    [{ email: "not-an-email" }, "email"],
    [{ fullName: "" }, "fullName"],
    [{ firmName: "" }, "firmName"],
    [{ buyerType: "hedge_fund" }, "buyerType"],
    [{ consent: "" }, "consent"],
    [{ title: "  " }, "title"],
    [{ title: "x".repeat(121) }, "title"],
    [{ phone: "555-0123" }, "phone"],
    [{ phone: "call me" }, "phone"],
    [{ whatYouBuy: "x".repeat(2001) }, "whatYouBuy"],
    [{ sectors: [] }, "sectors"],
    [{ ebitdaMinM: "", ebitdaMaxM: "" }, "ebitdaMinM"],
    [{ ebitdaMaxM: "2" }, "ebitdaMaxM"],
    [{ revenueMinM: "lots" }, "revenueMinM"],
  ];
  for (const [patch, field] of cases) {
    const response = await handleBuyerList(post(patch), CONFIGURED, deps(fetchImpl));
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.equal((await response.json()).field, field, JSON.stringify(patch));
  }
  assert.equal(calls.length, 0);
});

test("the typed criteria are enough on their own; a one-pager and a note are optional extras", async () => {
  const criteriaOnly = fakeNetwork(() => ok());
  const bare = await handleBuyerList(post({ whatYouBuy: "" }, { file: null }), CONFIGURED, deps(criteriaOnly.fetchImpl));
  assert.equal(bare.status, 200);
  const bareSent = await received(criteriaOnly.calls[0]);
  assert.ok(!("whatYouBuy" in bareSent.payload));
  assert.ok(!("onePager" in bareSent.payload));
  assert.deepEqual(bareSent.payload.criteria, { sectors: ["Business Services", "Healthcare"], ebitdaMinM: 3, ebitdaMaxM: 15 });

  const noteOnly = fakeNetwork(() => ok());
  const note = await handleBuyerList(post({ whatYouBuy: "HVAC add-ons, $2-10M EBITDA" }, { file: null }), CONFIGURED, deps(noteOnly.fetchImpl));
  assert.equal(note.status, 200);
  const sent = await received(noteOnly.calls[0]);
  assert.equal(sent.payload.whatYouBuy, "HVAC add-ons, $2-10M EBITDA");
  assert.ok(!("onePager" in sent.payload));
  assert.equal(sent.file, null);

  const fileOnly = fakeNetwork(() => ok());
  assert.equal((await handleBuyerList(post(), CONFIGURED, deps(fileOnly.fetchImpl))).status, 200);
});

test("only a real PDF under 4 MB is accepted, whatever its name says", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const notPdf = await handleBuyerList(post({}, { file: new TextEncoder().encode("MZ executable"), filename: "deck.pdf" }), CONFIGURED, deps(fetchImpl));
  assert.equal(notPdf.status, 400);
  assert.equal((await notPdf.json()).field, "onePager");

  const big = new Uint8Array(MAX_ONE_PAGER_BYTES + 1);
  big.set(PDF);
  const tooBig = await handleBuyerList(post({}, { file: big }), CONFIGURED, deps(fetchImpl));
  assert.equal(tooBig.status, 413);

  const declared = await handleBuyerList(post({}, { headers: { "content-length": String(10 * 1024 * 1024) } }), CONFIGURED, deps(fetchImpl));
  assert.equal(declared.status, 413);
  assert.equal(calls.length, 0);
});

test("a configured sign-up reaches HelmIQ signed over the payload part, with the file bound by its hash", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const response = await handleBuyerList(post(), CONFIGURED, deps(fetchImpl));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, INTAKE_URL);
  const sent = await received(call);
  const timestamp = call.init.headers["x-helmiq-timestamp"];
  assert.equal(timestamp, String(Math.floor(NOW / 1000)));
  const expected = createHmac("sha256", SECRET).update(`${timestamp}.${sent.payloadText}`).digest("hex");
  assert.equal(call.init.headers["x-helmiq-signature"], `sha256=${expected}`);
  assert.equal(sent.payloadType, "application/json");
  assert.deepEqual(sent.file, PDF);
  assert.equal(sent.fileType, "application/pdf");
  assert.equal(sent.filename, "Example Capital one-pager.pdf");
  assert.deepEqual(sent.payload.onePager, {
    filename: "Example Capital one-pager.pdf",
    bytes: PDF.length,
    sha256: createHash("sha256").update(PDF).digest("hex"),
    contentType: "application/pdf",
  });
});

test("the HelmIQ payload is exactly the v3 contract, with empty optionals left out", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  await handleBuyerList(post(), CONFIGURED, deps(fetchImpl));
  const { payload } = await received(calls[0]);
  assert.deepEqual(Object.keys(payload).sort(), [
    "buyerType", "buyerTypeLabel", "consent", "contact", "criteria", "firm", "ipHash", "onePager",
    "sourceUrl", "submissionId", "submittedAt", "version",
  ]);
  assert.equal(payload.version, 3);
  assert.equal(payload.submissionId, UUID);
  assert.equal(payload.submittedAt, "2026-10-19T17:00:00.000Z");
  assert.equal(payload.sourceUrl, `${ORIGIN}/investors`);
  assert.match(payload.ipHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(payload.consent, { given: true, textVersion: CONSENT_TEXT_VERSION, text: CONSENT_TEXT });
  assert.deepEqual(payload.contact, {
    fullName: "Pat Buyer", email: "pat@example-capital.com", title: "Partner", phone: "+13125550123",
  });
  assert.deepEqual(payload.firm, { name: "Example Capital", website: "example-capital.com" });
  assert.equal(payload.buyerTypeLabel, "Private equity fund");
});

test("the news box, when ticked, sends its own consent beside the deal consent", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  await handleBuyerList(post({ newsConsent: "yes" }), CONFIGURED, deps(fetchImpl));
  const { payload } = await received(calls[0]);
  assert.deepEqual(payload.newsConsent, { given: true, textVersion: NEWS_CONSENT_TEXT_VERSION, text: NEWS_CONSENT_TEXT });
  assert.deepEqual(payload.consent, { given: true, textVersion: CONSENT_TEXT_VERSION, text: CONSENT_TEXT });
});

test("an unticked or odd news value sends no news consent at all", async () => {
  for (const value of ["", "no", "true", "YES "]) {
    const { calls, fetchImpl } = fakeNetwork(() => ok());
    await handleBuyerList(post({ newsConsent: value }), CONFIGURED, deps(fetchImpl));
    const { payload } = await received(calls[0]);
    assert.equal("newsConsent" in payload, false, JSON.stringify(value));
  }
});

test("phone numbers are read the way people type them and sent in E.164", () => {
  for (const [typed, expected] of [
    ["(312) 555-0123", "+13125550123"], ["312.555.0123", "+13125550123"], ["1 312 555 0123", "+13125550123"],
    ["+44 20 7946 0958", "+442079460958"], ["", null], ["   ", null],
    ["555-0123", undefined], ["+12", undefined], ["312-555-0123 ext 4", undefined], ["2 312 555 0123", undefined],
  ]) {
    assert.equal(normalizePhone(typed), expected, typed);
  }
});

test("a blank phone is left out of the contact; the title always goes", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  await handleBuyerList(post({ phone: "" }), CONFIGURED, deps(fetchImpl));
  const { payload } = await received(calls[0]);
  assert.deepEqual(payload.contact, { fullName: "Pat Buyer", email: "pat@example-capital.com", title: "Partner" });
});

test("only a tick, or a literal true from code, counts as asking for news", () => {
  const base = { ...VALID, consent: true };
  assert.equal(validateSignup({ ...base, newsConsent: true }).fields.wantsNews, true);
  assert.equal(validateSignup({ ...base, newsConsent: "yes" }).fields.wantsNews, true);
  for (const value of [undefined, null, false, 1, "on", "Yes"]) {
    assert.equal(validateSignup({ ...base, newsConsent: value }).fields.wantsNews, false, String(value));
  }
});

test("the news box alone never stands in for the deal consent", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const response = await handleBuyerList(post({ consent: "", newsConsent: "yes" }), CONFIGURED, deps(fetchImpl));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).field, "consent");
  assert.equal(calls.length, 0);
});

test("the fallback email says whether they asked for news", async () => {
  for (const [value, expected] of [["yes", /^Yes: Also send me occasional news/], ["", /^No\. Do not add them/]]) {
    const { calls, fetchImpl } = fakeNetwork((url) => (url === FORMSPREE ? ok({ ok: true }) : status(400)));
    await handleBuyerList(post({ newsConsent: value }), CONFIGURED, deps(fetchImpl));
    assert.match(JSON.parse(calls.at(-1).init.body).newsAndAnnouncements, expected);
  }
});

test("a path in the uploaded file name never reaches HelmIQ", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  await handleBuyerList(post({}, { filename: "..\\..\\C:\\secret\\sheet.pdf" }), CONFIGURED, deps(fetchImpl));
  const sent = await received(calls[0]);
  assert.equal(sent.payload.onePager.filename, "sheet.pdf");
  assert.equal(sent.filename, "sheet.pdf");
});

test("a HelmIQ server error is retried once with the same submissionId and the same file", async () => {
  const { calls, fetchImpl } = fakeNetwork((url, n) => (n === 1 ? status(503) : ok()));
  const response = await handleBuyerList(post(), CONFIGURED, deps(fetchImpl));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  const [first, second] = await Promise.all(calls.map(received));
  assert.equal(first.payload.submissionId, second.payload.submissionId);
  assert.deepEqual(second.file, PDF);
});

test("HelmIQ unreachable twice: the sign-up goes to Formspree, naming the one-pager it could not carry", async () => {
  const { calls, fetchImpl } = fakeNetwork((url) => (url === FORMSPREE ? ok({ ok: true }) : new Error("timeout")));
  const response = await handleBuyerList(post({ whatYouBuy: "Business services" }), CONFIGURED, deps(fetchImpl));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.url), [INTAKE_URL, INTAKE_URL, FORMSPREE]);
  const fallback = JSON.parse(calls[2].init.body);
  assert.equal(fallback.email, "pat@example-capital.com");
  assert.equal(fallback.submissionId, UUID);
  assert.equal(fallback.whatTheyBuy, "Business services");
  assert.match(fallback.onePager, /Example Capital one-pager\.pdf.*Ask them to email it/);
  assert.equal(fallback.criteria, "Sectors: Business Services, Healthcare\nEBITDA: $3M to $15M");
  assert.match(fallback._subject, /Buyer list sign-up: Example Capital/);
});

test("a HelmIQ 400, 401 or 429 keeps the sign-up through Formspree instead of losing it", async () => {
  for (const code of [400, 401, 429]) {
    const { calls, fetchImpl } = fakeNetwork((url) => (url === FORMSPREE ? ok({ ok: true }) : status(code)));
    const response = await handleBuyerList(post(), CONFIGURED, deps(fetchImpl));
    assert.equal(response.status, 200, String(code));
    assert.deepEqual(calls.map((call) => call.url), [INTAKE_URL, FORMSPREE], String(code));
  }
});

test("without the IP salt HelmIQ counts as unconfigured, so no unsalted hash is ever sent", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok({ ok: true }));
  const env = { ...OPEN, HELMIQ_INTAKE_URL: INTAKE_URL, HELMIQ_SIGNING_SECRET: SECRET };
  const response = await handleBuyerList(post(), env, deps(fetchImpl));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.url), [FORMSPREE]);
});

test("line breaks never reach the fallback email's subject", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok({ ok: true }));
  await handleBuyerList(post({ firmName: "Acme\r\nBcc: victim@example.com" }), OPEN, deps(fetchImpl));
  const fallback = JSON.parse(calls[0].init.body);
  assert.equal(fallback._subject, "Buyer list sign-up: Acme Bcc: victim@example.com");
  assert.ok(!/[\r\n]/.test(fallback.firm));
});

test("if both HelmIQ and Formspree fail, the buyer is told to email instead", async () => {
  const { fetchImpl } = fakeNetwork(() => status(500));
  const response = await handleBuyerList(post(), CONFIGURED, deps(fetchImpl));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /email/);
});

test("with Turnstile set up, a missing or failed token stops the sign-up", async () => {
  const env = { HELMIQ_INTAKE_URL: INTAKE_URL, HELMIQ_SIGNING_SECRET: SECRET, IP_HASH_SALT: "salt",
    TURNSTILE_SECRET_KEY: "ts-secret", TURNSTILE_SITE_KEY: "0xAAA" };
  const fail = fakeNetwork(() => ok({ success: false }));
  const missing = await handleBuyerList(post(), env, deps(fail.fetchImpl));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).field, "turnstile");
  const rejected = await handleBuyerList(post({ turnstileToken: "bad" }), env, deps(fail.fetchImpl));
  assert.equal(rejected.status, 400);
  assert.ok(fail.calls.every((call) => !call.url.startsWith("https://helmiq")));

  const pass = fakeNetwork((url) => (url.includes("turnstile") ? ok({ success: true }) : ok()));
  const accepted = await handleBuyerList(post({ turnstileToken: "good" }), env, deps(pass.fetchImpl));
  assert.equal(accepted.status, 200);
  assert.deepEqual(pass.calls.map((call) => (call.url.includes("turnstile") ? "turnstile" : call.url)), ["turnstile", INTAKE_URL]);
});

test("the per-visitor rate limit answers 429 before reading the body", async () => {
  const { calls, fetchImpl } = fakeNetwork(() => ok());
  const env = { ...CONFIGURED, BUYER_LIST_LIMITER: { limit: async () => ({ success: false }) } };
  const request = post();
  const response = await handleBuyerList(request, env, deps(fetchImpl));
  assert.equal(response.status, 429);
  assert.equal(request.bodyUsed, false);
  assert.equal(calls.length, 0);
});

test("the Worker routes the endpoint, keeps 405 for POSTs anywhere else, and never caches it", async () => {
  const assets = { fetch: () => new Response("<!doctype html>", { status: 200 }) };
  const get = await worker.fetch(new Request(`${ORIGIN}${BUYER_LIST_PATH}`), { ASSETS: assets });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.ok(get.headers.get("strict-transport-security"));
  const elsewhere = await worker.fetch(new Request(`${ORIGIN}/contact`, { method: "POST" }), { ASSETS: assets });
  assert.equal(elsewhere.status, 405);
});

test("the page's security policy lets Turnstile load and keeps form posts on Formspree only", async () => {
  const assets = { fetch: () => new Response("<!doctype html>", { status: 200 }) };
  const page = await worker.fetch(new Request(`${ORIGIN}/investors`), { ASSETS: assets });
  const csp = page.headers.get("content-security-policy");
  for (const directive of ["script-src", "frame-src", "connect-src"]) {
    const value = csp.split("; ").find((part) => part.startsWith(directive));
    assert.match(value, /https:\/\/challenges\.cloudflare\.com/, directive);
  }
  assert.match(csp, /form-action https:\/\/formspree\.io(;|$)/);
});

// The form's options and the Worker's lists are written in two places. These
// keep them identical, so a value added to one cannot be rejected by the other.
const html = readFileSync(new URL("../investors.html", import.meta.url), "utf8");

test("every buyer type on the form is one the Worker accepts, and the other way round", () => {
  const block = html.match(/<select id="bType"[\s\S]*?<\/select>/)[0];
  const values = [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  assert.deepEqual(values, [...BUYER_TYPES.keys()]);
});

test("the sector and region boxes on the form are exactly the lists the Worker sends to HelmIQ", () => {
  const boxes = (name) => [...html.matchAll(new RegExp(`name="${name}" value="([^"]+)"`, "g"))].map((m) => m[1].replace(/&amp;/g, "&"));
  assert.deepEqual(boxes("sectors"), [...SECTORS]);
  assert.deepEqual(boxes("geography"), [...GEOGRAPHY]);
});

test("the form posts the field names the Worker reads, and only accepts PDFs", () => {
  for (const name of ["fullName", "email", "title", "phone", "firmName", "firmWebsite", "buyerType", "whatYouBuy", "consent", "onePager",
    "ebitdaMinM", "ebitdaMaxM", "revenueMinM", "revenueMaxM", "addOnEbitdaMinM", "addOnEbitdaMaxM",
    "currentFundSizeM", "currentFundVintage"]) {
    assert.match(html, new RegExp(`name="${name}"`), name);
  }
  assert.match(html, /id="bOnePager"[^>]*accept="application\/pdf,\.pdf"/);
  // The upload stays hidden without JavaScript: the no-JS Formspree path cannot carry a file.
  assert.match(html, /id="bUploadField" hidden/);
});

test("the checkbox the buyer ticks says exactly what HelmIQ records as the consent text", () => {
  const label = html.match(/id="bConsent"[^>]*>\s*<span>([^<]+)<\/span>/)[1];
  assert.equal(label, CONSENT_TEXT);
});

test("the news box is optional, starts unticked, and says exactly what HelmIQ records", () => {
  const input = html.match(/<input[^>]*id="bNewsConsent"[^>]*>/)[0];
  assert.match(input, /name="newsConsent"/);
  assert.doesNotMatch(input, /\brequired\b|\bchecked\b/);
  // The wording runs up to the "(optional)" hint, which is not part of what they agree to.
  const label = html.match(/id="bNewsConsent"[^>]*>\s*<span>([^<]+)<span class="val-label-hint">\(optional\)<\/span><\/span>/)[1];
  assert.equal(label.trim(), NEWS_CONSENT_TEXT);
});

// The criteria rules on their own, without the request around them.
const YEAR = 2026;
const criteriaOf = (patch, type = "private_equity") =>
  validateCriteria({ sectors: ["Healthcare"], ebitdaMinM: "3", ...patch }, type, YEAR);

test("money answers read the way people type them, in $ millions", () => {
  assert.equal(parseMillions("5"), 5);
  assert.equal(parseMillions(" $7.5M "), 7.5);
  assert.equal(parseMillions("1,200"), 1200);
  assert.equal(parseMillions("25 million"), 25);
  assert.equal(parseMillions(""), null);
  assert.ok(Number.isNaN(parseMillions("5-10")));
  assert.ok(Number.isNaN(parseMillions("-3")));
});

test("blank answers are left out of the criteria, never sent as null or 0", () => {
  const result = criteriaOf({ ebitdaMaxM: "", revenueMinM: "", geography: [], currentFundSizeM: "", currentFundVintage: "" });
  assert.deepEqual(result, { ok: true, criteria: { sectors: ["Healthcare"], ebitdaMinM: 3 } });
});

test("every answered field reaches the criteria under HelmIQ's key, lists in canonical order", () => {
  const result = criteriaOf({
    sectors: ["Technology", "Healthcare", "Healthcare", "Crypto"],
    ebitdaMaxM: "15", revenueMinM: "20", revenueMaxM: "100", addOnEbitdaMinM: "1", addOnEbitdaMaxM: "3",
    geography: ["West", "Midwest", "Mars"], currentFundSizeM: "450", currentFundVintage: "2023",
  });
  assert.deepEqual(result.criteria, {
    sectors: ["Healthcare", "Technology"], ebitdaMinM: 3, ebitdaMaxM: 15, revenueMinM: 20, revenueMaxM: 100,
    addOnEbitdaMinM: 1, addOnEbitdaMaxM: 3, geography: ["Midwest", "West"], currentFundSizeM: 450, currentFundVintage: 2023,
  });
});

test("an EBITDA band is required of financial buyers but not of strategics", () => {
  assert.equal(criteriaOf({ ebitdaMinM: "" }, "search_fund").field, "ebitdaMinM");
  assert.equal(criteriaOf({ ebitdaMinM: "" }, "strategic").ok, true);
  assert.deepEqual(criteriaOf({ ebitdaMinM: "", ebitdaMaxM: "10" }).criteria, { sectors: ["Healthcare"], ebitdaMaxM: 10 });
});

test("fund size and vintage count only for buyers who raise a fund", () => {
  const fund = { currentFundSizeM: "450", currentFundVintage: "2023" };
  assert.equal(criteriaOf(fund, "family_office").criteria.currentFundSizeM, 450);
  for (const type of ["independent_sponsor", "search_fund", "strategic", "holding_company", "other"]) {
    const { criteria } = criteriaOf(fund, type);
    assert.ok(!("currentFundSizeM" in criteria) && !("currentFundVintage" in criteria), type);
  }
});

test("out-of-range numbers name the field that is wrong", () => {
  assert.equal(criteriaOf({ ebitdaMinM: "20000" }).field, "ebitdaMinM");
  assert.equal(criteriaOf({ ebitdaMinM: "0", ebitdaMaxM: "0" }).field, "ebitdaMaxM");
  assert.equal(criteriaOf({ ebitdaMinM: "0", ebitdaMaxM: "5" }).ok, true);
  assert.equal(criteriaOf({ addOnEbitdaMinM: "5", addOnEbitdaMaxM: "2" }).field, "addOnEbitdaMaxM");
  assert.equal(criteriaOf({ currentFundSizeM: "0" }).field, "currentFundSizeM");
  assert.equal(criteriaOf({ currentFundSizeM: "450000000" }).field, "currentFundSizeM");
  assert.equal(criteriaOf({ currentFundVintage: "1979" }).field, "currentFundVintage");
  assert.equal(criteriaOf({ currentFundVintage: String(YEAR + 2) }).field, "currentFundVintage");
  assert.equal(criteriaOf({ currentFundVintage: "2023.5" }).field, "currentFundVintage");
  assert.equal(criteriaOf({ currentFundVintage: "2e3" }).field, "currentFundVintage");
  assert.equal(criteriaOf({ currentFundVintage: "0x7E0" }).field, "currentFundVintage");
  assert.equal(criteriaOf({ currentFundVintage: String(YEAR + 1) }).ok, true);
});

test("the fallback email spells the criteria out the way a banker reads them", () => {
  assert.equal(describeCriteria({
    sectors: ["Healthcare"], ebitdaMinM: 3, revenueMaxM: 1500, geography: ["Midwest"], currentFundSizeM: 450, currentFundVintage: 2023,
  }), "Sectors: Healthcare\nEBITDA: $3M and up\nRevenue: up to $1.5B\nRegions: Midwest\nCurrent fund: $450M, 2023");
});
