"""Transform tests, covering the payload shapes observed in the live API."""

from app.limitless import pairing_id, to_pairing_row, to_row

TID = "69725552b1294bfab720364d"


def test_to_row_maps_organizer_id():
    row = to_row(
        {
            "game": "PTCG",
            "name": "Test Cup",
            "date": "2026-07-24T22:00:00.000Z",
            "format": "STANDARD",
            "id": TID,
            "players": 8,
            "organizerId": 2679,
        }
    )
    assert row["organizer_id"] == 2679
    assert "organizerId" not in row


def test_normal_match():
    row = to_pairing_row(
        TID,
        {"round": 1, "phase": 1, "table": 1, "winner": "digitallogik",
         "player1": "dublin0814", "player2": "digitallogik"},
    )
    assert row["winner"] == "digitallogik"
    assert row["result_code"] is None
    assert row["table_number"] == 1
    assert row["match"] is None


def test_bye_has_no_player2():
    row = to_pairing_row(
        TID,
        {"round": 3, "phase": 1, "table": 3, "winner": "dublin0814",
         "player1": "dublin0814"},
    )
    assert row["player2"] is None
    assert row["winner"] == "dublin0814"


def test_integer_winner_becomes_result_code():
    """The API returns -1 (unpaired / no result) and 0 in the `winner` field."""
    unpaired = to_pairing_row(
        TID, {"round": 1, "phase": 1, "table": None, "winner": -1, "player1": "shuri"}
    )
    assert unpaired["winner"] is None
    assert unpaired["result_code"] == -1
    assert unpaired["table_number"] is None

    drawn = to_pairing_row(
        TID,
        {"round": 5, "phase": 1, "table": 45, "winner": 0,
         "player1": "amcharles1", "player2": "frodohtx"},
    )
    assert drawn["winner"] is None
    assert drawn["result_code"] == 0


def test_top_cut_match_field_disambiguates():
    """Top-cut rows share (phase, round) and have no table; `match` separates them."""
    a = to_pairing_row(
        TID,
        {"phase": 3, "round": 12, "winner": "rhinno", "match": "T8-3",
         "player1": "rhinno", "player2": "volcanturtletcg"},
    )
    b = to_pairing_row(
        TID,
        {"phase": 3, "round": 12, "winner": "rhinno", "match": "T4-2",
         "player1": "rhinno", "player2": "enochdoto"},
    )
    assert a["id"] != b["id"]
    assert a["match"] == "T8-3"


def test_pairing_id_is_deterministic_and_tournament_scoped():
    pairing = {"round": 1, "phase": 1, "table": 1, "winner": "a",
               "player1": "a", "player2": "b"}
    assert pairing_id(TID, pairing) == pairing_id(TID, pairing)
    assert pairing_id(TID, pairing) != pairing_id("other", pairing)


def test_table_zero_is_not_confused_with_missing_table():
    """`table: 0` is a real value; `table: None` is not. They must not collide."""
    zero = pairing_id(TID, {"phase": 1, "round": 1, "table": 0, "player1": "a"})
    none = pairing_id(TID, {"phase": 1, "round": 1, "table": None, "player1": "a"})
    assert zero != none
