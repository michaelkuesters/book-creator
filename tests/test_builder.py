from __future__ import annotations

import base64
import io
import shutil
import time
import zipfile
from pathlib import Path

import pytest

from book_creator.builder.engine import BuildError, build_editions
from book_creator.jobs import get_job, start_build
from book_creator.packages import import_book
from book_creator.packages import zip_package

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


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


def test_default_build_clears_prior_dist_artifacts(tiny_package):
    if not _pandoc_available():
        pytest.skip("pandoc is required for the default builder")
    dist = tiny_package / "dist"
    dist.mkdir(exist_ok=True)
    stale_pdf = dist / "Old_Title.pdf"
    stale_epub = dist / "Old_Title.epub"
    stale_pdf.write_bytes(b"%PDF-1.4 stale")
    stale_epub.write_bytes(b"PK stale-epub")
    (dist / "junk.txt").write_text("leftover\n", encoding="utf-8")
    build_editions(tiny_package)
    names = {p.name for p in dist.iterdir() if p.is_file()}
    assert names == {
        "Tiny_Test_Book.md",
        "Tiny_Test_Book.pdf",
        "Tiny_Test_Book.epub",
        "build-report.json",
    }
    assert not stale_pdf.exists()
    assert not stale_epub.exists()


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
    job = start_build(book["id"], use_override=True)
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


def test_default_build_tolerates_html_br_raw_inline(tiny_package):
    if not _pandoc_available():
        pytest.skip("pandoc is required for the default builder")
    chapter = tiny_package / "manuscript" / "01-hello.md"
    chapter.write_text(
        chapter.read_text(encoding="utf-8").rstrip()
        + "\n\n<br>\n\nMore after the break.\n",
        encoding="utf-8",
    )
    report = build_editions(tiny_package)
    dist = tiny_package / "dist"
    assert (dist / "Tiny_Test_Book.pdf").is_file()
    assert (dist / "Tiny_Test_Book.epub").is_file()
    assert report["pdf_pages"] >= 2


def _pdf_image_xobject_count(pdf_path: Path) -> int:
    from pypdf import PdfReader

    count = 0
    reader = PdfReader(str(pdf_path))
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        xobjects = resources.get("/XObject") or {}
        for ref in xobjects.values():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Image":
                count += 1
    return count


def test_default_build_tolerates_cite_inline(tiny_package):
    if not _pandoc_available():
        pytest.skip("pandoc is required for the default builder")
    chapter = tiny_package / "manuscript" / "01-hello.md"
    chapter.write_text(
        "# Hello\n\nSee @smith2020 for background.\n\nAlso [@doe2019, p. 12].\n",
        encoding="utf-8",
    )
    report = build_editions(tiny_package)
    dist = tiny_package / "dist"
    assert (dist / "Tiny_Test_Book.pdf").is_file()
    assert (dist / "Tiny_Test_Book.epub").is_file()
    assert report["pdf_pages"] >= 2


def test_default_build_embeds_chapter_image(tiny_package):
    if not _pandoc_available():
        pytest.skip("pandoc is required for the default builder")

    resources = tiny_package / "manuscript" / "resources"
    (resources / "diagram.png").write_bytes(TINY_PNG)
    chapter = tiny_package / "manuscript" / "01-hello.md"

    # Cover alone embeds one image XObject; chapter illustration must add another.
    chapter.write_text("# Hello\n\nNo illustration yet.\n", encoding="utf-8")
    build_editions(tiny_package)
    cover_only = _pdf_image_xobject_count(tiny_package / "dist" / "Tiny_Test_Book.pdf")

    chapter.write_text(
        "# Hello\n\nIntro text.\n\n![diagram](resources/diagram.png)\n\nAfter the figure.\n",
        encoding="utf-8",
    )
    report = build_editions(tiny_package)
    dist = tiny_package / "dist"
    pdf_path = dist / "Tiny_Test_Book.pdf"
    assert pdf_path.is_file()
    assert (dist / "Tiny_Test_Book.epub").is_file()
    assert report["pdf_pages"] >= 2
    with_image = _pdf_image_xobject_count(pdf_path)
    assert with_image > cover_only, (cover_only, with_image)


def test_bundled_serif_italic_faces_exist():
    from book_creator.builder.engine import BUNDLED_FONTS

    assert (BUNDLED_FONTS / "DejaVuSerif-Italic.ttf").is_file()
    assert (BUNDLED_FONTS / "DejaVuSerif-BoldItalic.ttf").is_file()


def test_default_build_embeds_italic_font(tiny_package):
    if not _pandoc_available():
        pytest.skip("pandoc is required for the default builder")
    from pypdf import PdfReader

    chapter = tiny_package / "manuscript" / "01-hello.md"
    chapter.write_text(
        "# Hello\n\nThis has *italic emphasis* in the body.\n",
        encoding="utf-8",
    )
    build_editions(tiny_package)
    reader = PdfReader(str(tiny_package / "dist" / "Tiny_Test_Book.pdf"))
    base_fonts = set()
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        fonts = resources.get("/Font") or {}
        for font in fonts.values():
            base = font.get("/BaseFont")
            if base is not None:
                base_fonts.add(str(base))
    assert any("DejaVuSerif-Italic" in name for name in base_fonts), base_fonts
