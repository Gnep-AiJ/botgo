"""Native image_generate backend using the account's metered local BotGo gateway."""
import json
import re
import uuid
import urllib.error
import urllib.request

from agent.image_gen_provider import ImageGenProvider, resolve_aspect_ratio, success_response
from agent.secret_scope import get_secret
from plugins.image_gen._common import error_factory, load_image_gen_config, materialize_image, size_for


class BotGoImageProvider(ImageGenProvider):
    name = "botgo"
    display_name = "BotGo"

    def list_models(self):
        return [{"id": m["id"], "display": m.get("name") or m["id"]}
                for m in load_image_gen_config("botgo").get("models", [])]

    def is_available(self):
        return bool(self.list_models() and get_secret("BOTGO_HERMES_API_KEY"))

    def generate(self, prompt, aspect_ratio="landscape", *, image_url=None,
                 reference_image_urls=None, **kwargs):
        aspect = resolve_aspect_ratio(aspect_ratio)
        fail = error_factory("botgo", aspect, prompt=prompt)
        if image_url or reference_image_urls:
            return fail("当前 BotGo 接口仅支持文字生图。", "unsupported_modality")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 8192:
            return fail("生图提示词需要 1–8192 个字符。", "invalid_argument")
        cfg = load_image_gen_config("botgo")
        base = cfg.get("base_url", "")
        key = get_secret("BOTGO_HERMES_API_KEY")
        models = self.list_models()
        # Never send the local capability to a configurable external endpoint.
        if not re.fullmatch(r"http://127\.0\.0\.1:[0-9]+/v1", base) or not key or not models:
            return fail("BotGo 生图暂不可用，请重新登录。", "auth_required")
        from agent.opencode_affinity import resolve_affinity_key
        from gateway.session_context import get_session_env
        session = resolve_affinity_key(get_session_env("HERMES_SESSION_ID", "")) or "image-" + uuid.uuid4().hex
        body = {"model": models[0]["id"], "prompt": prompt.strip(), "n": 1,
                "size": size_for(aspect), "quality": "medium"}
        request = urllib.request.Request(base + "/images/generations", json.dumps(body).encode(),
            {"Authorization": "Bearer " + key, "Content-Type": "application/json", "x-session-id": session})
        # No redirect, system proxy, or automatic retry for a chargeable generation.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=300) as response:
                raw = response.read(32 * 1024 * 1024 + 1)
            if len(raw) > 32 * 1024 * 1024:
                return fail("图片响应过大。", "invalid_response")
            data = json.loads(raw).get("data") or []
            if not data:
                return fail("未返回图片。", "empty_response")
            image, error = materialize_image(data[0].get("b64_json"), data[0].get("url"),
                prefix="botgo", label="BotGo", provider="botgo", model=body["model"], prompt=prompt, aspect=aspect)
            if error:
                return error
            return success_response(image=image, model=body["model"], prompt=prompt,
                aspect_ratio=aspect, provider="botgo", modality="text")
        except urllib.error.HTTPError as error:
            return fail({401: "登录已失效。", 402: "余额不足。"}.get(error.code,
                f"生图请求未完成（HTTP {error.code}），请检查后手动重试。"), "api_error")
        except Exception:
            return fail("生图连接中断或响应无效，执行状态未知，请检查后手动重试。", "api_error")


def register(ctx):
    ctx.register_image_gen_provider(BotGoImageProvider())
