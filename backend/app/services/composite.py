from __future__ import annotations

from PIL import Image, ImageColor, ImageFilter


def _parse_color(color: str) -> tuple[int, int, int, int]:
    try:
        rgb = ImageColor.getrgb(color)
    except Exception:
        rgb = ImageColor.getrgb("#ffffff")
    return (rgb[0], rgb[1], rgb[2], 255)


def apply_background_mode(
    original: Image.Image,
    foreground_rgba: Image.Image,
    bg_mode: str,
    solid_color: str = "#ffffff",
    custom_background: Image.Image | None = None,
) -> Image.Image:
    fg = foreground_rgba.convert("RGBA")
    width, height = fg.size

    if bg_mode == "transparent":
        return fg

    if bg_mode == "solid":
        bg = Image.new("RGBA", (width, height), _parse_color(solid_color))
        return Image.alpha_composite(bg, fg)

    if bg_mode == "blur":
        bg = original.convert("RGB").resize((width, height)).filter(ImageFilter.GaussianBlur(radius=16)).convert("RGBA")
        return Image.alpha_composite(bg, fg)

    if bg_mode == "custom":
        if custom_background is None:
            raise ValueError("custom background image is required when bg_mode=custom")
        bg = custom_background.convert("RGB").resize((width, height)).convert("RGBA")
        return Image.alpha_composite(bg, fg)

    raise ValueError(f"unsupported bg_mode: {bg_mode}")
