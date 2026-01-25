from datetime import datetime, UTC

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ConfigItem(SQLModel, table=True):
    """Environment configuration stored in the database."""

    key: str = Field(primary_key=True, max_length=255)
    value: str = Field(default="", sa_column=Column(Text, nullable=False))
    description: str | None = None
    is_sensitive: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
