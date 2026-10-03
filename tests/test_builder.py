from __future__ import annotations

import shutil
import time
from pathlib import Path

import pytest

from book_creator.builder.engine import BuildError, build_editions
from book_creator.jobs import get_job, start_build
from book_creator.packages import import_book
from book_creator.packages import zip_package
import io
import zipfile


def _zip_tree(root: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in root.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    return buffer.getvalue()


def _pandoc_available() -> bool:
    return shutil.which("pandoc") is not None


def test_default_build(tiny_package):
    if not _pandoc_available():
        pytest.skip("pandoc is required for the default builder")
    report = build_editions(tiny_package)
    dist = tiny_package / "dist"
    assert (dist / "Tiny_Test_Book.pdf").is_file()
    assert (dist / "Tiny_Test_Book.epub").is_file()
    assert (dist / "Tiny_Test_Book.md").is_file()
    assert report["pdf_pages"] >= 2
    assert "Tiny_Test_Book.pdf" in report["files"]


def test_override_job(data_dir, tiny_package):
    script_dir = tiny_package / "scripts"
    script_dir.mkdir()
    (script_dir / "build_book.py").write_text(
        "from pathlib import Path\n"
        "dist = Path('dist')\n"
        "dist.mkdir(exist_ok=True)\n"
        "(dist / 'override.txt').write_text('override-ok\\n')\n"
        "print('override built')\n",
        encoding="utf-8",
    )
    book = import_book(_zip_tree(tiny_package))
    job = start_build(book["id"])
    deadline = time.time() + 30
    while time.time() < deadline:
        job = get_job(job["id"])
        if job["status"] in {"succeeded", "failed"}:
            break
        time.sleep(0.05)
    assert job["status"] == "succeeded", job
    assert job["used_override"] == 1
    root = data_dir / "books" / book["id"]
    assert (root / "dist" / "override.txt").read_text(encoding="utf-8") == "override-ok\n"
    editions = zip_package(root, include_dist=True)
    with zipfile.ZipFile(io.BytesIO(editions)) as archive:
        assert "dist/override.txt" in archive.namelist()


def test_default_build_rejects_empty_manifest(tmp_path):
    (tmp_path / "metadata.yaml").write_text("title: X\n", encoding="utf-8")
    (tmp_path / "manuscript").mkdir()
    (tmp_path / "manuscript" / "Book.txt").write_text("\n", encoding="utf-8")
    with pytest.raises(BuildError):
        build_editions(tmp_path)
