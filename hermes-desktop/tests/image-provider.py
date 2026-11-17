"""Contract/security tests for the native managed image backend; no paid API."""
import importlib.util
import io
import json
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("botgo_image", Path(__file__).parents[1] / "overlay/image-provider.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.config = {"base_url": "http://127.0.0.1:23456/v1", "models": [{"id": "fixture-image"}]}
        self.patches = [patch.object(module, "load_image_gen_config", return_value=self.config),
                        patch.object(module, "get_secret", return_value="local-capability")]
        for p in self.patches:
            p.start()
        self.provider = module.BotGoImageProvider()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_native_output_and_billing_session(self):
        from agent.portal_tags import set_conversation_context, reset_conversation_context
        token = set_conversation_context("test-native-image-session")
        try:
            with patch.object(module.urllib.request, "build_opener") as opener, patch.object(module, "materialize_image", return_value=("fixture.png", None)):
                opener.return_value.open.return_value.__enter__.return_value.read.return_value = json.dumps({"data": [{"b64_json": "fixture"}]}).encode()
                result = self.provider.generate("test", "portrait")
                request = opener.return_value.open.call_args.args[0]
                self.assertEqual(json.loads(request.data)["size"], "1024x1536")
                self.assertEqual(request.get_header("X-session-id"), "test-native-image-session")
                self.assertTrue(result["success"])
                self.assertEqual(result["image"], "fixture.png")
        finally:
            reset_conversation_context(token)

    def test_never_send_capability_to_external_host(self):
        self.config["base_url"] = "https://example.invalid/v1"
        with patch.object(module.urllib.request, "build_opener") as opener:
            self.assertFalse(self.provider.generate("test")["success"])
            opener.assert_not_called()

    def test_402_no_retry_or_key_disclosure(self):
        with patch.object(module.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError("local", 402, "private upstream content", {}, io.BytesIO(b"secret"))
            result = self.provider.generate("test")
            self.assertFalse(result["success"])
            self.assertNotIn("secret", json.dumps(result))
            self.assertEqual(opener.return_value.open.call_count, 1)

    def test_capabilities_match_current_text_to_image_route(self):
        self.assertEqual(self.provider.capabilities()["modalities"], ["text"])
        with patch.object(module.urllib.request, "build_opener") as opener:
            self.assertFalse(self.provider.generate("test", image_url="private.png")["success"])
            opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
