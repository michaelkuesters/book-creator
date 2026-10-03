from __future__ import annotations

import base64
import shutil
from pathlib import Path

import pytest

from book_creator import config
from book_creator.db import init_db

FIXTURE = Path(__file__).parent / "fixtures" / "tiny-book"
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "BOOKS_DIR", tmp_path / "books")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "studio.sqlite3")
    config.ensure_data_dirs()
    init_db()
    return tmp_path


@pytest.fixture
def tiny_package(tmp_path) -> Path:
    dest = tmp_path / "tiny-book"
    shutil.copytree(FIXTURE, dest)
    resources = dest / "manuscript" / "resources"
    resources.mkdir(parents=True, exist_ok=True)
    (resources / "cover.png").write_bytes(TINY_PNG)
    return dest
