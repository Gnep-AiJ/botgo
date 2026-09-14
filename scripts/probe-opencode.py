"""Bounded live compatibility gate. Secret is read from the process environment.

Uses only a synthetic project, emits no request headers or raw error bodies.
The supplied upstream key must itself have a hard account-side spending limit.
"""
import json
import os
import pathlib
import subprocess
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "artifacts/verification/opencode-bootstrap"
ORIGIN = "https://www.lvzhouai.cc/v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    key = os.environ.get("BOTGO_PROBE_KEY")
    if not key:
        raise RuntimeError("BOTGO_PROBE_KEY is required")
    opener = urllib.request.build_opener(NoRedirect())
    def call(path, body=None):
        request = urllib.request.Request(ORIGIN + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            with opener.open(request, timeout=35) as response:
                data = response.read(2 * 1024 * 1024 + 1)
                if len(data) > 2 * 1024 * 1024:
                    return {"status": response.status, "error": "size_limit"}
                return {"status": response.status, "data": json.loads(data)}
        except urllib.error.HTTPError as error:
            return {"status": error.code}
        except Exception as error:
            return {"error": type(error).__name__}

    result = {"runtime": "1.18.30", "sourceCommit": "3104c1428ec91f809e5ab86631300de41eb6952e"}
    models = call("/models")
    ids = [m.get("id") for m in models.get("data", {}).get("data", [])]
    model = next((m for m in ["gpt-5.6-luna", "gpt-5-mini", "gpt-4.1-mini"] if m in ids), None)
    result["models"] = {"status": models.get("status"), "count": len(ids), "selected": model}
    if not model:
        result["blocked"] = "No approved low-cost model in upstream catalog"
    else:
        chat = call("/chat/completions", {"model": model, "messages": [{"role": "user", "content": "Reply only OK"}], "max_completion_tokens": 32})
        result["chat"] = {"status": chat.get("status"), "usage": chat.get("data", {}).get("usage")}
        if chat.get("status") == 200 and result["chat"]["usage"]:
            project = DEST / "native-project"
            project.mkdir(exist_ok=True)
            config = {"$schema": "https://opencode.ai/config.json", "enabled_providers": ["botgo"],
                "model": "botgo/" + model, "small_model": "botgo/" + model,
                "share": "disabled", "autoupdate": False,
                "provider": {"botgo": {"npm": "@ai-sdk/openai-compatible", "name": "BotGo test",
                    "options": {"baseURL": ORIGIN, "apiKey": "{env:BOTGO_PROBE_KEY}"},
                    "models": {model: {"name": model, "limit": {"context": 32768, "output": 512}}}}},
                "permission": {"*": "deny", "read": "allow", "glob": "allow", "grep": "allow", "edit": "allow", "external_directory": "deny"}}
            env = {**os.environ, "OPENCODE_CONFIG_CONTENT": json.dumps(config), "OPENCODE_DISABLE_PROJECT_CONFIG": "true"}
            for kind in ["CONFIG", "DATA", "CACHE", "STATE"]:
                env["XDG_" + kind + "_HOME"] = str(DEST / "profile" / kind.lower())
            command = [str(DEST / "runtime/opencode.exe"), "run", "--pure", "--format", "json", "--dir", str(project),
                "Use your file editing tool to create gate.txt containing exactly BOTGO_NATIVE_OK. Read it back, then reply OK. Do not run commands or access other files."]
            try:
                completed = subprocess.run(command, env=env, capture_output=True, timeout=120)
                events = []
                for line in completed.stdout.decode("utf-8", errors="replace").splitlines():
                    try:
                        event = json.loads(line)
                        events.append({"type": event.get("type"), "sessionID": event.get("sessionID"),
                            "tool": event.get("part", {}).get("tool"), "tokens": event.get("part", {}).get("tokens")})
                    except ValueError:
                        pass
                output = project / "gate.txt"
                result["native"] = {"exitCode": completed.returncode, "events": events,
                    "fileCorrect": output.exists() and output.read_text().strip() == "BOTGO_NATIVE_OK",
                    "stderrBytes": len(completed.stderr)}
                if completed.returncode or not events:
                    # Only expose known diagnostic categories, never arbitrary upstream output.
                    stderr = completed.stderr.decode("utf-8", errors="replace")
                    result["native"]["diagnostics"] = [s for s in ["EPERM", "EACCES", "ENOENT", "ConfigInvalidError", "APIError", "ConnectionRefused", "timeout"] if s in stderr]
            except subprocess.TimeoutExpired:
                result["native"] = {"error": "timeout"}
        else:
            result["blocked"] = "Chat protocol or usage gate failed; native request not attempted"
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "live-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
