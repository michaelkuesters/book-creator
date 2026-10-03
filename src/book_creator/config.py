from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", Path.cwd() / "data")).resolve()
BOOKS_DIR = DATA_DIR / "books"
DB_PATH = DATA_DIR / "studio.sqlite3"

PACKAGE_ROOT_NAMES = {
    "metadata.yaml",
    "manuscript",
    "styles",
    "fonts",
    "scripts",
    "examples",
    "Sample.txt",
    "README.md",
    "OUTLINE.md",
    "VALIDATION.md",
    "requirements-book.txt",
}

EDITABLE_SUFFIXES = {".md", ".txt", ".yaml", ".yml", ".css", ".json"}
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ttf", ".otf", ".pdf", ".epub"}


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
