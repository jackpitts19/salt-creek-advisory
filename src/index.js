const APEX_HOST = "saltcreekadvisory.com";
const WWW_HOST = "www.saltcreekadvisory.com";

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

export default {
  async fetch(request, env) {
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
      return Response.redirect(target.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
