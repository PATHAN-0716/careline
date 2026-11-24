import asyncio
import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

CLINIC_ZONE = ZoneInfo("Asia/Kolkata")
DOCTORS = [
    ("anika", "Dr. Anika Rao", "General Medicine"),
    ("rohan", "Dr. Rohan Mehta", "Cardiology"),
    ("maya", "Dr. Maya Kapoor", "Dermatology"),
    ("neel", "Dr. Neel Shah", "Pediatrics"),
    ("tara", "Dr. Tara Iyer", "Orthopedics"),
    ("kabir", "Dr. Kabir Sen", "ENT"),
]
SCHEMA = """
CREATE TABLE IF NOT EXISTS doctors(id TEXT PRIMARY KEY, name TEXT, specialty TEXT);
CREATE TABLE IF NOT EXISTS slots(id TEXT PRIMARY KEY, doctor_id TEXT REFERENCES doctors, starts_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appointments(
    reference TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots, caller_key TEXT NOT NULL,
    phone_tail TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled')),
    created_at TEXT NOT NULL, cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS active_slot ON appointments(slot_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS appointment_caller ON appointments(caller_key, status);
CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, connected_at TEXT, ended_at TEXT,
    outcome TEXT NOT NULL, phone_tail TEXT
);
CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions,
    type TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL, dashboard INTEGER NOT NULL
);
"""
APPOINTMENTS = """
SELECT a.reference, a.status, a.created_at, a.cancelled_at, a.phone_tail,
       s.id AS slot_id, s.starts_at, d.id AS doctor_id, d.name AS doctor, d.specialty
FROM appointments a JOIN slots s ON s.id=a.slot_id JOIN doctors d ON d.id=s.doctor_id
"""
SLOTS = """
SELECT s.id, s.doctor_id, s.starts_at, d.name AS doctor, d.specialty,
       a.reference, a.reference IS NULL AS available
FROM slots s JOIN doctors d ON d.id=s.doctor_id
LEFT JOIN appointments a ON a.slot_id=s.id AND a.status='confirmed'
"""


def now():
    return datetime.now(UTC).isoformat()


def clinic_today():
    return datetime.now(CLINIC_ZONE).date()


class Store:
    def __init__(self, path):
        self.path = path
        self.dashboard_change = asyncio.Event()

    def notify_dashboard(self):
        previous = self.dashboard_change
        self.dashboard_change = asyncio.Event()
        previous.set()

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def initialize(self):
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
        self.seed()

    def seed(self):
        today = clinic_today()
        with self.connection() as db:
            db.executemany("INSERT OR IGNORE INTO doctors VALUES (?,?,?)", DOCTORS)
            rows = []
            for offset in range(14):
                day = today + timedelta(days=offset)
                for index, (doctor_id, _, _) in enumerate(DOCTORS):
                    for hour, minute in [(9 + index % 3, 0), (11 + index % 2, 30), (15 + index % 2, 0)]:
                        start = datetime.combine(day, time(hour, minute), CLINIC_ZONE)
                        rows.append((f"{doctor_id}-{day}-{hour:02}{minute:02}", doctor_id, start.astimezone(UTC).isoformat()))
            db.executemany("INSERT OR IGNORE INTO slots VALUES (?,?,?)", rows)

    def doctors(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute("SELECT * FROM doctors ORDER BY rowid")]

    def slots(self, doctor=None, specialty=None, day=None, open_only=False):
        start = datetime.combine(day or clinic_today(), time.min, CLINIC_ZONE)
        end = start + timedelta(days=1 if day else 14)
        with self.connection() as db:
            rows = db.execute(
                SLOTS + """ WHERE s.starts_at>=? AND s.starts_at<?
                AND (? IS NULL OR d.id=? OR lower(d.name) LIKE lower(?))
                AND (? IS NULL OR lower(d.specialty) LIKE lower(?))
                AND (NOT ? OR (a.reference IS NULL AND s.starts_at>?)) ORDER BY s.starts_at, d.name""",
                (start.astimezone(UTC).isoformat(), end.astimezone(UTC).isoformat(), doctor, doctor,
                 f"%{doctor}%", specialty, f"%{specialty}%", open_only, now()),
            )
            return [dict(row) for row in rows]

    def appointments(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute(APPOINTMENTS + " ORDER BY a.created_at DESC")]

    def record(self, db, session, kind, payload, dashboard=False):
        stamp = now()
        row = db.execute(
            "INSERT INTO events(session_id,type,timestamp,payload,dashboard) VALUES (?,?,?,?,?)",
            (session, kind, stamp, json.dumps(payload), dashboard),
        )
        return {"id": row.lastrowid, "type": kind, "sessionId": session, "timestamp": stamp, "payload": payload}

    def event(self, session, kind, payload, dashboard=False):
        with self.connection() as db:
            return self.record(db, session, kind, payload, dashboard)

    def book(self, session, slot_id, identity, action_id):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            slot = db.execute("SELECT starts_at FROM slots WHERE id=?", (slot_id,)).fetchone()
            if not slot or slot["starts_at"] <= now():
                return {"error": "slot_unavailable"}, None
            reference = "CL-" + uuid4().hex[:10].upper()
            try:
                db.execute(
                    "INSERT INTO appointments VALUES (?,?,?,?,?,?,NULL)",
                    (reference, slot_id, identity.key, identity.tail, "confirmed", now()),
                )
            except sqlite3.IntegrityError:
                return {"error": "slot_conflict"}, None
            appointment = dict(db.execute(APPOINTMENTS + " WHERE a.reference=?", (reference,)).fetchone())
            return appointment, self.record(db, session, "booking_completed", {"actionId": action_id, **appointment}, True)

    def cancel(self, session, identity, reference, action_id):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            matches = [dict(row) for row in db.execute(
                APPOINTMENTS + " WHERE a.caller_key=? AND a.status='confirmed' AND s.starts_at>? ORDER BY s.starts_at",
                (identity.key, now()),
            )]
            if reference:
                matches = [row for row in matches if row["reference"] == reference.upper()]
            if not matches:
                return {"error": "appointment_not_found"}, None
            if len(matches) > 1:
                return {"error": "select_appointment", "appointments": matches}, None
            appointment = matches[0]
            appointment.update(status="cancelled", cancelled_at=now())
            db.execute("UPDATE appointments SET status='cancelled',cancelled_at=? WHERE reference=?",
                       (appointment["cancelled_at"], appointment["reference"]))
            return appointment, self.record(db, session, "cancellation_completed", {"actionId": action_id, **appointment}, True)

    def start_session(self, session):
        with self.connection() as db:
            db.execute("INSERT INTO sessions(id,started_at,outcome) VALUES (?,?,'connecting')", (session, now()))

    def transition(self, session, outcome):
        with self.connection() as db:
            stamp = now()
            if outcome == "connected":
                db.execute("UPDATE sessions SET connected_at=?,outcome=? WHERE id=?", (stamp, outcome, session))
                return self.record(db, session, "call_connected", {}, True)
            row = db.execute("SELECT ended_at FROM sessions WHERE id=?", (session,)).fetchone()
            if row and not row["ended_at"]:
                db.execute("UPDATE sessions SET ended_at=?,outcome=? WHERE id=?", (stamp, outcome, session))
                return self.record(db, session, "call_ended", {"outcome": outcome}, True)
            return None

    def confirm_session(self, session, tail):
        with self.connection() as db:
            db.execute("UPDATE sessions SET phone_tail=? WHERE id=?", (tail, session))

    def sessions(self):
        with self.connection() as db:
            return [dict(row) for row in db.execute("""
                SELECT s.*, (SELECT count(*) FROM events e WHERE e.session_id=s.id
                    AND e.type IN ('availability_check_completed','booking_completed','cancellation_completed'))
                    AS action_count
                FROM sessions s ORDER BY started_at DESC LIMIT 100
            """)]

    def events(self, *, session=None, after=0, recent=False):
        with self.connection() as db:
            if session:
                rows = db.execute("SELECT * FROM events WHERE session_id=? ORDER BY id", (session,))
            elif recent:
                rows = db.execute("SELECT * FROM events WHERE dashboard=1 ORDER BY id DESC LIMIT 30")
            else:
                rows = db.execute("SELECT * FROM events WHERE dashboard=1 AND id>? ORDER BY id LIMIT 100", (after,))
            return [{"id": r["id"], "sessionId": r["session_id"], "type": r["type"],
                     "timestamp": r["timestamp"], "payload": json.loads(r["payload"])} for r in rows]
