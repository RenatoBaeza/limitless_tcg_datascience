from fastapi import APIRouter, HTTPException

from app.models import Deck, DeckCreate

router = APIRouter(prefix="/decks", tags=["decks"])

# In-memory store; swap for a real database when needed.
_decks: dict[int, Deck] = {
    1: Deck(id=1, name="Charizard ex", share=0.14),
    2: Deck(id=2, name="Gardevoir ex", share=0.09),
}
_next_id = 3


@router.get("")
def list_decks() -> list[Deck]:
    return list(_decks.values())


@router.get("/{deck_id}")
def get_deck(deck_id: int) -> Deck:
    deck = _decks.get(deck_id)
    if deck is None:
        raise HTTPException(status_code=404, detail="Deck not found")
    return deck


@router.post("", status_code=201)
def create_deck(payload: DeckCreate) -> Deck:
    global _next_id
    deck = Deck(id=_next_id, **payload.model_dump())
    _decks[deck.id] = deck
    _next_id += 1
    return deck
