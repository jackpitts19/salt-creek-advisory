#!/usr/bin/env python3
"""Tests for the sitemap lastmod logic in tools/build_feed.py.

    python3 tools/test_build_feed.py

tools/stamp_assets.py rewrites the ?v= stamp in every page whenever styles.css
or a script changes. Read naively from `git log -1`, that reset every root
page's sitemap lastmod on each CSS tweak, telling crawlers that the content of
twenty pages changed when none of it had. git_last_modified now walks back past
commits whose only change to the file is a stamp.

Each test builds a throwaway git repository in a temporary directory, so the
dates asserted are the ones the test committed, not whatever this checkout's
history happens to hold. Stdlib only, to match the rest of tools/.
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)  # build_feed imports stamp_assets as a sibling

_spec = importlib.util.spec_from_file_location("build_feed", os.path.join(TOOLS, "build_feed.py"))
build_feed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_feed)

PAGE = """<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="styles.css?v={css}" />
</head>
<body>
  <p>{body}</p>
  <script src="main.js?v={js}"></script>
</body>
</html>
"""


class TempRepo:
    """A git repository whose commit dates are chosen by the test."""

    def __init__(self, root):
        self.root = root
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args, date=None):
        env = dict(os.environ)
        if date:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date + "T12:00:00+00:00"
        return subprocess.run(
            ["git", *args], cwd=self.root, env=env,
            capture_output=True, text=True, check=True,
        ).stdout

    def write(self, name, text):
        with open(os.path.join(self.root, name), "w", encoding="utf-8") as handle:
            handle.write(text)

    def commit(self, date, message="change"):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message, date=date)
        return self.git("rev-parse", "HEAD").strip()

    def page(self, date, css="aaaaaaaa", js="11111111", body="Hello", name="about.html"):
        self.write(name, PAGE.format(css=css, js=js, body=body))
        return self.commit(date)

    def last_modified(self, name="about.html"):
        return build_feed.git_last_modified(name, cwd=self.root)


class GitLastModifiedTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = TempRepo(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_a_stamp_only_commit_does_not_move_lastmod(self):
        self.repo.page("2026-09-01")
        self.repo.page("2026-09-10", css="bbbbbbbb")
        self.assertEqual(self.repo.last_modified(), "2026-09-01")

    def test_several_stamp_only_commits_are_all_skipped(self):
        self.repo.page("2026-09-01")
        self.repo.page("2026-09-05", css="bbbbbbbb")
        self.repo.page("2026-09-12", css="bbbbbbbb", js="22222222")
        self.repo.page("2026-09-20", css="cccccccc", js="33333333")
        self.assertEqual(self.repo.last_modified(), "2026-09-01")

    def test_a_content_change_moves_lastmod(self):
        self.repo.page("2026-09-01")
        self.repo.page("2026-09-15", body="Goodbye")
        self.assertEqual(self.repo.last_modified(), "2026-09-15")

    def test_a_content_change_bundled_with_a_stamp_counts(self):
        # A commit that edits styles.css and the page's copy together is a real
        # change to the page, even though its stamp moved too.
        self.repo.page("2026-09-01")
        self.repo.page("2026-09-15", css="bbbbbbbb", body="Goodbye")
        self.assertEqual(self.repo.last_modified(), "2026-09-15")

    def test_walks_back_past_stamps_to_the_last_content_change(self):
        self.repo.page("2026-08-01", body="One")
        self.repo.page("2026-09-01", body="Two")
        self.repo.page("2026-09-20", css="bbbbbbbb", body="Two")
        self.assertEqual(self.repo.last_modified(), "2026-09-01")

    def test_an_unrelated_query_change_is_not_mistaken_for_a_stamp(self):
        # Only ?v= on an asset stamp_assets manages is a stamp. Any other URL
        # change is content.
        self.repo.page("2026-09-01", body='<a href="/x?v=1">x</a>')
        self.repo.page("2026-09-15", body='<a href="/x?v=2">x</a>')
        self.assertEqual(self.repo.last_modified(), "2026-09-15")

    def test_other_files_in_the_same_commit_do_not_count(self):
        self.repo.write("styles.css", "body{}")
        self.repo.page("2026-09-01")
        self.repo.write("styles.css", "body{color:red}")
        self.repo.page("2026-09-15", css="bbbbbbbb")
        self.assertEqual(self.repo.last_modified(), "2026-09-01")
        self.assertEqual(self.repo.last_modified("styles.css"), "2026-09-15")

    def test_the_first_commit_always_counts(self):
        self.repo.page("2026-07-04")
        self.assertEqual(self.repo.last_modified(), "2026-07-04")

    def test_a_merge_is_judged_by_what_its_first_parent_received(self):
        self.repo.page("2026-09-01")
        self.repo.git("checkout", "-q", "-b", "feature")
        self.repo.page("2026-09-10", css="bbbbbbbb")
        self.repo.git("checkout", "-q", "-")
        self.repo.write("other.html", "x")
        self.repo.commit("2026-09-11")
        self.repo.git("merge", "-q", "--no-ff", "-m", "merge", "feature", date="2026-09-12")
        self.assertEqual(self.repo.last_modified(), "2026-09-01")

    def test_an_added_line_is_not_stamp_only(self):
        self.repo.write("a.html", "one\ntwo\n")
        self.repo.commit("2026-09-01")
        self.repo.write("a.html", "one\ntwo\nthree\n")
        head = self.repo.commit("2026-09-02")
        self.assertFalse(build_feed.is_stamp_only_change(head, "a.html", cwd=self.repo.root))

    def test_a_removed_line_starting_with_dashes_is_read_as_content(self):
        # "-- x" removed shows in the diff as "--- x", which a parser that
        # skipped every "---" line would drop, leaving an empty diff.
        self.repo.write("a.html", "keep\n-- x\n")
        self.repo.commit("2026-09-01")
        self.repo.write("a.html", "keep\n")
        head = self.repo.commit("2026-09-02")
        self.assertFalse(build_feed.is_stamp_only_change(head, "a.html", cwd=self.repo.root))
        self.assertEqual(self.repo.last_modified("a.html"), "2026-09-02")

    def test_a_file_git_has_never_seen_falls_back_to_today(self):
        self.repo.page("2026-09-01")
        self.assertRegex(self.repo.last_modified("never-committed.html"), r"^\d{4}-\d{2}-\d{2}$")


if __name__ == "__main__":
    unittest.main()
