#!/usr/bin/env python3
"""Tests for tools/stamp_assets.py.

    python3 tools/test_stamp_assets.py

The stamper's whole job is that an asset URL moves when, and only when, its
bytes move. So the tests cover both directions: a changed asset produces a new
stamp, an unchanged one keeps the old, and a second run over already-stamped
markup is a no-op rather than a URL carrying two query strings.

Each test builds a tiny synthetic site in a temporary directory, matching the
approach in test_check_site.py. Stdlib only, to match the rest of tools/.
"""
import contextlib
import importlib.util
import io
import os
import re
import tempfile
import unittest

STAMP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stamp_assets.py")

_spec = importlib.util.spec_from_file_location("stamp_assets", STAMP_PATH)
stamp_assets = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stamp_assets)

STAMP = re.compile(r"\?v=([0-9a-f]{8})")
CSS_STAMP = re.compile(r"styles\.css\?v=([0-9a-f]{8})")
JS_STAMP = re.compile(r"(?<![.\w])main\.js\?v=([0-9a-f]{8})")


class StampAssetsTestCase(unittest.TestCase):
    """Runs the stamper against a synthetic site written to a temp directory."""

    def setUp(self):
        self._origin = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        os.makedirs("articles", exist_ok=True)
        self.write("styles.css", "body { color: red; }")
        self.write("main.js", "console.info('hi');")
        self.write("analytics.js", "// analytics")
        self.write("valuation.js", "// valuation")
        self.write("contact.js", "// contact")

    def tearDown(self):
        os.chdir(self._origin)
        self._tmp.cleanup()

    def write(self, path, content):
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(content)

    def read(self, path):
        with io.open(path, encoding="utf-8") as handle:
            return handle.read()

    def run_stamper(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = stamp_assets.main()
        return code, buffer.getvalue()

    def page(self, prefix=""):
        return (
            "<!DOCTYPE html><html><head>"
            '<link rel="stylesheet" href="{p}styles.css" />'
            '<script src="{p}analytics.js" defer></script>'
            "</head><body>"
            '<script src="{p}main.js"></script>'
            '<script src="{p}valuation.js" defer></script>'
            '<script src="{p}contact.js" defer></script>'
            "</body></html>"
        ).format(p=prefix)

    def test_stamps_every_reference(self):
        self.write("index.html", self.page())
        code, _ = self.run_stamper()
        self.assertEqual(code, 0)
        self.assertEqual(len(STAMP.findall(self.read("index.html"))), 5,
                         "each of the five assets should be stamped")

    def test_handles_relative_and_root_prefixes(self):
        self.write("index.html", self.page())
        self.write("articles/guide.html", self.page("../"))
        self.write("404.html", self.page("/"))
        self.run_stamper()
        self.assertIn('href="../styles.css?v=', self.read("articles/guide.html"))
        self.assertIn('href="/styles.css?v=', self.read("404.html"))
        self.assertIn('href="styles.css?v=', self.read("index.html"))

    def test_same_bytes_keep_the_same_stamp(self):
        self.write("index.html", self.page())
        self.run_stamper()
        first = STAMP.findall(self.read("index.html"))
        self.run_stamper()
        self.assertEqual(STAMP.findall(self.read("index.html")), first,
                         "an unchanged asset must keep its cache entry")

    def test_changed_asset_moves_only_its_own_url(self):
        self.write("index.html", self.page())
        self.run_stamper()
        before = self.read("index.html")
        before_css = CSS_STAMP.search(before).group(1)
        before_js = JS_STAMP.search(before).group(1)

        self.write("styles.css", "body { color: blue; }")
        self.run_stamper()
        after = self.read("index.html")

        self.assertNotEqual(before_css, CSS_STAMP.search(after).group(1),
                            "edited CSS must move its URL")
        self.assertEqual(before_js, JS_STAMP.search(after).group(1),
                         "untouched JS must keep its URL, and its cache entry")

    def test_rerunning_does_not_stack_query_strings(self):
        self.write("index.html", self.page())
        self.run_stamper()
        self.write("styles.css", "body { color: green; }")
        self.run_stamper()
        self.assertNotIn("?v=", CSS_STAMP.search(self.read("index.html")).group(0)[13:],
                         "a reference must carry exactly one stamp")
        _, output = self.run_stamper()
        self.assertIn("0 of 1 pages updated", output,
                      "a settled tree should report no changes")

    def test_missing_asset_fails_loudly(self):
        os.remove("main.js")
        self.write("index.html", self.page())
        buffer = io.StringIO()
        with contextlib.redirect_stderr(io.StringIO()):
            with contextlib.redirect_stdout(buffer):
                code = stamp_assets.main()
        self.assertEqual(code, 1, "a missing asset should be an error, not a silent skip")
        self.assertNotIn("?v=", self.read("index.html"),
                         "nothing should be rewritten when an asset is missing")

    def test_leaves_unrelated_markup_alone(self):
        self.write("index.html", self.page() + '<img src="logo.png"><a href="about">About</a>')
        self.run_stamper()
        page = self.read("index.html")
        self.assertIn('<img src="logo.png">', page)
        self.assertIn('<a href="about">About</a>', page)


class TrimCssTest(unittest.TestCase):
    """trim_css strips comments and blank lines and touches nothing else."""

    def test_strips_block_and_multiline_comments(self):
        source = "/* head */\na { color: red; } /* trailing */\n/*\n  long\n  note\n*/\nb { margin: 0; }\n"
        self.assertEqual(stamp_assets.trim_css(source), "a { color: red; }\nb { margin: 0; }\n")

    def test_drops_blank_and_whitespace_only_lines(self):
        source = "a { x: 1; }\n\n   \n\t\nb { y: 2; }\n"
        self.assertEqual(stamp_assets.trim_css(source), "a { x: 1; }\nb { y: 2; }\n")

    def test_keeps_indentation_and_declarations_as_written(self):
        source = "@media (max-width: 640px) {\n  .a { padding: 0 1rem; }\n}\n"
        self.assertEqual(stamp_assets.trim_css(source), source)

    def test_comment_markers_inside_strings_survive(self):
        source = ".q::before { content: \"/* not a comment */\"; }\n.u { background: url('a/*b.png'); }\n"
        self.assertEqual(stamp_assets.trim_css(source), source)

    def test_comment_between_declarations_on_one_line(self):
        self.assertEqual(stamp_assets.trim_css("a { x: 1; /* why */ y: 2; }\n"), "a { x: 1;  y: 2; }\n")

    def test_unterminated_comment_raises(self):
        with self.assertRaises(ValueError):
            stamp_assets.trim_css("a { x: 1; } /* never closed\n")


class TrimmedStylesheetTest(StampAssetsTestCase):
    """main() writes styles.min.css beside styles.css on every run."""

    def test_writes_trimmed_copy(self):
        self.write("styles.css", "/* note */\nbody { color: red; }\n\n")
        self.write("index.html", self.page())
        code, _ = self.run_stamper()
        self.assertEqual(code, 0)
        self.assertEqual(self.read("styles.min.css"), "body { color: red; }\n")

    def test_trimmed_copy_follows_an_edit(self):
        self.write("index.html", self.page())
        self.run_stamper()
        self.write("styles.css", "/* new */\nbody { color: blue; }\n")
        self.run_stamper()
        self.assertEqual(self.read("styles.min.css"), "body { color: blue; }\n")

    def test_pages_keep_pointing_at_the_source_name(self):
        # The Worker serves the trimmed bytes under /styles.css, so the markup,
        # and every page's sitemap lastmod, stay exactly as they were.
        self.write("index.html", self.page())
        self.run_stamper()
        self.assertIn('href="styles.css?v=', self.read("index.html"))
        self.assertNotIn("styles.min.css", self.read("index.html"))

    def test_stamp_moves_when_only_a_comment_changes(self):
        # Harmless either way, but pinned: the stamp hashes the source, so it
        # never lags the trimmed copy it names.
        self.write("styles.css", "/* a */\nbody{}\n")
        self.write("index.html", self.page())
        self.run_stamper()
        before = CSS_STAMP.search(self.read("index.html")).group(1)
        self.write("styles.css", "/* b */\nbody{}\n")
        self.run_stamper()
        self.assertNotEqual(before, CSS_STAMP.search(self.read("index.html")).group(1))


if __name__ == "__main__":
    unittest.main(verbosity=2)
