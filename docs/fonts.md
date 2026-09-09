# Fonts: self-hosted, and how to change them

The site sets Cormorant Garamond (display) and Inter (text). Both are served
from this origin under `fonts/`, declared once at the top of `styles.css`, and
the two files a first paint needs are preloaded from every page head:

```html
<link rel="preload" href="/fonts/cormorant-garamond-var.woff2" as="font" type="font/woff2" crossorigin />
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
| `fonts/cormorant-garamond-var.woff2` | Cormorant Garamond | normal | 300 to 700 | Latin |
| `fonts/cormorant-garamond-italic-var.woff2` | Cormorant Garamond | italic | 300 to 700 | Latin |
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

Two extra `@font-face` rules, `Cormorant Garamond Fallback` (a local Times New
Roman) and `Inter Fallback` (a local Arial), are what the browser draws while a
web font is still downloading. Their descriptors are set so the swap moves
nothing:

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
| Inter (wght 400) | 0.9688 | 0.2412 | 0.4805 |
| Arial | | | 0.4470 |

The average advance is weighted by English letter frequency including the
space. Then `size-adjust = web / fallback`, and each override is the web
font's metric divided by `size-adjust`:

- Cormorant on Times New Roman: size-adjust 97.06%, ascent 95.20%, descent 29.57%.
- Inter on Arial: size-adjust 107.49%, ascent 90.12%, descent 22.44%.

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
5. `python3 tools/stamp_assets.py`, since `styles.css` changed.

Font files are deliberately not `?v=` stamped: they never change in place.
