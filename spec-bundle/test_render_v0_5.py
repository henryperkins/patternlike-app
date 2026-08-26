from __future__ import annotations

import contextlib
import hashlib
import io
import os
import tempfile
import unittest
from unittest import mock

import render_v0_5 as renderer


class RenderReproducibilityTest(unittest.TestCase):
    def test_consecutive_renders_are_byte_identical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_paths = {
                "docx": os.path.join(directory, "spec.docx"),
                "pdf": os.path.join(directory, "spec.pdf"),
                "manifest": os.path.join(directory, "spec_manifest.json"),
            }

            with (
                mock.patch.object(renderer, "DOCX", artifact_paths["docx"]),
                mock.patch.object(renderer, "PDF", artifact_paths["pdf"]),
                mock.patch.object(renderer, "MANIFEST", artifact_paths["manifest"]),
            ):
                renders = []
                for wall_clock in (1_600_000_000, 1_700_000_000):
                    with (
                        mock.patch("time.time", return_value=wall_clock),
                        contextlib.redirect_stdout(io.StringIO()),
                    ):
                        self.assertEqual(renderer.main(), 0)
                    renders.append(
                        {
                            name: hashlib.sha256(
                                io.open(path, "rb").read()
                            ).hexdigest()
                            for name, path in artifact_paths.items()
                        }
                    )

        self.assertEqual(renders[0], renders[1])


if __name__ == "__main__":
    unittest.main()
