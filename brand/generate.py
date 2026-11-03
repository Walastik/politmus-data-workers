"""Generate the Politmus "P" monogram SVGs from one shared geometry.

Run from anywhere:  python3 brand/generate.py

Outputs (all written next to this script, except the favicon):
  politmus-monogram.svg          full-detail mark, transparent background
  app-icon-ios.svg               1024x1024, full bleed paper background (iOS masks the corners)
  app-icon-android-foreground.svg   adaptive icon foreground, glyph inside the 66/108 safe zone
  app-icon-android-background.svg   adaptive icon background (textured paper)
  app-icon-android-monochrome.svg   Android 13+ themed icon layer (alpha only)
  ../apps/app/public/monogram.svg   copy of the full-detail mark for the website header
  ../apps/app/public/favicon.svg    simplified mark that stays legible at 16-32px

The glyph lives in a 600x800 box: stem on the left, D-shaped bowl on the right,
and the bowl's lower ribbon folding over the stem.
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
FAVICON = HERE.parent / "apps" / "app" / "public" / "favicon.svg"
SITE_MONOGRAM = HERE.parent / "apps" / "app" / "public" / "monogram.svg"

# Litmus palette (from the brand strip): red -> violet -> blue.
RED, VIOLET, BLUE = "#DC2626", "#7C3AED", "#2563EB"
INK = "#111111"
PAPER = "#F7F4EE"

# --- Glyph geometry (600x800 box) -------------------------------------------
# Outer silhouette plus the counter, filled with evenodd.
SILHOUETTE = (
    "M0 14Q0 0 14 0H320A268 268 0 0 1 320 536H180V786Q180 800 166 800H14Q0 800 0 786Z"
    "M180 164H310A99 99 0 0 1 310 362H180Z"
)
# Interior fold lines: the shoulder under the top bar, then the two edges of
# the bowl's lower ribbon curling down over the stem.
SHOULDER = "M0 164H180"
FOLD_TOP = "M180 362H92C32 362 0 398 0 468"
FOLD_BOTTOM = "M180 536H78C26 536 0 558 0 594"
# Stem area that sits "behind" the ribbon (between shoulder and fold).
BEHIND_STEM = "M0 164H180V362H92C32 362 0 398 0 468Z"
# Band just under the ribbon where it casts a shadow on the stem.
UNDER_FOLD = "M0 594C0 558 26 536 78 536H180V660H0Z"


def defs(p: str, *, texture: bool) -> str:
    """Gradient + filters, id-prefixed so several glyphs could share a page."""
    grad = f"""
    <linearGradient id="{p}litmus" gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="250" y2="800">
      <stop offset="0" stop-color="{RED}"/>
      <stop offset=".28" stop-color="{RED}"/>
      <stop offset=".5" stop-color="{VIOLET}"/>
      <stop offset=".72" stop-color="{BLUE}"/>
      <stop offset="1" stop-color="{BLUE}"/>
    </linearGradient>
    <clipPath id="{p}clip"><path clip-rule="evenodd" d="{SILHOUETTE}"/></clipPath>
    <linearGradient id="{p}foldShade" gradientUnits="userSpaceOnUse" x1="0" y1="536" x2="0" y2="660">
      <stop offset="0" stop-color="#1D4ED8" stop-opacity=".45"/>
      <stop offset="1" stop-color="#1D4ED8" stop-opacity="0"/>
    </linearGradient>"""
    if not texture:
        return grad
    # Watercolor: warp the gradient so the colour boundaries bleed, lift some
    # pale blooms out of it, then multiply the fibrous litmus-paper lighting on top.
    return grad + f"""
    <filter id="{p}watercolor" filterUnits="userSpaceOnUse" x="-60" y="-60" width="720" height="920" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="7" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="110" xChannelSelector="R" yChannelSelector="G" result="bleed"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="3" seed="11" result="bloomNoise"/>
      <feColorMatrix in="bloomNoise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0 0 0 -0.38" result="bloom"/>
      <feComposite in="bloom" in2="bleed" operator="atop" result="washed"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" seed="2" result="fiber"/>
      <feDiffuseLighting in="fiber" lighting-color="#ffffff" surfaceScale="1.2" result="light">
        <feDistantLight azimuth="45" elevation="60"/>
      </feDiffuseLighting>
      <feBlend in="washed" in2="light" mode="multiply"/>
    </filter>
    <filter id="{p}shadowBlur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="3"/>
    </filter>"""


def glyph(p: str, *, stroke: float, texture: bool, detail: bool, shadow: bool) -> str:
    """The P drawn in glyph space (600x800). Wrap it in a transform to place it."""
    out = []
    if shadow:
        out.append(
            f'<path transform="translate(16 14)" fill="#4C1D95" fill-opacity=".16" '
            f'fill-rule="evenodd" filter="url(#{p}shadowBlur)" d="{SILHOUETTE}"/>'
        )
    if texture:
        out.append(
            f'<rect x="-60" y="-60" width="720" height="920" fill="url(#{p}litmus)" '
            f'filter="url(#{p}watercolor)" clip-path="url(#{p}clip)"/>'
        )
    else:
        out.append(f'<path fill="url(#{p}litmus)" fill-rule="evenodd" d="{SILHOUETTE}"/>')
    if detail:
        # Overlapping "reaction steps": translucent tints where the ribbon
        # passes in front of the stem, echoing the litmus strip overlays.
        out.append(
            f'<g clip-path="url(#{p}clip)">'
            f'<path fill="#7F1D1D" fill-opacity=".22" d="{BEHIND_STEM}"/>'
            f'<path fill="url(#{p}foldShade)" d="{UNDER_FOLD}"/>'
            f"</g>"
        )
    lines = [f'<path fill="none" fill-rule="evenodd" d="{SILHOUETTE}"/>']
    if detail:
        lines += [f'<path fill="none" d="{d}"/>' for d in (SHOULDER, FOLD_TOP, FOLD_BOTTOM)]
    out.append(
        f'<g stroke="{INK}" stroke-width="{stroke}" stroke-linecap="round" '
        f'stroke-linejoin="round">{"".join(lines)}</g>'
    )
    return "\n  ".join(out)


def paper_defs(p: str, freq: float) -> str:
    return f"""
    <filter id="{p}paper" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="{freq}" numOctaves="4" seed="5" result="noise"/>
      <feDiffuseLighting in="noise" lighting-color="#ffffff" surfaceScale="0.5" result="light">
        <feDistantLight azimuth="45" elevation="75"/>
      </feDiffuseLighting>
      <feBlend in="SourceGraphic" in2="light" mode="multiply"/>
    </filter>"""


def svg(view_box: str, body: str, *, title: str, size: int | None = None) -> str:
    dims = f' width="{size}" height="{size}"' if size else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"{dims} role="img">\n'
        f"  <title>{title}</title>\n{body}\n</svg>\n"
    )


def place(scale: float, anchor_x: float = 294, canvas: float = 1024) -> str:
    """Put glyph point (anchor_x, 400) at the canvas center, at the given scale.

    The default anchor is the bounding-box center of the 588x800 glyph.
    """
    tx = canvas / 2 - anchor_x * scale
    ty = canvas / 2 - 400 * scale
    return f"translate({tx:.1f} {ty:.1f}) scale({scale})"


def monochrome_mask(p: str) -> str:
    """Alpha mask for the one-colour P: the fold lines become gaps and the stem
    behind the ribbon drops to partial alpha, so the loop still reads when
    Android tints the whole layer a single colour."""
    # Gap versions of the fold lines: butt ends that stop flush at the bowl and
    # run out past the stem's left edge, so the cuts leave no nicks or slivers.
    gaps = ("M-20 164H181", "M181 362H92C40 362 6 392 -24 446", "M181 536H78C34 536 6 552 -24 578")
    lines = "".join(f'<path d="{d}"/>' for d in gaps)
    return f"""
    <linearGradient id="{p}foldFade" gradientUnits="userSpaceOnUse" x1="0" y1="536" x2="0" y2="660">
      <stop offset="0" stop-color="#000" stop-opacity=".5"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <mask id="{p}mask" maskUnits="userSpaceOnUse" x="-60" y="-60" width="720" height="920">
      <path fill="#fff" fill-rule="evenodd" d="{SILHOUETTE}"/>
      <path fill="#000" fill-opacity=".45" d="{BEHIND_STEM}"/>
      <path fill="url(#{p}foldFade)" d="{UNDER_FOLD}"/>
      <g fill="none" stroke="#000" stroke-width="30">{lines}</g>
    </mask>"""


def build() -> dict[Path, str]:
    files: dict[Path, str] = {}

    # Full-detail mark, transparent. Padding leaves room for stroke and shadow.
    files[HERE / "politmus-monogram.svg"] = svg(
        "-30 -30 660 860",
        f"  <defs>{defs('m-', texture=True)}\n  </defs>\n  "
        + glyph("m-", stroke=18, texture=True, detail=True, shadow=True),
        title="Politmus",
    )

    # iOS: 1024 square, opaque, no rounded corners (the OS applies the mask).
    files[HERE / "app-icon-ios.svg"] = svg(
        "0 0 1024 1024",
        f"  <defs>{defs('i-', texture=True)}{paper_defs('i-', 0.09)}\n  </defs>\n"
        f'  <rect width="1024" height="1024" fill="{PAPER}" filter="url(#i-paper)"/>\n'
        f'  <g transform="{place(0.83)}">\n  '
        + glyph("i-", stroke=24, texture=True, detail=True, shadow=True)
        + "\n  </g>",
        title="Politmus",
        size=1024,
    )

    # Android adaptive icon: 108dp canvas drawn at 1024 units, and only the
    # 66dp safe circle (r = 313 units) is guaranteed to survive every launcher
    # mask. Anchoring at x=230 rather than the bbox center (294) balances the
    # stem's square corners against the round bowl, which lets the glyph grow
    # to 0.667 (stroke included) while staying inside the circle.
    android_place = place(0.667, anchor_x=230)
    files[HERE / "app-icon-android-foreground.svg"] = svg(
        "0 0 1024 1024",
        f"  <defs>{defs('a-', texture=True)}\n  </defs>\n"
        f'  <g transform="{android_place}">\n  '
        + glyph("a-", stroke=26, texture=True, detail=True, shadow=True)
        + "\n  </g>",
        title="Politmus",
        size=1024,
    )
    files[HERE / "app-icon-android-background.svg"] = svg(
        "0 0 1024 1024",
        f"  <defs>{paper_defs('b-', 0.09)}\n  </defs>\n"
        f'  <rect width="1024" height="1024" fill="{PAPER}" filter="url(#b-paper)"/>',
        title="Politmus background",
        size=1024,
    )
    files[HERE / "app-icon-android-monochrome.svg"] = svg(
        "0 0 1024 1024",
        f"  <defs>{monochrome_mask('mo-')}\n  </defs>\n"
        f'  <g transform="{android_place}">\n'
        f'    <rect x="-60" y="-60" width="720" height="920" fill="#000" mask="url(#mo-mask)"/>\n'
        f"  </g>",
        title="Politmus",
        size=1024,
    )

    # The website header serves the full mark as a file, so the browser draws
    # its filters; the native header uses PNGs rendered from it.
    files[SITE_MONOGRAM] = files[HERE / "politmus-monogram.svg"]

    # Favicon: flat gradient, heavy outline, no texture or fold lines, which
    # turn to mud below ~48px.
    files[FAVICON] = svg(
        "-136 -30 860 860",
        f"  <defs>{defs('f-', texture=False)}\n  </defs>\n  "
        + glyph("f-", stroke=44, texture=False, detail=False, shadow=False),
        title="Politmus",
    )
    return files


if __name__ == "__main__":
    for path, text in build().items():
        path.write_text(text)
        print(f"wrote {path.relative_to(HERE.parent)}")
