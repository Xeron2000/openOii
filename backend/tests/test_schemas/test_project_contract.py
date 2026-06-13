from __future__ import annotations

import re
from pathlib import Path

from app.schemas.project import ProjectCreate, ProjectUpdate


def _frontend_update_project_fields() -> set[str]:
    types_file = Path(__file__).resolve().parents[3] / "frontend" / "app" / "types" / "index.ts"
    content = types_file.read_text()
    match = re.search(
        r"export\s+type\s+UpdateProjectPayload\s*=\s*Partial<(?P<body>.*?)>;",
        content,
        flags=re.S,
    )
    assert match is not None, "frontend UpdateProjectPayload type not found"
    provider_payload_body = content.split(
        "export interface ProjectProviderOverridesPayload", 1
    )[1].split("}", 1)[0]
    return set(re.findall(r'\|\s+"([^"]+)"', match.group("body"))) | set(
        re.findall(r"([a-z_]+)\?:", provider_payload_body)
    )


def _frontend_create_project_fields() -> set[str]:
    types_file = Path(__file__).resolve().parents[3] / "frontend" / "app" / "types" / "index.ts"
    content = types_file.read_text()
    match = re.search(
        r"export\s+interface\s+CreateProjectPayload.*?{(?P<body>.*?)}",
        content,
        flags=re.S,
    )
    assert match is not None, "frontend CreateProjectPayload interface not found"
    provider_payload_body = content.split(
        "export interface ProjectProviderOverridesPayload", 1
    )[1].split("}", 1)[0]
    return set(re.findall(r"([a-z_]+)\??:", match.group("body"))) | set(
        re.findall(r"([a-z_]+)\?:", provider_payload_body)
    )


def test_project_create_payload_fields_match_frontend_contract() -> None:
    backend_fields = set(ProjectCreate.model_fields)
    frontend_fields = _frontend_create_project_fields()
    assert frontend_fields == backend_fields


def test_project_update_payload_fields_match_frontend_contract() -> None:
    backend_fields = set(ProjectUpdate.model_fields)
    frontend_fields = _frontend_update_project_fields()
    assert frontend_fields == backend_fields
