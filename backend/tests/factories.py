from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import AgentMessage, AgentRun
from app.models.config_item import ConfigItem
from app.models.message import Message
from app.models.project import Character, Project, Scene, Shot


async def create_project(
    session: AsyncSession,
    title: str = "Test Project",
    description: str = "Test description",
    story: str = "Test story",
    style: str = "anime",
    status: str = "draft",
) -> Project:
    project = Project(
        title=title,
        description=description,
        story=story,
        style=style,
        status=status,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def create_run(
    session: AsyncSession,
    project_id: int,
    status: str = "queued",
) -> AgentRun:
    run = AgentRun(
        project_id=project_id,
        status=status,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def create_message(
    session: AsyncSession,
    run_id: int,
    project_id: int,
    agent: str = "system",
    role: str = "assistant",
    content: str = "Test message",
) -> Message:
    message = Message(
        run_id=run_id,
        project_id=project_id,
        agent=agent,
        role=role,
        content=content,
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def create_agent_message(
    session: AsyncSession,
    run_id: int,
    content: str = "Test feedback",
) -> AgentMessage:
    msg = AgentMessage(run_id=run_id, agent="user", role="user", content=content)
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    return msg


async def create_character(
    session: AsyncSession,
    project_id: int,
    name: str = "Test Character",
    description: str = "Test description",
    image_url: str | None = "http://test.com/image.png",
) -> Character:
    character = Character(
        project_id=project_id,
        name=name,
        description=description,
        image_url=image_url,
    )
    session.add(character)
    await session.commit()
    await session.refresh(character)
    return character


async def create_scene(
    session: AsyncSession,
    project_id: int,
    order: int = 1,
    description: str = "Test scene",
) -> Scene:
    scene = Scene(
        project_id=project_id,
        order=order,
        description=description,
    )
    session.add(scene)
    await session.commit()
    await session.refresh(scene)
    return scene


async def create_shot(
    session: AsyncSession,
    scene_id: int,
    order: int = 1,
    description: str = "Test shot",
    prompt: str = "Test prompt",
    image_url: str | None = "http://test.com/shot.png",
    video_url: str | None = "http://test.com/shot.mp4",
    duration: float = 5.0,
) -> Shot:
    shot = Shot(
        scene_id=scene_id,
        order=order,
        description=description,
        prompt=prompt,
        image_url=image_url,
        video_url=video_url,
        duration=duration,
    )
    session.add(shot)
    await session.commit()
    await session.refresh(shot)
    return shot


async def create_config_item(
    session: AsyncSession,
    key: str = "TEST_CONFIG_KEY",
    value: str = "test_value",
    is_sensitive: bool = False,
) -> ConfigItem:
    config = ConfigItem(
        key=key,
        value=value,
        is_sensitive=is_sensitive,
    )
    session.add(config)
    await session.commit()
    await session.refresh(config)
    return config
