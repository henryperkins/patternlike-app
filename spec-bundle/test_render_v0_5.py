from __future__ import annotations

import contextlib
import hashlib
import io
import os
import tempfile
import unittest
import warnings
from unittest import mock

import render_v0_5 as renderer


def sha256_file(path: str) -> str:
    with io.open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


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
                        warnings.catch_warnings(),
                    ):
                        warnings.simplefilter("ignore", ResourceWarning)
                        self.assertEqual(renderer.main(), 0)
                    renders.append(
                        {
                            name: sha256_file(path)
                            for name, path in artifact_paths.items()
                        }
                    )

        self.assertEqual(renders[0], renders[1])


if __name__ == "__main__":
    unittest.main()
