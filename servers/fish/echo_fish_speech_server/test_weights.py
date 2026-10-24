from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from echo_fish_speech_server.weights import checkpoint_ready, hf_repo_for_checkpoint


class WeightsTests(unittest.TestCase):
    def test_checkpoint_ready(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)
            self.assertFalse(checkpoint_ready(path))
            (path / "config.json").write_text("{}", encoding="utf-8")
            self.assertTrue(checkpoint_ready(path))

    def test_hf_repo_mapping(self) -> None:
        self.assertEqual(hf_repo_for_checkpoint("checkpoints/drama-3"), "fishaudio/drama-3")
        self.assertEqual(hf_repo_for_checkpoint("checkpoints/s2-pro"), "fishaudio/s2-pro")


if __name__ == "__main__":
    unittest.main()
