const APEX_HOST = "saltcreekadvisory.com";
const WWW_HOST = "www.saltcreekadvisory.com";

const ALLOWED_METHODS = ["GET", "HEAD", "OPTIONS"];

// Every off-origin host the site actually talks to. Keep this in sync with the
// markup: an entry missing here shows up as a console CSP violation, not a
// silent degradation.
//   googletagmanager / google-analytics -> GA4 (analytics.js)
//   fonts.googleapis / fonts.gstatic    -> the Cormorant Garamond + Inter faces
//   formspree.io                        -> valuation.js lead capture POST
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'self' https://www.googletagmanager.com",
  // 'unsafe-inline' is still required by ~58 style="" attributes in the markup.
  // Scoped to style only; script-src carries no inline escape hatch.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com",
  // www.google.com is GA4's Google-signals endpoint: gtag beacons user_engagement
  // there in addition to google-analytics.com. Omitting it costs engagement data
  // and prints a CSP error on every page.
  "connect-src 'self' https://formspree.io https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.google.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), " +
    "encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), " +
    "midi=(), payment=(), usb=(), xr-spatial-tracking=()",
};

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const ONE_WEEK = 604800;
const ONE_YEAR = 31536000;

// Assets are not content-hashed, so nothing is marked `immutable` -- a deploy has
// to be able to take effect. HTML always revalidates so content edits go live at once.
const HTML_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const CACHE_RULES = [
  { pattern: /\.(?:css|js)$/i, value: `public, max-age=${ONE_HOUR}, stale-while-revalidate=${ONE_DAY}` },
  { pattern: /\.(?:woff2?|ttf|otf|eot)$/i, value: `public, max-age=${ONE_YEAR}` },
  { pattern: /\.(?:png|jpe?g|webp|gif|svg|avif|ico)$/i, value: `public, max-age=${ONE_WEEK}` },
  { pattern: /\.pdf$/i, value: `public, max-age=${ONE_DAY}` },
  { pattern: /\.(?:xml|txt|json)$/i, value: `public, max-age=${ONE_HOUR}` },
];

function getOriginalScheme(request, url) {
  const cfVisitor = request.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const scheme = JSON.parse(cfVisitor).scheme;
      if (scheme === "http" || scheme === "https") return scheme;
    } catch (err) {
      // fall through to url.protocol below
    }
  }
  return url.protocol.replace(":", "");
}

function normalizePathname(pathname) {
  if (pathname === "/index.html") return "/";
  if (pathname.endsWith("/index.html")) {
    const trimmed = pathname.slice(0, -"index.html".length).replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  }
  if (pathname.endsWith(".html")) {
    pathname = pathname.slice(0, -".html".length);
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }
  return pathname === "" ? "/" : pathname;
}

function cacheControlFor(pathname) {
  const rule = CACHE_RULES.find(({ pattern }) => pattern.test(pathname));
  // Extensionless paths are the clean article/page URLs, which resolve to HTML.
  return rule ? rule.value : HTML_CACHE_CONTROL;
}

/**
 * Returns a copy of `response` carrying the security headers and a cache policy.
 * The original is never mutated -- asset responses are immutable anyway.
 */
function withStandardHeaders(response, pathname) {
  const decorated = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    decorated.headers.set(name, value);
  }
  decorated.headers.set("cache-control", cacheControlFor(pathname));
  return decorated;
}

// Asked for as "/404" rather than "/404.html": the assets binding maps clean URLs
// onto .html files and answers the explicit .html form with a redirect, which would
// otherwise leave us serving a redirect body under a 404 status.
async function serveNotFound(env, url) {
  const notFoundRequest = new Request(new URL("/404", url.origin), { method: "GET" });
  const response = await env.ASSETS.fetch(notFoundRequest);
  const body = response.status === 200 ? response.body : "Not Found";
  const notFound = new Response(body, {
    status: 404,
    headers: {
      "content-type": response.status === 200
        ? "text/html; charset=utf-8"
        : "text/plain; charset=utf-8",
    },
  });
  return withStandardHeaders(notFound, "/404.html");
}

function methodNotAllowed() {
  const response = new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: ALLOWED_METHODS.join(", "), "content-type": "text/plain; charset=utf-8" },
  });
  return withStandardHeaders(response, "/");
}

export default {
  async fetch(request, env) {
    if (!ALLOWED_METHODS.includes(request.method)) {
      return methodNotAllowed();
    }

    const url = new URL(request.url);
    const originalScheme = getOriginalScheme(request, url);
    const targetHost = url.hostname === WWW_HOST ? APEX_HOST : url.hostname;
    const targetPathname = normalizePathname(url.pathname);

    const needsRedirect =
      originalScheme !== "https" ||
      url.hostname !== targetHost ||
      url.pathname !== targetPathname;

    if (needsRedirect) {
      const target = new URL(url.toString());
      target.protocol = "https:";
      target.hostname = targetHost;
      target.pathname = targetPathname;
      // Wrapped so the redirect hop also carries HSTS rather than only the final page.
      return withStandardHeaders(Response.redirect(target.toString(), 301), targetPathname);
    }

    if (request.method === "OPTIONS") {
      const response = new Response(null, {
        status: 204,
        headers: { allow: ALLOWED_METHODS.join(", ") },
      });
      return withStandardHeaders(response, url.pathname);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      return serveNotFound(env, url);
    }

    return withStandardHeaders(assetResponse, url.pathname);
  },
};
