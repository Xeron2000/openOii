from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.style_template import StyleTemplate


COMIC_STYLE_LOCK = (
    "stylized 2D comic/anime frame, clean ink line art, cel shading or ink shading, "
    "expressive manga faces, readable silhouettes, consistent character design, "
    "coherent comic panel composition, non-photorealistic rendering"
)

COMIC_NEGATIVE_LOCK = (
    "photorealistic, hyperrealistic, live action, real footage, DSLR photo, 35mm photo, "
    "documentary look, realistic skin pores, uncanny realistic face, 3D realistic render, "
    "style drift, inconsistent outfit, changed character identity, extra characters"
)

CHARACTER_IDENTITY_LOCK = (
    "canonical character design sheet, stable face geometry, stable hairstyle, stable outfit, "
    "stable color palette, clear full character identity, reusable reference for later panels"
)

SHOT_CONTINUITY_LOCK = (
    "use the provided character reference as identity anchor, preserve exact face, hairstyle, "
    "outfit, body proportions, signature accessories, and character color palette, no redesign"
)

VIDEO_CONTINUITY_LOCK = (
    "animate the existing storyboard frame only, preserve the first-frame composition, "
    "same characters, same outfits, same hair colors, same 2D comic/anime style, no identity drift"
)

BUILTIN_STYLE_PROMPTS: dict[str, str] = {
    "anime": (
        "anime comic style, 2D illustration, clean line art, cel shading, vibrant colors, "
        "Japanese animation look"
    ),
    "shonen": (
        "shonen manga/anime style, bold ink lines, high contrast, dynamic composition, "
        "dramatic cel-shaded lighting"
    ),
    "slice-of-life": (
        "slice-of-life anime comic style, soft pastel colors, warm lighting, rounded lines, "
        "cozy hand-drawn atmosphere"
    ),
    "manga": "manga style, ink line art, halftone dots, speed lines, high contrast comic panels",
    "donghua": (
        "Chinese animation comic style, flowing ink lines, oriental color palette, "
        "watercolor texture, stylized 2D rendering"
    ),
    "cinematic": (
        "cinematic anime comic style, storyboard keyframe, clean ink line art, cel shading, "
        "dramatic lighting, filmic composition without photorealism"
    ),
    "pixar": "3D cartoon style, rounded shapes, expressive stylized characters, colorful animation look",
    "lowpoly": "low poly stylized animation, geometric shapes, faceted surfaces, minimalist palette",
    "watercolor": (
        "watercolor comic illustration, soft bleeding edges, transparent layering, "
        "hand-painted 2D texture"
    ),
    "sketch": "pencil sketch comic style, cross-hatching, monochrome shading, rough hand-drawn lines",
    "realistic": (
        "semi-realistic comic illustration, grounded proportions, clean line art, painted cel shading, "
        "not photographic"
    ),
    "guofeng-manga": (
        "guofeng manga, Chinese traditional art, fine ink lines, watercolor coloring, "
        "classical oriental comic atmosphere"
    ),
    "cyberpunk": (
        "cyberpunk anime comic style, neon lights, dark urban atmosphere, rain-slicked streets, "
        "holographic accents, clean line art"
    ),
    "fairy-tale": (
        "fairy tale comic illustration, soft rounded shapes, warm colors, hand-painted texture, "
        "dreamy storybook atmosphere"
    ),
}


@dataclass(frozen=True)
class ResolvedStylePrompt:
    style_prompt: str
    negative_prompt: str


def _style_key(style: str | None) -> str:
    return (style or "").strip().lower()


def _with_color_palette(prompt: str, color_palette: list[str] | None) -> str:
    if not color_palette:
        return prompt
    colors = ", ".join(color_palette)
    return f"{prompt}, {colors}" if colors else prompt


def _sanitize_photorealism(prompt: str) -> str:
    replacements = {
        "photorealistic": "stylized comic",
        "hyperrealistic": "stylized comic",
        "35mm film grain": "subtle comic texture",
        "35mm photo": "comic keyframe",
        "DSLR photo": "comic keyframe",
        "natural lighting": "stylized comic lighting",
        "shallow depth of field": "layered comic depth",
        "detailed textures": "clean illustrated textures",
        "real-world proportions": "grounded comic proportions",
    }
    result = prompt
    for old, new in replacements.items():
        result = result.replace(old, new)
    return result


def _merge_negative_prompt(negative_prompt: str | None) -> str:
    if not negative_prompt or not negative_prompt.strip():
        return COMIC_NEGATIVE_LOCK
    return f"{negative_prompt.strip()}, {COMIC_NEGATIVE_LOCK}"


def _lock_prompt(prompt: str) -> str:
    cleaned = _sanitize_photorealism(prompt.strip())
    if not cleaned:
        cleaned = BUILTIN_STYLE_PROMPTS["anime"]
    return f"{cleaned}, {COMIC_STYLE_LOCK}"


def resolve_style_prompt_sync(style: str | None) -> ResolvedStylePrompt:
    key = _style_key(style)
    base_prompt = BUILTIN_STYLE_PROMPTS.get(key)
    if base_prompt is None:
        base_prompt = (
            style.strip()
            if isinstance(style, str) and style.strip()
            else BUILTIN_STYLE_PROMPTS["anime"]
        )
    return ResolvedStylePrompt(
        style_prompt=_lock_prompt(base_prompt),
        negative_prompt=COMIC_NEGATIVE_LOCK,
    )


async def resolve_style_prompt(session: AsyncSession, style: str | None) -> ResolvedStylePrompt:
    key = _style_key(style)
    if key in BUILTIN_STYLE_PROMPTS:
        return resolve_style_prompt_sync(key)

    if key:
        res = await session.execute(
            select(StyleTemplate).where(
                StyleTemplate.slug == key,
                StyleTemplate.is_active.is_(True),
            )
        )
        template = res.scalar_one_or_none()
        if template:
            base_prompt = _with_color_palette(template.style_prompt, template.color_palette)
            return ResolvedStylePrompt(
                style_prompt=_lock_prompt(base_prompt),
                negative_prompt=_merge_negative_prompt(template.negative_prompt),
            )

    return resolve_style_prompt_sync(style)
