from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from book_creator import config
from book_creator.config import ensure_data_dirs

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    status TEXT NOT NULL,
    used_override INTEGER NOT NULL DEFAULT 0,
    log TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    ensure_data_dirs()
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        conn.commit()


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
