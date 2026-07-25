from pydantic import BaseModel, Field


class Deck(BaseModel):
    id: int
    name: str
    share: float = Field(ge=0.0, le=1.0, description="Meta share, 0-1")


class DeckCreate(BaseModel):
    name: str
    share: float = Field(ge=0.0, le=1.0)
