"""One metered native image call in an isolated home; no user history is read."""
import json
from pathlib import Path
from hermes_cli.config import load_config
from tools.image_generation_tool import check_image_generation_requirements, _handle_image_generate

cfg = load_config()
assert check_image_generation_requirements(), "Native image tool is unavailable"
result = json.loads(_handle_image_generate({"prompt": "A simple blue circle on a plain white background, no text.", "aspect_ratio": "square"}))
assert result.get("success"), result
image = Path(result["image"])
assert image.is_file() and image.stat().st_size > 100, "Image was not saved locally"
print(json.dumps({"success": True, "image": str(image), "bytes": image.stat().st_size,
    "memoryEnabled": cfg["memory"]["memory_enabled"], "userProfileEnabled": cfg["memory"]["user_profile_enabled"],
    "backgroundReviewEnabled": cfg["auxiliary"]["background_review"]["enabled"],
    "compressionEnabled": cfg["compression"]["enabled"]}))
