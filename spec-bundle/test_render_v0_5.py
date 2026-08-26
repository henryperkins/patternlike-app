from __future__ import annotations

import contextlib
import hashlib
import io
import json
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

    def test_committed_artifacts_match_current_source(self) -> None:
        committed = {
            "docx": renderer.DOCX,
            "pdf": renderer.PDF,
            "manifest": renderer.MANIFEST,
        }
        with tempfile.TemporaryDirectory() as directory:
            rendered = {
                name: os.path.join(directory, os.path.basename(path))
                for name, path in committed.items()
            }
            with (
                mock.patch.object(renderer, "DOCX", rendered["docx"]),
                mock.patch.object(renderer, "PDF", rendered["pdf"]),
                mock.patch.object(renderer, "MANIFEST", rendered["manifest"]),
                contextlib.redirect_stdout(io.StringIO()),
                warnings.catch_warnings(),
            ):
                warnings.simplefilter("ignore", ResourceWarning)
                self.assertEqual(renderer.main(), 0)

            for name, committed_path in committed.items():
                self.assertEqual(sha256_file(rendered[name]), sha256_file(committed_path))

    def test_manifest_records_pinned_renderer_inputs(self) -> None:
        with io.open(renderer.MANIFEST, encoding="utf-8") as handle:
            manifest = json.load(handle)

        self.assertIn("build_inputs", manifest)
        build_inputs = manifest["build_inputs"]
        expected = {
            "render_v0_5.py": os.path.join(renderer.HERE, "render_v0_5.py"),
            "render_v0_5.requirements.txt": os.path.join(
                renderer.HERE,
                "render_v0_5.requirements.txt",
            ),
        }
        self.assertEqual(set(build_inputs), set(expected))
        for filename, path in expected.items():
            expected_sha, expected_bytes = renderer.digest(path)
            self.assertEqual(build_inputs[filename]["sha256"], expected_sha)
            self.assertEqual(build_inputs[filename]["bytes"], expected_bytes)

    def test_text_build_input_hashes_ignore_line_endings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            for suffix in (".md", ".json", ".py", ".txt"):
                lf_path = os.path.join(directory, f"lf{suffix}")
                crlf_path = os.path.join(directory, f"crlf{suffix}")
                with io.open(lf_path, "wb") as handle:
                    handle.write(b"first\nsecond\n")
                with io.open(crlf_path, "wb") as handle:
                    handle.write(b"first\r\nsecond\r\n")
                self.assertEqual(renderer.digest(lf_path), renderer.digest(crlf_path))

    def test_freshness_hash_ignores_manifest_line_endings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lf_path = os.path.join(directory, "lf.json")
            crlf_path = os.path.join(directory, "crlf.json")
            with io.open(lf_path, "wb") as handle:
                handle.write(b'{\n  "value": true\n}\n')
            with io.open(crlf_path, "wb") as handle:
                handle.write(b'{\r\n  "value": true\r\n}\r\n')
            self.assertEqual(sha256_file(lf_path), sha256_file(crlf_path))


if __name__ == "__main__":
    unittest.main()
