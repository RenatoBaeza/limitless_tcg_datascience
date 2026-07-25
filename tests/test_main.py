from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_decks():
    response = client.get("/decks")
    assert response.status_code == 200
    assert len(response.json()) >= 2


def test_get_deck_not_found():
    assert client.get("/decks/9999").status_code == 404


def test_create_deck():
    response = client.post("/decks", json={"name": "Raging Bolt", "share": 0.05})
    assert response.status_code == 201
    deck = response.json()
    assert deck["name"] == "Raging Bolt"
    assert client.get(f"/decks/{deck['id']}").status_code == 200
