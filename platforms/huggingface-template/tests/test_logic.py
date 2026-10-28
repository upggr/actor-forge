import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logic import run


class RunTest(unittest.TestCase):
    def test_strips_whitespace(self):
        self.assertEqual(run("  hello  "), "hello")


if __name__ == "__main__":
    unittest.main()
