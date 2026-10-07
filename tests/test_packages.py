from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from book_creator.packages import (
    PackageError,
    create_book,
    delete_file,
    import_book,
    list_chapters,
    list_files,
    read_book_txt,
    read_text_file,
    rename_chapter,
    write_book_txt,
    write_text_file,
    zip_package,
)


def _zip_tree(root: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in root.rglob("*"):
            if path.is_file():
                archive.write(path, f"wrapper/{path.relative_to(root).as_posix()}")
    return buffer.getvalue()


def test_create_empty_book(data_dir):
    book = create_book("Demo")
    root = data_dir / "books" / book["id"]
    assert (root / "metadata.yaml").is_file()
    assert read_book_txt(root) == ["Demo.md"]


def test_import_edit_export(data_dir, tiny_package):
    book = import_book(_zip_tree(tiny_package))
    root = data_dir / "books" / book["id"]
    assert book["title"] == "Tiny Test Book"
    assert read_book_txt(root) == ["00-copyright.md", "01-hello.md"]

    write_text_file(root, "manuscript/02-next.md", "# Next\n\nMore.\n", add_to_book=True)
    assert "02-next.md" in read_book_txt(root)
    write_book_txt(root, ["00-copyright.md", "02-next.md", "01-hello.md"])
    assert read_book_txt(root) == ["00-copyright.md", "02-next.md", "01-hello.md"]
    write_text_file(root, "manuscript/01-hello.md", "# Hello\n\nEdited.\n")
    assert "Edited" in read_text_file(root, "manuscript/01-hello.md")
    delete_file(root, "manuscript/02-next.md")
    assert "02-next.md" not in read_book_txt(root)
    assert not any(item["path"] == "manuscript/02-next.md" for item in list_files(root))

    payload = zip_package(root)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
    assert "metadata.yaml" in names
    assert "manuscript/Book.txt" in names
    assert "manuscript/01-hello.md" in names


def test_rename_chapter_keeps_filename_in_sync(data_dir):
    book = create_book("Demo")
    root = data_dir / "books" / book["id"]
    result = rename_chapter(root, "manuscript/Demo.md", "  Fresh start  ")
    assert result == {
        "title": "Fresh start",
        "name": "Fresh start.md",
        "path": "manuscript/Fresh start.md",
    }
    assert read_book_txt(root) == ["Fresh start.md"]
    assert read_text_file(root, "manuscript/Fresh start.md").startswith("# Fresh start\n")
    assert not (root / "manuscript" / "Demo.md").exists()
    assert list_chapters(root)[0]["title"] == "Fresh start"


def test_refuses_empty_overwrite_of_substantial_chapter(data_dir):
    book = create_book("Guard Book")
    root = data_dir / "books" / book["id"]
    body = "# Guard\n\n" + ("Keep this chapter safe. " * 20) + "\n"
    write_text_file(root, "manuscript/Guard Book.md", body)
    with pytest.raises(PackageError, match="Refusing to replace chapter content"):
        write_text_file(root, "manuscript/Guard Book.md", "")
    with pytest.raises(PackageError, match="Refusing to replace chapter content"):
        write_text_file(root, "manuscript/Guard Book.md", "# Guard\n\n")
    assert read_text_file(root, "manuscript/Guard Book.md") == body


def test_leave_checkpoint_keeps_timestamped_versions(data_dir):
    from book_creator.packages import (
        checkpoint_chapter_history,
        list_chapter_history,
        read_chapter_history,
    )

    book = create_book("Prior Book")
    root = data_dir / "books" / book["id"]
    path = "manuscript/Prior Book.md"
    first = "# Prior\n\nFirst version of the chapter with enough text.\n"
    second = "# Prior\n\nSecond version of the chapter with enough text.\n"
    third = "# Prior\n\nThird version of the chapter with enough text.\n"
    write_text_file(root, path, first)
    assert list_chapter_history(root, path) == []
    assert checkpoint_chapter_history(root, path) is not None
    write_text_file(root, path, second)
    assert checkpoint_chapter_history(root, path) is not None
    write_text_file(root, path, third)
    assert checkpoint_chapter_history(root, path) is not None
    assert checkpoint_chapter_history(root, path) is None
    revisions = list_chapter_history(root, path)
    assert len(revisions) == 3
    assert all(
        "saved_at" in item and "id" in item and "word_count" in item for item in revisions
    )
    assert all(item["word_count"] > 0 for item in revisions)
    assert read_text_file(root, path) == third
    first_id = next(
        rev["id"] for rev in revisions if read_chapter_history(root, path, rev["id"]) == first
    )
    # Reading a historic revision must not change Latest on disk.
    assert read_chapter_history(root, path, first_id) == first
    assert read_text_file(root, path) == third
    assert len(list_chapter_history(root, path)) == 3
    assert not any(item["path"].startswith(".history/") for item in list_files(root))
    payload = zip_package(root)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert not any(name.startswith(".history/") for name in archive.namelist())
