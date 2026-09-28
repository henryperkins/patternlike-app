"""Release-gate regressions for contract validation tooling."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import builtins
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from referencing import Registry

import validate_schemas


class DailyUncertaintyPrivacyTests(unittest.TestCase):
    def packet(self):
        return json.loads((validate_schemas.DAILY_UNCERTAINTY_V1 / "fixtures/valid/reading-generation-request.exact-qualified.json").read_text())

    def test_closed_qualification_labels_are_not_private_properties(self):
        self.assertEqual([], validate_schemas.reading_generation_request_policy(self.packet(), inspect_keys=True))

    def test_actual_private_properties_remain_forbidden_inside_the_plan(self):
        for key in ("birth_time", "birth_instant", "birthplace"):
            with self.subTest(key=key):
                packet = self.packet()
                packet["uncertainty_disclosure"]["injected"] = [{key: "private input"}]
                errors = validate_schemas.reading_generation_request_policy(packet, inspect_keys=True)
                self.assertIn(f'provider boundary: request declares the key "{key}"', errors)


class RequiredOpenApiValidationTests(unittest.TestCase):
    def test_missing_required_dependency_is_a_failure_not_a_skip(self):
        original_import = builtins.__import__
        for dependency in ("yaml", "jsonschema_path", "openapi_spec_validator"):
            with self.subTest(dependency=dependency):
                def blocked_import(name, *args, **kwargs):
                    if name == dependency or name.startswith(dependency + "."):
                        raise ImportError("Simulated missing required dependency")
                    return original_import(name, *args, **kwargs)

                output = StringIO()
                with patch("builtins.__import__", side_effect=blocked_import), redirect_stdout(output):
                    errors = validate_schemas.check_openapi(Path("unused"), Registry())
                self.assertTrue(errors)
                self.assertIn("required OpenAPI validation dependencies unavailable", errors[0])
                self.assertNotIn("SKIP", output.getvalue())

    def test_validator_entrypoint_fails_before_any_package_can_skip_openapi(self):
        with tempfile.TemporaryDirectory(prefix="contract-tooling-") as scratch:
            blocker = Path(scratch) / "sitecustomize.py"
            blocker.write_text(
                "import builtins\n"
                "original_import = builtins.__import__\n"
                "def blocked_import(name, *args, **kwargs):\n"
                "    if name == 'openapi_spec_validator' or name.startswith('openapi_spec_validator.'):\n"
                "        raise ImportError('Simulated missing required dependency')\n"
                "    return original_import(name, *args, **kwargs)\n"
                "builtins.__import__ = blocked_import\n",
                encoding="utf-8",
            )
            environment = dict(os.environ, PYTHONPATH=scratch)
            result = subprocess.run(
                [sys.executable, str(Path(validate_schemas.__file__))],
                text=True, capture_output=True, env=environment, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("required OpenAPI validation dependencies unavailable", result.stdout)
            self.assertNotIn("SKIP", result.stdout)
            self.assertNotIn("== contracts/m0", result.stdout)


if __name__ == "__main__":
    unittest.main()
