import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app


class Tests(unittest.TestCase):
    def test_extract(self):
        self.assertEqual(app.extract_watts("Load: 230 W", r"Load: (\d+)"), 230)
        self.assertEqual(app.extract_watts("load 50%", None, r"load (\d+)%", 400), 200)
        self.assertIsNone(app.extract_watts("x", r"(\d+)"))

    def test_integration(self):
        with tempfile.TemporaryDirectory() as d:
            m = app.Meter(os.path.join(d, "c.json"))
            m.add_reading(1000, now=0)
            for t in range(600, 3601, 600):
                m.add_reading(1000, now=t)
            self.assertAlmostEqual(m.snapshot()["total_kwh"], 1.0)
            self.assertAlmostEqual(app.Meter(m.path).total_kwh, 1.0)


if __name__ == "__main__":
    unittest.main()
