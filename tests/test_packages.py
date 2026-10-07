from __future__ import annotations

import io
import zipfile
from pathlib import Path

from book_creator.packages import (
    create_book,
    delete_file,
    import_book,
    list_chapters,
    list_files,
    read_book_txt,
    read_text_file,
    set_chapter_title,
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
    assert read_book_txt(root) == ["00-start.md"]


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


def test_set_chapter_title(data_dir):
    book = create_book("Demo")
    root = data_dir / "books" / book["id"]
    cleaned = set_chapter_title(root, "manuscript/00-start.md", "  Fresh start  ")
    assert cleaned == "Fresh start"
    assert read_text_file(root, "manuscript/00-start.md").startswith("# Fresh start\n")
    assert list_chapters(root)[0]["title"] == "Fresh start"
