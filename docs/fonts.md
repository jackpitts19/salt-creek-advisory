# Fonts: self-hosted, and how to change them

The site sets Source Serif 4 (display: headlines, pull quotes, big numbers),
Inter (text), and Cormorant Garamond for the SALT CREEK wordmark only.

**2026-10-23:** display type moved from Cormorant Garamond to Source Serif 4,
and every italic display flourish was set upright. Cormorant's light hairline
cut and the copper italic headline endings read as the stock look of
generated sites; a bank's headlines should look sturdy. The wordmark stays in
Cormorant because it is part of the logo. Both are served
from this origin under `fonts/`, declared once at the top of `styles.css`, and
the two files a first paint needs are preloaded from every page head:

```html
<link rel="preload" href="/fonts/source-serif-4-var.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
```

## Why self-hosted

Until 2026-09-09 every page linked a Google Fonts stylesheet. A cross-origin
stylesheet is render-blocking, so each page paid DNS, TLS and a fetch to
`fonts.googleapis.com` before it could paint anything; Lighthouse put that at
0.85 to 1.0 s of the mobile LCP on every page. Serving the files ourselves
removes the request entirely, lets the head preload the two critical files in
parallel with `styles.css`, and drops a third-party call from the privacy
surface. The CSP in `src/index.js` no longer lists either Google host.

A second fix came free: `styles.css` asks for Inter at weight 700 in fifteen
rules, and the old Google request never included 700, so browsers synthesised
the bold. The Inter file here carries the full 100 to 900 axis.

## The files

| File | Family | Style | Weight axis | Subset |
|---|---|---|---|---|
| `fonts/source-serif-4-var.woff2` | Source Serif 4 | normal | 300 to 700 (opsz pinned at 48) | Latin |
| `fonts/cormorant-garamond-var.woff2` | Cormorant Garamond (wordmark only) | normal | 300 to 700 | Latin |
| `fonts/cormorant-garamond-italic-var.woff2` | Cormorant Garamond | italic | 300 to 700 | Latin (no longer declared in styles.css; kept for tools/one_pager_template.html) |

`source-serif-4-var.woff2` is the Google Fonts Latin build of Source Serif 4
(SIL OFL 1.1), downloaded 2026-10-23, with fontTools' instancer pinning the
optical-size axis at 48 and trimming weight to 300-700: 122 KB down to 49 KB.
Its `@font-face` carries `size-adjust: 86%`, which brings its x-height close
to Cormorant's so headline sizes stayed as laid out.
| `fonts/inter-var.woff2` | Inter | normal | 100 to 900 | Latin |

They are the Latin variable builds Google Fonts serves to a current Chrome for
the same families, downloaded 2026-09-08 from `fonts.gstatic.com`, so glyph
shapes did not change with the move. Both families are licensed under the SIL
Open Font License 1.1, which permits self-hosting and redistribution as long
as the fonts are not sold on their own.

The `unicode-range` on each face is Google's Latin range, copied verbatim.
Text outside it (rare on this site) falls through to the system font, exactly
as it did before.

## Fallback faces

Three extra `@font-face` rules, `Cormorant Garamond Fallback` (a local Times
New Roman, in an upright and an italic face) and `Inter Fallback` (a local
Arial), are what the browser draws while a web font is still downloading.
Their descriptors are set so the swap moves nothing:

- `size-adjust` equalises the average advance width of English text between
  the fallback and the web font, so line breaks land in the same places.
- `ascent-override`, `descent-override` and `line-gap-override` put the line
  box where the web font's line box will be.

Inputs, read from the font tables with fontTools (hhea metrics, which is what
macOS and Windows use for these files):

| Font | ascent / em | descent / em | avg advance / em |
|---|---|---|---|
| Cormorant Garamond (wght 300) | 0.924 | 0.287 | 0.3933 |
| Times New Roman | | | 0.4052 |
| Cormorant Garamond Italic (wght 300) | 0.924 | 0.287 | 0.3543 |
| Times New Roman Italic | | | 0.4067 |
| Inter (wght 400) | 0.9688 | 0.2412 | 0.4805 |
| Arial | | | 0.4470 |

The average advance is weighted by English letter frequency including the
space. Then `size-adjust = web / fallback`, and each override is the web
font's metric divided by `size-adjust`:

- Cormorant on Times New Roman: size-adjust 97.06%, ascent 95.20%, descent 29.57%.
- Source Serif 4 (wght 400, opsz 48: ascent 1.036, descent 0.335, avg advance 0.4163, all times the 86% face size-adjust) on Times New Roman: size-adjust 88.36%, ascent 100.83%, descent 32.60%.
- The Cormorant italic fallback face was removed with the italic display type.
- Inter on Arial: size-adjust 107.49%, ascent 90.12%, descent 22.44%.

The italic face has its own descriptors because the headline on every hero
sets one or two words in italic. Without it the browser slants the upright
fallback itself, at the upright's widths; Cormorant's italic is a good deal
narrower than Times New Roman's, so the swap used to pull the line in and
reflow whatever followed. One tablet-width page's layout shift rose from
0.012 to 0.029 with the face in place, which is accepted: both are far under
the 0.1 that counts as good, and every other page moved less.

Times New Roman was chosen over Georgia because its proportions sit closer to
a Garamond, which keeps per-word widths, not only the average, close to the
real face. Where neither local font exists (Android, most Linux) the stack
falls through to Georgia or the generic family unadjusted, as it always did.

## Changing a font

1. Put the new file under `fonts/` under a **new filename**. The Worker caches
   `.woff2` for a year (`src/index.js`), so a changed file at the same name
   would serve stale bytes to returning visitors for up to a year.
2. Point the `@font-face` `src` at it in `styles.css` and, if it is one of the
   two preloaded files, update the preload `href` in every page head. Pages sit
   at the root and under `articles/`, and `404.html` is served for any path, so
   the preload hrefs are root-absolute on purpose.
3. Recompute the fallback descriptors if the family changed (the method above).
4. `python3 tools/check_site.py`. It fails on any page that still names a
   Google Fonts host, on any font preload with no file behind it, and on any
   `@font-face` URL in `styles.css` that does not resolve to a file.
5. `python3 tools/stamp_assets.py`, since `styles.css` changed. It also
   rewrites `styles.min.css`, the copy without comments that the Worker
   actually sends for `/styles.css`; edit only `styles.css` and commit both.

Font files are deliberately not `?v=` stamped: they never change in place.
