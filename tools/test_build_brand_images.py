#!/usr/bin/env python3
"""Tests for tools/build_brand_images.py.

    python3 tools/test_build_brand_images.py

Chrome does the drawing and is not exercised here. What is tested is the step
after it, and the files it left behind: a screenshot becomes a file of exactly
the size and format the pages declare; a screenshot of the wrong size, or with
the drawing pushed to one side, is refused; and the three committed images are
centred.

That last one exists because the small logo once shipped reading "PITT / &
COMPAN". Headless Chrome will not lay out a window narrower than 500px, so a
280px window kept only the left of a wider drawing, and a check that compared
pixel dimensions alone passed it.

Needs Pillow, like the tool itself. Without it every test here is skipped, so
the file is safe to list in CI, which has no Pillow.
"""
import importlib.util
import os
import sys
import tempfile
import unittest

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
# The tool imports its Chrome helpers from build_one_pager.py, alongside it.
sys.path.insert(0, TOOLS)

_spec = importlib.util.spec_from_file_location(
    "build_brand_images", os.path.join(TOOLS, "build_brand_images.py"))
brand = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(brand)

PAPER = (255, 251, 250)
INK = (18, 34, 50)


@unittest.skipUnless(Image, "Pillow is not installed")
class ConvertTest(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def screenshot(self, width, height, ink_left=0.3, ink_right=0.7):
        """A paper-coloured screenshot with one block of ink between two x fractions."""
        image = Image.new("RGB", (width, height), PAPER)
        ImageDraw.Draw(image).rectangle(
            [int(width * ink_left), int(height * 0.3), int(width * ink_right), int(height * 0.7)],
            fill=INK)
        path = os.path.join(self.tmp, "screenshot-{}x{}.png".format(width, height))
        image.save(path)
        return path

    def rendered(self, target, **ink):
        return self.screenshot(target.render_width * brand.SUPERSAMPLE,
                               target.render_height * brand.SUPERSAMPLE, **ink)

    def test_the_targets_are_the_three_images_with_the_name_drawn_in(self):
        self.assertEqual(
            [(target.name, target.width, target.height) for target in brand.TARGETS],
            [("logo-full.png", 738, 593), ("logo-full-sm.webp", 280, 225),
             ("og-image.jpg", 1200, 630)])

    def test_no_target_asks_chrome_for_a_window_narrower_than_it_can_open(self):
        for target in brand.TARGETS:
            with self.subTest(target=target.name):
                self.assertGreaterEqual(target.render_width, brand.MIN_CHROME_WINDOW_PX)

    def test_a_target_drawn_larger_keeps_the_proportions_it_is_scaled_to(self):
        for target in brand.TARGETS:
            with self.subTest(target=target.name):
                self.assertAlmostEqual(target.render_width / target.render_height,
                                       target.width / target.height, places=2)

    def test_each_target_is_written_at_its_declared_size_and_format(self):
        for target in brand.TARGETS:
            with self.subTest(target=target.name):
                out = os.path.join(self.tmp, target.name)
                brand.convert(self.rendered(target), out, target)
                with Image.open(out) as image:
                    self.assertEqual(image.size, (target.width, target.height))
                    self.assertEqual(image.format, target.format)

    def test_a_screenshot_of_the_wrong_size_is_refused_and_nothing_is_written(self):
        target = brand.TARGETS[0]
        raw = self.screenshot(target.render_width * brand.SUPERSAMPLE,
                              target.render_height * brand.SUPERSAMPLE - 80)
        out = os.path.join(self.tmp, target.name)
        with self.assertRaises(ValueError):
            brand.convert(raw, out, target)
        self.assertFalse(os.path.exists(out))

    def test_a_drawing_cut_off_at_one_edge_is_refused_and_nothing_is_written(self):
        # What the 280px window produced: ink running off the right-hand side.
        target = brand.TARGETS[0]
        out = os.path.join(self.tmp, target.name)
        with self.assertRaises(ValueError):
            brand.convert(self.rendered(target, ink_left=0.7, ink_right=1.0), out, target)
        self.assertFalse(os.path.exists(out))

    def test_a_blank_screenshot_is_refused(self):
        target = brand.TARGETS[0]
        with self.assertRaises(ValueError):
            brand.convert(self.rendered(target, ink_left=0.5, ink_right=0.5 - 1e-9),
                          os.path.join(self.tmp, target.name), target)


@unittest.skipUnless(Image, "Pillow is not installed")
class CommittedImagesTest(unittest.TestCase):

    def test_the_committed_images_are_centred(self):
        for target in brand.TARGETS:
            with self.subTest(target=target.name):
                with Image.open(os.path.join(ROOT, target.name)) as image:
                    self.assertEqual(image.size, (target.width, target.height))
                    self.assertLessEqual(brand.off_centre(image), brand.CENTRE_TOLERANCE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
