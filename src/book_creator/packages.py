from __future__ import annotations

import io
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

from book_creator import config
from book_creator.builder.engine import BUNDLED_CSS
from book_creator.db import session, utcnow
from book_creator.slug import slugify

COVER_NAMES = ("cover.png", "cover.jpg", "cover.jpeg", "cover.webp")

PROTECTED = {"manuscript/Book.txt", "metadata.yaml"}
EDITABLE_SUFFIXES = config.EDITABLE_SUFFIXES
MAX_ZIP_BYTES = 200 * 1024 * 1024


class PackageError(ValueError):
    pass


def book_root(book_id: str) -> Path:
    return config.BOOKS_DIR / book_id


def resolve_inside(root: Path, relative: str) -> Path:
    relative = relative.replace("\\", "/").lstrip("/")
    if not relative or ".." in Path(relative).parts:
        raise PackageError("Invalid path")
    target = (root / relative).resolve()
    if root.resolve() not in target.parents and target != root.resolve():
        raise PackageError("Path escapes package")
    return target


def default_metadata(title: str = "Untitled book") -> dict:
    return {
        "title": title,
        "subtitle": "",
        "author": "",
        "lang": "en-GB",
        "rights": "",
        "date": "",
        "description": "",
    }


def write_metadata(root: Path, meta: dict) -> None:
    text = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True)
    (root / "metadata.yaml").write_text(text, encoding="utf-8")


def load_metadata(root: Path) -> dict:
    path = root / "metadata.yaml"
    if not path.is_file():
        return default_metadata()
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    merged = default_metadata()
    merged.update({k: ("" if v is None else v) for k, v in data.items()})
    return merged


def read_book_txt(root: Path) -> list[str]:
    path = root / "manuscript" / "Book.txt"
    if not path.is_file():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def chapter_title(root: Path, name: str) -> str:
    path = root / "manuscript" / name
    if not path.is_file():
        return Path(name).stem
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("# "):
                return stripped[2:].strip() or Path(name).stem
    except OSError:
        pass
    return Path(name).stem


def list_chapters(root: Path) -> list[dict]:
    chapters = []
    for name in read_book_txt(root):
        chapters.append(
            {
                "name": name,
                "path": f"manuscript/{name}",
                "title": chapter_title(root, name),
            }
        )
    return chapters


def find_cover(root: Path) -> Path | None:
    resources = root / "manuscript" / "resources"
    for name in COVER_NAMES:
        path = resources / name
        if path.is_file():
            return path
    return None


def has_cover(root: Path) -> bool:
    return find_cover(root) is not None


def friendly_when(value: str | None) -> str:
    if not value:
        return ""
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta = now - stamp.astimezone(timezone.utc)
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        minutes = seconds // 60
        return f"{minutes} min ago" if minutes > 1 else "1 min ago"
    if seconds < 86400:
        hours = seconds // 3600
        return f"{hours} hours ago" if hours > 1 else "1 hour ago"
    if seconds < 86400 * 7:
        days = seconds // 86400
        return f"{days} days ago" if days > 1 else "Yesterday"
    return stamp.astimezone(timezone.utc).strftime("%d %b %Y")


def list_library_books() -> list[dict]:
    books = []
    for row in list_books():
        root = book_root(row["id"])
        meta = load_metadata(root)
        books.append(
            {
                **row,
                "author": str(meta.get("author") or "").strip(),
                "subtitle": str(meta.get("subtitle") or "").strip(),
                "has_cover": has_cover(root),
                "updated_label": friendly_when(row.get("updated_at")),
                "chapter_count": len(read_book_txt(root)),
            }
        )
    return books


def write_book_txt(root: Path, names: list[str]) -> None:
    manuscript = root / "manuscript"
    for name in names:
        if "/" in name.replace("\\", "/") or name in {".", ".."}:
            raise PackageError("Chapter names must be files in manuscript/")
        if not (manuscript / name).is_file():
            raise PackageError(f"Missing chapter file: {name}")
    if len(set(names)) != len(names):
        raise PackageError("Duplicate chapter in Book.txt")
    (manuscript / "Book.txt").write_text("\n".join(names) + ("\n" if names else ""), encoding="utf-8")


def init_empty_package(root: Path, title: str = "Untitled book") -> None:
    manuscript = root / "manuscript"
    (manuscript / "resources").mkdir(parents=True)
    (root / "styles").mkdir(parents=True)
    write_metadata(root, default_metadata(title))
    chapter = "00-start.md"
    (manuscript / chapter).write_text(f"# {title}\n\nWrite the first chapter here.\n", encoding="utf-8")
    write_book_txt(root, [chapter])
    shutil.copy(BUNDLED_CSS, root / "styles" / "epub.css")


def list_files(root: Path) -> list[dict]:
    entries = []
    if not root.exists():
        return entries
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith("dist/"):
            continue
        entries.append(
            {
                "path": rel,
                "bytes": path.stat().st_size,
                "kind": _kind(rel, path),
            }
        )
    return entries


def _kind(rel: str, path: Path) -> str:
    if rel == "manuscript/Book.txt":
        return "manifest"
    if rel.startswith("manuscript/") and path.suffix.lower() == ".md":
        return "chapter"
    if rel.startswith("manuscript/resources/"):
        return "resource"
    if path.suffix.lower() in EDITABLE_SUFFIXES:
        return "text"
    return "binary"


def list_editions(root: Path) -> list[dict]:
    dist = root / "dist"
    if not dist.is_dir():
        return []
    editions = []
    for path in sorted(dist.iterdir()):
        if path.is_file() and path.suffix.lower() in {".pdf", ".epub", ".md", ".json"}:
            editions.append({"name": path.name, "bytes": path.stat().st_size})
    return editions


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def list_assets(root: Path) -> list[dict]:
    resources = root / "manuscript" / "resources"
    if not resources.is_dir():
        return []
    assets = []
    for path in sorted(resources.iterdir()):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        assets.append(
            {
                "name": path.name,
                "path": f"manuscript/resources/{path.name}",
                "markdown": f"resources/{path.name}",
                "bytes": path.stat().st_size,
                "kind": "image" if suffix in IMAGE_SUFFIXES else "file",
                "is_cover": path.name.lower() in COVER_NAMES,
            }
        )
    return assets


def has_override(root: Path) -> bool:
    return (root / "scripts" / "build_book.py").is_file()


def read_text_file(root: Path, relative: str) -> str:
    path = resolve_inside(root, relative)
    if not path.is_file():
        raise PackageError("File not found")
    if path.suffix.lower() not in EDITABLE_SUFFIXES:
        raise PackageError("Not a text file")
    return path.read_text(encoding="utf-8")


def write_text_file(root: Path, relative: str, content: str, add_to_book: bool = False) -> None:
    path = resolve_inside(root, relative)
    if path.suffix.lower() not in EDITABLE_SUFFIXES:
        raise PackageError("Not a text file")
    path.parent.mkdir(parents=True, exist_ok=True)
    created = not path.exists()
    path.write_text(content.replace("\r\n", "\n"), encoding="utf-8")
    rel = path.relative_to(root).as_posix()
    if add_to_book or (created and rel.startswith("manuscript/") and path.suffix.lower() == ".md"):
        name = path.name
        order = read_book_txt(root)
        if name not in order:
            order.append(name)
            write_book_txt(root, order)


def write_binary_file(root: Path, relative: str, data: bytes) -> None:
    path = resolve_inside(root, relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def delete_file(root: Path, relative: str) -> None:
    rel = relative.replace("\\", "/").lstrip("/")
    if rel in PROTECTED:
        raise PackageError("This file cannot be deleted")
    path = resolve_inside(root, relative)
    if not path.is_file():
        raise PackageError("File not found")
    name = path.name
    path.unlink()
    if rel.startswith("manuscript/") and path.suffix.lower() == ".md":
        order = [item for item in read_book_txt(root) if item != name]
        write_book_txt(root, order)


def zip_package(root: Path, include_dist: bool = False) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            if not include_dist and rel.startswith("dist/"):
                continue
            archive.write(path, rel)
    return buffer.getvalue()


def _common_prefix(names: list[str]) -> str | None:
    cleaned = [name.replace("\\", "/") for name in names if name and not name.endswith("/")]
    if not cleaned:
        return None
    first = cleaned[0]
    if "/" not in first:
        return None
    prefix = first.split("/", 1)[0] + "/"
    if all(name.startswith(prefix) for name in cleaned):
        return prefix
    return None


def extract_zip(data: bytes, dest: Path) -> None:
    if len(data) > MAX_ZIP_BYTES:
        raise PackageError("Zip is too large")
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        prefix = _common_prefix(names)
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if prefix and name.startswith(prefix):
                name = name[len(prefix) :]
            if not name or name.endswith("/"):
                continue
            target = resolve_inside(dest, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source:
                target.write_bytes(source.read())
    if not (dest / "metadata.yaml").is_file() or not (dest / "manuscript").is_dir():
        raise PackageError("Zip is not a book package (need metadata.yaml and manuscript/)")
    if not (dest / "manuscript" / "Book.txt").is_file():
        markdown = sorted(p.name for p in (dest / "manuscript").glob("*.md"))
        write_book_txt(dest, markdown)


def create_book(title: str = "Untitled book") -> dict:
    from uuid import uuid4

    book_id = str(uuid4())
    root = book_root(book_id)
    init_empty_package(root, title)
    now = utcnow()
    slug = slugify(title)
    with session() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (book_id, slug, title, now, now),
        )
    return {"id": book_id, "slug": slug, "title": title}


def import_book(data: bytes) -> dict:
    from uuid import uuid4

    book_id = str(uuid4())
    root = book_root(book_id)
    try:
        extract_zip(data, root)
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    meta = load_metadata(root)
    title = str(meta.get("title") or "Untitled book")
    slug = slugify(title)
    now = utcnow()
    with session() as conn:
        conn.execute(
            "INSERT INTO books (id, slug, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (book_id, slug, title, now, now),
        )
    return {"id": book_id, "slug": slug, "title": title}


def touch_book(book_id: str, title: str | None = None) -> None:
    now = utcnow()
    with session() as conn:
        if title is not None:
            conn.execute(
                "UPDATE books SET title = ?, slug = ?, updated_at = ? WHERE id = ?",
                (title, slugify(title), now, book_id),
            )
        else:
            conn.execute("UPDATE books SET updated_at = ? WHERE id = ?", (now, book_id))


def get_book_row(book_id: str) -> dict | None:
    with session() as conn:
        row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    return dict(row) if row else None


def list_books() -> list[dict]:
    with session() as conn:
        rows = conn.execute("SELECT * FROM books ORDER BY updated_at DESC").fetchall()
    return [dict(row) for row in rows]


def delete_book(book_id: str) -> None:
    root = book_root(book_id)
    shutil.rmtree(root, ignore_errors=True)
    with session() as conn:
        conn.execute("DELETE FROM jobs WHERE book_id = ?", (book_id,))
        conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
