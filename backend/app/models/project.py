from datetime import datetime, UTC
from typing import Optional, List

from sqlmodel import Field, Relationship, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Project(SQLModel, table=True):
    """项目"""

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    story: Optional[str] = None
    style: str = Field(default="anime")
    summary: Optional[str] = None   # 剧情摘要
    video_url: Optional[str] = None  # 最终拼接视频
    status: str = Field(default="draft")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    characters: List["Character"] = Relationship(
        back_populates="project",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    scenes: List["Scene"] = Relationship(
        back_populates="project",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class Character(SQLModel, table=True):
    """角色"""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    name: str
    description: Optional[str] = None
    image_url: Optional[str] = None

    project: Optional[Project] = Relationship(back_populates="characters")


class Scene(SQLModel, table=True):
    """场景"""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    order: int = Field(index=True)
    description: str

    project: Optional[Project] = Relationship(back_populates="scenes")
    shots: List["Shot"] = Relationship(
        back_populates="scene",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class Shot(SQLModel, table=True):
    """镜头"""

    id: Optional[int] = Field(default=None, primary_key=True)
    scene_id: int = Field(foreign_key="scene.id", index=True)
    order: int = Field(index=True)
    description: str
    prompt: Optional[str] = None
    image_prompt: Optional[str] = None  # 首帧图片生成 prompt
    image_url: Optional[str] = None      # 首帧图片
    video_url: Optional[str] = None     # 分镜视频
    duration: Optional[float] = None

    scene: Optional[Scene] = Relationship(back_populates="shots")
