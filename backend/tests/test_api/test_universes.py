from __future__ import annotations

import pytest

from app.models.universe import SharedCharacter, Universe

pytestmark = pytest.mark.asyncio


async def test_create_universe_round_trips_cover_image_url(async_client):
    res = await async_client.post(
        "/api/v1/universes",
        json={
            "name": "Cover World",
            "description": "with cover",
            "world_setting": "shared world",
            "style_rules": "bright panels",
            "cover_image_url": "/static/images/cover.png",
        },
    )

    assert res.status_code == 201
    data = res.json()
    assert data["cover_image_url"] == "/static/images/cover.png"

    list_res = await async_client.get("/api/v1/universes")
    assert list_res.status_code == 200
    assert list_res.json()[0]["cover_image_url"] == "/static/images/cover.png"


async def test_update_universe_can_clear_nullable_fields(async_client, test_session):
    universe = Universe(
        name="Clearable",
        description="old description",
        world_setting="old world",
        style_rules="old style",
        cover_image_url="/static/images/old.png",
    )
    test_session.add(universe)
    await test_session.commit()
    await test_session.refresh(universe)

    res = await async_client.put(
        f"/api/v1/universes/{universe.id}",
        json={
            "description": None,
            "world_setting": None,
            "style_rules": None,
            "cover_image_url": None,
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["description"] is None
    assert data["world_setting"] is None
    assert data["style_rules"] is None
    assert data["cover_image_url"] is None


async def test_shared_character_response_preserves_has_embedding(async_client, test_session):
    universe = Universe(name="Embedding World")
    test_session.add(universe)
    await test_session.commit()
    await test_session.refresh(universe)

    shared_character = SharedCharacter(
        universe_id=universe.id,
        name="Embedded Character",
        face_embedding="[0.1, 0.2, 0.3]",
    )
    test_session.add(shared_character)
    await test_session.commit()

    list_res = await async_client.get(f"/api/v1/universes/{universe.id}/shared-characters")
    assert list_res.status_code == 200
    assert list_res.json()[0]["has_embedding"] is True

    detail_res = await async_client.get(f"/api/v1/universes/{universe.id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["shared_characters"][0]["has_embedding"] is True
