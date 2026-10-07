from __future__ import annotations

import sys
import traceback
from pathlib import Path
from threading import Thread
from uuid import uuid4

from book_creator.builder.engine import BuildError, build_editions
from book_creator.db import session, utcnow
from book_creator.packages import book_root, has_override, touch_book


def list_jobs(book_id: str) -> list[dict]:
    with session() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs WHERE book_id = ? ORDER BY created_at DESC",
            (book_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_job(job_id: str) -> dict | None:
    with session() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


def start_build(book_id: str, use_override: bool = False) -> dict:
    job_id = str(uuid4())
    now = utcnow()
    root = book_root(book_id)
    override = bool(use_override and has_override(root))
    with session() as conn:
        conn.execute(
            """INSERT INTO jobs (id, book_id, status, used_override, log, error, created_at)
               VALUES (?, ?, 'queued', ?, '', NULL, ?)""",
            (job_id, book_id, int(override), now),
        )
    thread = Thread(target=_run_job, args=(job_id, book_id, override), daemon=True)
    thread.start()
    return get_job(job_id) or {}


def _append_log(job_id: str, text: str) -> None:
    with session() as conn:
        conn.execute("UPDATE jobs SET log = log || ? WHERE id = ?", (text, job_id))


def _run_job(job_id: str, book_id: str, use_override: bool = False) -> None:
    root = book_root(book_id)
    with session() as conn:
        conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job_id,))
    try:
        if use_override and has_override(root):
            _append_log(job_id, "Using package override scripts/build_book.py\n")
            report_text = _run_override(root)
            _append_log(job_id, report_text + "\n")
        else:
            _append_log(job_id, "Using default studio builder\n")
            report = build_editions(root)
            _append_log(
                job_id,
                f"word_count={report.get('word_count')} pdf_pages={report.get('pdf_pages')}\n",
            )
        with session() as conn:
            conn.execute(
                "UPDATE jobs SET status = 'succeeded', finished_at = ?, error = NULL WHERE id = ?",
                (utcnow(), job_id),
            )
        touch_book(book_id)
    except Exception as exc:
        _append_log(job_id, traceback.format_exc())
        with session() as conn:
            conn.execute(
                "UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
                (utcnow(), str(exc), job_id),
            )


def _run_override(root: Path) -> str:
    import subprocess

    script = root / "scripts" / "build_book.py"
    try:
        completed = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(root),
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise BuildError("Python interpreter missing") from exc
    except subprocess.CalledProcessError as exc:
        raise BuildError(exc.stderr or exc.stdout or str(exc)) from exc
    return (completed.stdout or "") + (completed.stderr or "")
