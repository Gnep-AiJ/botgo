"""Synthetic PDF acceptance fixtures; no user files or personal information."""
import json
import pathlib
import secrets
import sys
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader

out = pathlib.Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
manifest = {}
token = lambda: "PDF-" + secrets.token_hex(6).upper()
text_token = token()
c = canvas.Canvas(str(out / "text.pdf"))
c.drawString(50, 750, "BotGo synthetic text PDF")
c.drawString(50, 710, "Verification token: " + text_token)
c.showPage()
c.drawString(50, 750, "Page two: the verification token is on page one.")
c.save()
manifest["text.pdf"] = {"token": text_token, "pages": 2, "kind": "text"}

for name, large in [("scan.pdf", False), ("large.pdf", True)]:
    scan_token = token()
    image = Image.new("RGB", (1600, 1200), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 55)
    draw.text((90, 110), "BotGo synthetic scanned page", fill="black", font=font)
    draw.text((90, 250), "Verification token:", fill="black", font=font)
    draw.text((90, 330), scan_token, fill="black", font=font)
    draw.rectangle((100, 600, 500, 800), fill="#1959cc")
    draw.rectangle((700, 600, 1100, 800), fill="#eb6e22")
    if large:
        image.paste(Image.frombytes("RGB", (1600, 400), secrets.token_bytes(1600 * 400 * 3)), (0, 800))
    c = canvas.Canvas(str(out / name))
    c.drawImage(ImageReader(image), 0, 250, width=595, height=446)
    c.save()
    manifest[name] = {"token": scan_token, "pages": 1, "kind": "scanned", "bytes": (out / name).stat().st_size}

for name, metadata in manifest.items():
    doc = PdfReader(out / name)
    assert len(doc.pages) == metadata["pages"]
    extracted = "".join(page.extract_text() for page in doc.pages)
    if metadata["kind"] == "scanned":
        assert not extracted.strip(), "Scanned token must exist only in pixels"
    else:
        assert metadata["token"] in extracted
assert manifest["large.pdf"]["bytes"] > 1_000_000
(out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"fixtures": list(manifest), "largeBytes": manifest["large.pdf"]["bytes"]}))
