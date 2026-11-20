import unittest

from formatting import clamp, greeting


class FormattingTests(unittest.TestCase):
    def test_greeting_preserves_name(self):
        self.assertEqual(greeting("An"), "Hello, An!")

    def test_clamp_bounds_and_interior(self):
        for value, expected in [(-1, 0), (0, 0), (5, 5), (10, 10), (11, 10)]:
            with self.subTest(value=value):
                self.assertEqual(clamp(value, 0, 10), expected)


if __name__ == "__main__":
    unittest.main()
