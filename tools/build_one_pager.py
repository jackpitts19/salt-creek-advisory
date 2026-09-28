#!/usr/bin/env python3
"""Render the capabilities one-pager to PDF and PNG from its HTML source.

Run from the repository root after editing tools/one_pager_template.html:

    python3 tools/build_one_pager.py

Writes assets/salt-creek-advisory-one-pager-2026.pdf and .png, the two files
capabilities.html links to. The previous one-pager was an export nobody could
regenerate, so it drifted from the site (a retired EBITDA floor, a sector the
firm no longer lists, both principals' phone numbers) with no way to fix it
short of redesigning it. The template is now the source, and every line in it
is copied from a live page.

Rendering is headless Google Chrome, already on the machine, so there is no
new dependency. PDF metadata (Author, Subject) is written with pikepdf when it
is installed and skipped with a warning when it is not; Chrome itself sets the
Title from the template's <title>.

The URL carries a year so that no cache, browser or edge, can go on serving
a retired version under the same name; src/index.js 301s the old path here.
Stdlib only.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "tools", "one_pager_template.html")
OUT_BASE = os.path.join(ROOT, "assets", "salt-creek-advisory-one-pager-2026")

CHROME_CANDIDATES = (
    os.environ.get("CHROME", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
)

# US Letter at CSS pixels (96 per inch). The PNG is rendered at 2x so it stays
# crisp when opened full screen.
PAGE_WIDTH_PX = 816
PAGE_HEIGHT_PX = 1056
PNG_SCALE = 2
CHROME_TIMEOUT_S = 120
# How often to check whether Chrome has finished writing its output. Two equal
# sizes one interval apart count as finished.
POLL_INTERVAL_S = 1.0

PDF_TITLE = "Salt Creek Advisory: Capabilities One-Pager (2026)"
PDF_AUTHOR = "Salt Creek Advisory"
PDF_SUBJECT = (
    "Sell-side and buy-side M&A advisory for privately held companies with "
    "$2 million to $75 million in revenue."
)

# Spelled in pieces so this guard does not itself contain the banned entities.
BANNED = ("\u2014", "&" + "mdash;", "&#" + "8212;")


def find_chrome():
    for candidate in CHROME_CANDIDATES:
        if not candidate:
            continue
        resolved = candidate if os.path.isabs(candidate) else shutil.which(candidate)
        if resolved and os.path.exists(resolved):
            return resolved
    return None


def check_template(html):
    """Refuse to publish the two things the old one-pager got wrong."""
    problems = []
    for token in BANNED:
        if token in html:
            problems.append("contains an em-dash ({!r})".format(token))
    if "tel:" in html:
        problems.append("contains a tel: link; the site publishes no phone numbers")
    return problems


def _settled(path, previous_size):
    """The output exists and did not grow since the last poll."""
    if not os.path.exists(path):
        return False, -1
    size = os.path.getsize(path)
    return size > 0 and size == previous_size, size


def chrome(binary, output, *args):
    """Run headless Chrome until `output` is written, then stop it.

    Waiting for the process to exit is not enough: on some macOS setups
    headless Chrome writes the file and then lingers (its updater keeps the
    process tree alive) until killed. So the output file is the completion
    signal, and the process is terminated once the file stops growing.
    """
    if os.path.exists(output):
        os.remove(output)
    common = [
        binary,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--allow-file-access-from-files",
    ]
    with tempfile.TemporaryDirectory() as profile:
        process = subprocess.Popen(
            common + ["--user-data-dir={}".format(profile)] + list(args),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        deadline = time.monotonic() + CHROME_TIMEOUT_S
        size = -1
        try:
            while time.monotonic() < deadline:
                exited = process.poll() is not None
                settled, size = _settled(output, size)
                if settled or (exited and size > 0):
                    return
                if exited:
                    raise RuntimeError("Chrome exited ({}) without writing {}: {}".format(
                        process.returncode, output, process.stderr.read().strip()[-500:]))
                time.sleep(POLL_INTERVAL_S)
            raise RuntimeError("Chrome did not write {} within {}s".format(output, CHROME_TIMEOUT_S))
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def write_metadata(pdf_path):
    try:
        import pikepdf
    except ImportError:
        print("pikepdf not installed; PDF Author/Subject left as Chrome wrote them "
              "(pip install --user pikepdf to set them).", file=sys.stderr)
        return
    pdf = pikepdf.open(pdf_path, allow_overwriting_input=True)
    with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
        meta["dc:title"] = PDF_TITLE
        meta["dc:creator"] = [PDF_AUTHOR]
        meta["dc:description"] = PDF_SUBJECT
    pdf.docinfo["/Title"] = PDF_TITLE
    pdf.docinfo["/Author"] = PDF_AUTHOR
    pdf.docinfo["/Subject"] = PDF_SUBJECT
    if "/Creator" in pdf.docinfo:
        del pdf.docinfo["/Creator"]
    pdf.save(pdf_path)


def main():
    binary = find_chrome()
    if not binary:
        print("Google Chrome not found. Set CHROME=/path/to/chrome.", file=sys.stderr)
        return 1

    with open(TEMPLATE, encoding="utf-8") as handle:
        problems = check_template(handle.read())
    if problems:
        for problem in problems:
            print("{}: {}".format(os.path.relpath(TEMPLATE, ROOT), problem), file=sys.stderr)
        return 1

    url = "file://" + TEMPLATE
    pdf_path = OUT_BASE + ".pdf"
    png_path = OUT_BASE + ".png"

    try:
        chrome(binary, pdf_path, "--no-pdf-header-footer",
               "--print-to-pdf={}".format(pdf_path), url)
        chrome(
            binary,
            png_path,
            "--window-size={},{}".format(PAGE_WIDTH_PX, PAGE_HEIGHT_PX),
            "--force-device-scale-factor={}".format(PNG_SCALE),
            "--screenshot={}".format(png_path),
            url,
        )
    except RuntimeError as err:
        print(err, file=sys.stderr)
        return 1
    for path in (pdf_path, png_path):
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            print("Chrome produced no output at {}".format(path), file=sys.stderr)
            return 1

    write_metadata(pdf_path)
    for path in (pdf_path, png_path):
        print("{:<48} {:>8,} bytes".format(os.path.relpath(path, ROOT), os.path.getsize(path)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
