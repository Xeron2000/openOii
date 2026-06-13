from __future__ import annotations

import re
from pathlib import Path

from app.schemas.universe import ImportedCharacterRead, SharedCharacterRead, UniverseProjectLinkRead


def _frontend_interface_fields(name: str) -> set[str]:
    types_file = Path(__file__).resolve().parents[3] / "frontend" / "app" / "types" / "index.ts"
    content = types_file.read_text()
    match = re.search(
        rf"export\s+interface\s+{name}\s*{{(?P<body>.*?)\n}}",
        content,
        flags=re.S,
    )
    assert match is not None, f"frontend {name} interface not found"
    return set(re.findall(r"([a-z_]+)\??:", match.group("body")))


def test_imported_character_fields_match_frontend_contract() -> None:
    assert set(ImportedCharacterRead.model_fields) == _frontend_interface_fields(
        "ImportedCharacterRead"
    )


def test_universe_project_link_fields_match_frontend_contract() -> None:
    assert set(UniverseProjectLinkRead.model_fields) == _frontend_interface_fields(
        "UniverseProjectLinkRead"
    )


def test_shared_character_fields_match_frontend_contract() -> None:
    assert set(SharedCharacterRead.model_fields) == _frontend_interface_fields(
        "SharedCharacterRead"
    )
