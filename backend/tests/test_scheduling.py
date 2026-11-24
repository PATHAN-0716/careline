from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest

from careline.identity import Confirmation, redact
from careline.store import Store, clinic_today

SECRET = b"only-used-in-tests"


@pytest.fixture
def store(tmp_path):
    result = Store(str(tmp_path / "demo.sqlite3"))
    result.initialize()
    result.start_session("test")
    return result


def identity(number="9876543210"):
    confirmation = Confirmation(SECRET)
    assert confirmation.process(number) == "readback"
    confirmation.readback_finished()
    assert confirmation.process("Yes, that's correct.") == "confirmed"
    return confirmation.confirmed


def tomorrow():
    return clinic_today() + timedelta(days=1)


def test_seed_and_availability(store):
    store.seed()
    assert len(store.doctors()) == 6
    slots = store.slots("Anika", day=tomorrow(), open_only=True)
    assert len(slots) == 3
    assert all(slot["doctor_id"] == "anika" for slot in slots)
    assert store.slots("unknown", day=tomorrow(), open_only=True) == []
    assert store.slots(day=tomorrow() + timedelta(days=40), open_only=True) == []


def test_booking_and_cancellation_restore_slot(store):
    slot = store.slots(day=tomorrow(), open_only=True)[0]
    caller = identity()
    booked, event = store.book("test", slot["id"], caller, "book")
    assert booked["status"] == "confirmed"
    assert booked["phone_tail"] == "3210"
    assert "caller_key" not in booked
    assert event["type"] == "booking_completed"
    assert slot["id"] not in {row["id"] for row in store.slots(day=tomorrow(), open_only=True)}
    cancelled, event = store.cancel("test", caller, booked["reference"], "cancel")
    assert cancelled["status"] == "cancelled"
    assert cancelled["cancelled_at"]
    assert event["type"] == "cancellation_completed"
    assert slot["id"] in {row["id"] for row in store.slots(day=tomorrow(), open_only=True)}
    assert store.appointments() == [cancelled]


def test_double_booking(store):
    slot = store.slots(day=tomorrow(), open_only=True)[0]
    caller = identity()
    barrier = Barrier(2)

    def attempt(action):
        barrier.wait()
        return store.book("test", slot["id"], caller, action)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(attempt, ["one", "two"]))
    assert sorted(result.get("status", result.get("error")) for result, _ in results) == ["confirmed", "slot_conflict"]
    assert [event["type"] for event in store.events(session="test")] == ["booking_completed"]


def test_multiple_matches_and_ownership(store):
    slots = store.slots(day=tomorrow(), open_only=True)
    caller = identity()
    for slot in slots[:2]:
        store.book("test", slot["id"], caller, slot["id"])
    result, event = store.cancel("test", caller, None, "choose")
    assert result["error"] == "select_appointment"
    assert len(result["appointments"]) == 2
    assert event is None
    reference = result["appointments"][0]["reference"]
    missing, event = store.cancel("test", identity("9876543211"), reference, "other")
    assert missing == {"error": "appointment_not_found"}
    assert event is None
    cancelled, _ = store.cancel("test", caller, reference, "mine")
    assert cancelled["reference"] == reference


def test_confirmation_requires_a_completed_readback():
    caller = Confirmation(SECRET)
    assert caller.process("yes") is None
    assert caller.process("12", collecting=True) == "retry"
    assert caller.process("nine eight seven six five four three two one zero") == "readback"
    assert caller.process("yes", collecting=True) == "repeat"
    assert caller.confirmed is None
    caller.readback_finished()
    assert caller.process("no, 9876543211") == "readback"
    assert caller.process("yes", collecting=True) == "repeat"
    caller.readback_finished()
    assert caller.process("yes") == "confirmed"
    assert caller.confirmed.tail == "3211"


@pytest.mark.parametrize("spoken", ["+91 98765 43210", "nine eight seven six five four three two one zero"])
def test_transcript_redaction(spoken):
    assert redact("My number is " + spoken) == "My number is •••• 3210"


@pytest.mark.parametrize(("name", "args"), [("book_appointment", {"slot_id": "test"}), ("cancel_appointment", {})])
def test_model_cannot_write_without_confirmation(store, name, args):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from careline.voice import Conversation

    call = Conversation(store, "test", SECRET)
    call.worker = SimpleNamespace(rtvi=SimpleNamespace(send_server_message=AsyncMock()))
    params = SimpleNamespace(function_name=name, tool_call_id="call", arguments=args, result_callback=AsyncMock())
    asyncio.run(call.tool(params))
    params.result_callback.assert_awaited_once_with({"error": "phone_required"})
    assert store.appointments() == []
