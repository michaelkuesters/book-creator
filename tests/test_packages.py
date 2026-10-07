from __future__ import annotations

import io
import zipfile
from datetime import datetime
from pathlib import Path

import pytest

from book_creator.packages import (
    PackageError,
    chapter_download_filename,
    chapter_title,
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


def test_numbered_heading_escapes_normalized(data_dir):
    book = create_book("Escape Book")
    root = data_dir / "books" / book["id"]
    path = "manuscript/Escape Book.md"
    body = "# 2\\. Prepare the Runway\n\nEnough body text to keep this chapter substantial.\n"
    (root / path).write_text(body, encoding="utf-8")
    assert chapter_title(root, "Escape Book.md") == "2. Prepare the Runway"
    assert list_chapters(root)[0]["title"] == "2. Prepare the Runway"
    write_text_file(root, path, body)
    saved = read_text_file(root, path)
    assert saved.startswith("# 2. Prepare the Runway\n")
    assert "2\\." not in saved


def test_chapter_download_filename_dots_and_stamp():
    when = datetime(2026, 10, 7, 21, 51)
    assert (
        chapter_download_filename("2. Prepare the Runway", when)
        == "2- Prepare the Runway-2026-10-07-2151.md"
    )
    assert (
        chapter_download_filename("2\\. Prepare the Runway", when)
        == "2- Prepare the Runway-2026-10-07-2151.md"
    )


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


def test_chapter_tags_create_list_read_delete(data_dir):
    from book_creator.packages import (
        TAGS_DIR,
        checkpoint_chapter_history,
        create_chapter_tag,
        delete_chapter_tag,
        list_chapter_history,
        list_chapter_tags,
        read_chapter_tag,
        squash_chapter_history,
    )

    book = create_book("Tag Book")
    root = data_dir / "books" / book["id"]
    path = "manuscript/Tag Book.md"
    first = "# Tag\n\nFirst tagged body with enough text.\n"
    second = "# Tag\n\nSecond tagged body with enough text.\n"
    write_text_file(root, path, first)
    with pytest.raises(PackageError):
        create_chapter_tag(root, path, "   ")
    tag = create_chapter_tag(root, path, "section 1 reworked")
    assert tag["label"] == "section 1 reworked"
    assert tag["word_count"] > 0
    assert "saved_at" in tag
    tags = list_chapter_tags(root, path)
    assert len(tags) == 1
    assert tags[0]["id"] == tag["id"]
    assert tags[0]["label"] == "section 1 reworked"
    assert read_chapter_tag(root, path, tag["id"]) == first
    assert read_text_file(root, path) == first

    write_text_file(root, path, second)
    assert checkpoint_chapter_history(root, path) is not None
    write_text_file(root, path, first)
    assert checkpoint_chapter_history(root, path) is not None
    assert len(list_chapter_history(root, path)) == 2
    create_chapter_tag(root, path, "after history")
    assert len(list_chapter_tags(root, path)) == 2

    squash_chapter_history(root, path, "all")
    assert len(list_chapter_history(root, path)) == 1
    assert len(list_chapter_tags(root, path)) == 2

    delete_chapter_tag(root, path, tag["id"])
    remaining = list_chapter_tags(root, path)
    assert len(remaining) == 1
    assert remaining[0]["label"] == "after history"
    assert read_text_file(root, path) == first
    assert len(list_chapter_history(root, path)) == 1
    assert not any(item["path"].startswith(f"{TAGS_DIR}/") for item in list_files(root))
    payload = zip_package(root)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert not any(name.startswith(f"{TAGS_DIR}/") for name in archive.namelist())
        assert not any(name.startswith(".history/") for name in archive.namelist())


def test_squash_chapter_history_keeps_newest_timestamp(data_dir):
    from book_creator.packages import (
        HISTORY_DIR,
        PackageError,
        chapter_history_squash_options,
        list_chapter_history,
        squash_chapter_history,
    )

    book = create_book("Squash Book")
    root = data_dir / "books" / book["id"]
    path = "manuscript/Squash Book.md"
    write_text_file(root, path, "# Squash\n\nBody text for the chapter.\n")
    hist = root / HISTORY_DIR / path
    hist.mkdir(parents=True, exist_ok=True)
    # Two on Monday, one later same week, one next week — fixed stamps so squash is deterministic.
    snapshots = [
        ("20260302T100000Z.md", "# Squash\n\nMorning Monday draft.\n"),
        ("20260302T180000Z.md", "# Squash\n\nEvening Monday draft.\n"),
        ("20260304T120000Z.md", "# Squash\n\nWednesday draft same week.\n"),
        ("20260310T090000Z.md", "# Squash\n\nNext week draft.\n"),
    ]
    for name, body in snapshots:
        (hist / name).write_text(body, encoding="utf-8")

    opts = chapter_history_squash_options(root, path)
    assert opts == {"same_days": True, "same_week": True, "all": True}

    day = squash_chapter_history(root, path, "same_days")
    assert day["removed"] == 1
    after_day = {item["id"]: item["saved_at"] for item in list_chapter_history(root, path)}
    assert "20260302T180000Z.md" in after_day
    assert "20260302T100000Z.md" not in after_day
    assert after_day["20260302T180000Z.md"] == "2026-03-02T18:00:00Z"
    assert set(after_day) == {
        "20260302T180000Z.md",
        "20260304T120000Z.md",
        "20260310T090000Z.md",
    }
    assert not chapter_history_squash_options(root, path)["same_days"]
    assert chapter_history_squash_options(root, path)["same_week"]

    week = squash_chapter_history(root, path, "same_week")
    assert week["removed"] == 1
    after_week = {item["id"] for item in list_chapter_history(root, path)}
    assert after_week == {"20260304T120000Z.md", "20260310T090000Z.md"}
    kept = next(item for item in list_chapter_history(root, path) if item["id"] == "20260304T120000Z.md")
    assert kept["saved_at"] == "2026-03-04T12:00:00Z"

    everything = squash_chapter_history(root, path, "all")
    assert everything["removed"] == 1
    remaining = list_chapter_history(root, path)
    assert len(remaining) == 1
    assert remaining[0]["id"] == "20260310T090000Z.md"
    assert remaining[0]["saved_at"] == "2026-03-10T09:00:00Z"
    assert chapter_history_squash_options(root, path) == {
        "same_days": False,
        "same_week": False,
        "all": False,
    }
    with pytest.raises(PackageError, match="Nothing to squash"):
        squash_chapter_history(root, path, "all")
