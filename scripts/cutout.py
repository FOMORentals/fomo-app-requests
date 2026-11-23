"""Cut-out for a website listing photo (Jamie, 23 Nov 2026), run by .github/workflows/listing-cutout.yml.

  python scripts/cutout.py <in> <out.png>   background removed, trimmed, soft shadow, longest side capped at 2400 px

The website's recipe (fomo-rentals-website-rebuild/tools/image-cutout/cutout.py, `hires`; kit onboarding's
lib/photo.py copies it too): keep them in step. No network apart from rembg fetching its model once (cached).
"""
import sys
from PIL import Image, ImageFilter, ImageOps

SHADOW_OPACITY = 0.14  # same as cutout.py
MAX_EDGE = 2400        # same cap as the website's upload.mjs


def with_shadow(cut: Image.Image) -> Image.Image:
    w, h = cut.size
    blur, dy, pad = max(4, h // 40), max(3, h // 60), max(8, h // 20)
    canvas = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    alpha = cut.split()[-1].point(lambda v: int(v * SHADOW_OPACITY))
    shadow.paste((20, 20, 20, 255), (pad, pad + dy), alpha)
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(cut, (pad, pad))
    return canvas


def cutout(src_path, dst_path):
    from rembg import remove, new_session
    try:
        import pillow_heif  # iPhone photos
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    src = ImageOps.exif_transpose(Image.open(src_path)).convert("RGBA")
    src.thumbnail((3200, 3200))  # rembg gains nothing past the 2400 cap
    out = remove(src, session=new_session("isnet-general-use"))
    box = out.split()[-1].point(lambda v: 255 if v > 10 else 0).getbbox()
    if not box:
        raise SystemExit("nothing was left after removing the background")
    im = with_shadow(out.crop(box))
    im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    im.save(dst_path, "PNG", optimize=True)


if __name__ == "__main__":
    cutout(*sys.argv[1:3])
