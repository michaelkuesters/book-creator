from __future__ import annotations

import io
import json
import re
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
HISTORY_DIR = ".history"
TAGS_DIR = ".tags"
SQUASH_MODES = frozenset({"same_days", "same_week", "all"})
# Refuse saving blank / heading-only text over a chapter that already has real content
# (guards undo-to-blank + autosave from wiping the manuscript).
_WIPE_MIN_EXISTING = 80
_TAG_LABEL_MAX = 120
_WORD_RE = re.compile(r"\b[\w'-]+\b")


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


def chapter_filename(title: str) -> str:
    cleaned = " ".join(str(title).split()).strip()
    cleaned = cleaned.replace("\0", "").replace("/", "-").replace("\\", "-")
    cleaned = cleaned.strip(". ") or "chapter"
    name = Path(cleaned).name
    if name.lower() in {"book.txt", "metadata.yaml"}:
        name = "chapter"
    if not name.lower().endswith(".md"):
        name += ".md"
    return name


def unique_manuscript_name(root: Path, desired: str, *, exclude: str | None = None) -> str:
    manuscript = root / "manuscript"
    name = Path(desired).name
    if name == exclude or not (manuscript / name).is_file():
        return name
    stem = Path(name).stem
    suffix = Path(name).suffix or ".md"
    n = 2
    while True:
        candidate = f"{stem}-{n}{suffix}"
        if candidate == exclude or not (manuscript / candidate).is_file():
            return candidate
        n += 1


def _with_heading(text: str, title: str) -> str:
    body = text.replace("\r\n", "\n")
    lines = body.splitlines()
    heading = f"# {title}"
    if lines and lines[0].strip().startswith("#"):
        lines[0] = heading
        body = "\n".join(lines)
    else:
        body = heading + ("\n\n" + body.lstrip("\n") if body.strip() else "\n")
    if not body.endswith("\n"):
        body += "\n"
    return body


def rename_chapter(root: Path, relative: str, title: str) -> dict:
    """Update heading title and keep the manuscript filename in sync."""
    rel = relative.replace("\\", "/").lstrip("/")
    if not rel.startswith("manuscript/") or not rel.endswith(".md"):
        raise PackageError("Only manuscript chapters can be renamed")
    if rel in PROTECTED:
        raise PackageError("This file cannot be renamed")
    cleaned = " ".join(str(title).split()).strip()
    if not cleaned:
        raise PackageError("Chapter title is required")
    path = resolve_inside(root, rel)
    if not path.is_file():
        raise PackageError("File not found")
    old_name = path.name
    new_name = unique_manuscript_name(root, chapter_filename(cleaned), exclude=old_name)
    content = _with_heading(path.read_text(encoding="utf-8"), cleaned)
    if new_name == old_name:
        path.write_text(content, encoding="utf-8")
    else:
        dest = path.with_name(new_name)
        if dest.exists():
            raise PackageError(f"Chapter file already exists: {new_name}")
        path.write_text(content, encoding="utf-8")
        path.rename(dest)
        path = dest
        order = [new_name if item == old_name else item for item in read_book_txt(root)]
        write_book_txt(root, order)
    new_path = path.relative_to(root).as_posix()
    if new_path != rel:
        _move_chapter_history(root, rel, new_path)
        _move_chapter_tags(root, rel, new_path)
    return {"title": cleaned, "name": new_name, "path": new_path}


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
    chapter = chapter_filename(title)
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
        if (
            rel.startswith("dist/")
            or rel.startswith(f"{HISTORY_DIR}/")
            or rel.startswith(f"{TAGS_DIR}/")
        ):
            continue
        entries.append(
            {
                "path": rel,
                "bytes": path.stat().st_size,
                "kind": _kind(rel, path),
            }
        )
    return entries


def _is_manuscript_chapter(rel: str) -> bool:
    return (
        rel.startswith("manuscript/")
        and rel.endswith(".md")
        and "/resources/" not in rel
        and not rel.startswith("manuscript/.")
    )


def _would_wipe_chapter(existing: str, incoming: str) -> bool:
    old = existing.replace("\r\n", "\n").strip()
    new = incoming.replace("\r\n", "\n").strip()
    if len(old) < _WIPE_MIN_EXISTING:
        return False
    if not new:
        return True
    lines = [line.strip() for line in new.splitlines() if line.strip()]
    # A sole Markdown heading counts as wiped body (common after undo-to-start).
    return len(lines) == 1 and lines[0].startswith("#")


def _history_chapter_dir(root: Path, rel: str) -> Path:
    """Directory holding timestamped snapshots for one chapter path."""
    return resolve_inside(root, f"{HISTORY_DIR}/{rel}")


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text))


def _write_history_snapshot(root: Path, rel: str, content: str) -> str:
    """Write a timestamped minor-version snapshot; return revision id (filename)."""
    hist_dir = _history_chapter_dir(root, rel)
    hist_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    revision = f"{stamp}.md"
    target = hist_dir / revision
    suffix = 1
    while target.exists():
        revision = f"{stamp}-{suffix}.md"
        target = hist_dir / revision
        suffix += 1
    target.write_text(content.replace("\r\n", "\n"), encoding="utf-8")
    return revision


def _revision_saved_at(stem: str) -> str:
    base = stem
    if "-" in stem:
        head, tail = stem.rsplit("-", 1)
        if tail.isdigit():
            base = head
    if len(base) == 16 and base[8] == "T" and base.endswith("Z"):
        return (
            f"{base[0:4]}-{base[4:6]}-{base[6:8]}T"
            f"{base[9:11]}:{base[11:13]}:{base[13:15]}Z"
        )
    return stem


def _revision_sort_key(name: str) -> tuple[str, int]:
    stem = Path(name).stem
    base = stem
    seq = 0
    if "-" in stem:
        head, tail = stem.rsplit("-", 1)
        if tail.isdigit():
            base = head
            seq = int(tail)
    return (base, seq)


def _revision_meta(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    return {
        "id": path.name,
        "saved_at": _revision_saved_at(path.stem),
        "word_count": _word_count(text),
    }


def checkpoint_chapter_history(root: Path, relative: str) -> dict | None:
    """Create a leave-time minor version when content differs from the newest version."""
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have history")
    path = resolve_inside(root, rel)
    if not path.is_file():
        raise PackageError("File not found")
    normalized = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    hist_dir = root / HISTORY_DIR / rel
    if hist_dir.is_dir():
        versions = sorted(
            hist_dir.glob("*.md"), key=lambda p: _revision_sort_key(p.name), reverse=True
        )
        if versions and versions[0].read_text(encoding="utf-8") == normalized:
            return None
    revision_id = _write_history_snapshot(root, rel, normalized)
    return {
        "id": revision_id,
        "saved_at": _revision_saved_at(Path(revision_id).stem),
        "word_count": _word_count(normalized),
    }


def list_chapter_history(root: Path, relative: str) -> list[dict]:
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have history")
    hist_dir = root / HISTORY_DIR / rel
    if not hist_dir.is_dir():
        return []
    paths = sorted(hist_dir.glob("*.md"), key=lambda p: _revision_sort_key(p.name), reverse=True)
    return [_revision_meta(path) for path in paths]


def _revision_datetime(stem: str) -> datetime | None:
    base = stem
    if "-" in stem:
        head, tail = stem.rsplit("-", 1)
        if tail.isdigit():
            base = head
    if len(base) != 16 or base[8] != "T" or not base.endswith("Z"):
        return None
    try:
        return datetime.strptime(base, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _history_revision_paths(root: Path, relative: str) -> list[Path]:
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have history")
    hist_dir = root / HISTORY_DIR / rel
    if not hist_dir.is_dir():
        return []
    return sorted(hist_dir.glob("*.md"), key=lambda p: _revision_sort_key(p.name), reverse=True)


def _squash_group_key(path: Path, mode: str) -> str:
    if mode == "all":
        return "all"
    dt = _revision_datetime(path.stem)
    if dt is None:
        return f"unknown:{path.name}"
    if mode == "same_days":
        return dt.strftime("%Y-%m-%d")
    if mode == "same_week":
        iso = dt.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    raise PackageError("Invalid squash mode")


def chapter_history_squash_options(root: Path, relative: str) -> dict[str, bool]:
    paths = _history_revision_paths(root, relative)
    options = {"same_days": False, "same_week": False, "all": len(paths) >= 2}
    if len(paths) < 2:
        return options
    for mode in ("same_days", "same_week"):
        groups: dict[str, int] = {}
        for path in paths:
            key = _squash_group_key(path, mode)
            groups[key] = groups.get(key, 0) + 1
        options[mode] = any(count >= 2 for count in groups.values())
    return options


def squash_chapter_history(root: Path, relative: str, mode: str) -> dict:
    """Collapse history by scope; keep newest in each group with its original timestamp."""
    if mode not in SQUASH_MODES:
        raise PackageError("Invalid squash mode")
    paths = _history_revision_paths(root, relative)
    options = chapter_history_squash_options(root, relative)
    if not options.get(mode):
        raise PackageError("Nothing to squash for that scope")
    groups: dict[str, list[Path]] = {}
    for path in paths:
        groups.setdefault(_squash_group_key(path, mode), []).append(path)
    removed = 0
    for group in groups.values():
        # Newest first (paths already newest-first overall; group preserves that order).
        for doomed in group[1:]:
            doomed.unlink(missing_ok=True)
            removed += 1
    remaining = list_chapter_history(root, relative)
    return {
        "mode": mode,
        "removed": removed,
        "revisions": remaining,
        "squash": chapter_history_squash_options(root, relative),
    }


def read_chapter_history(root: Path, relative: str, revision_id: str) -> str:
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have history")
    if "/" in revision_id or "\\" in revision_id or revision_id in {".", ".."}:
        raise PackageError("Invalid revision")
    path = resolve_inside(root, f"{HISTORY_DIR}/{rel}/{revision_id}")
    if not path.is_file():
        raise PackageError("Revision not found")
    return path.read_text(encoding="utf-8")


def restore_chapter_history(root: Path, relative: str, revision_id: str) -> str:
    content = read_chapter_history(root, relative, revision_id)
    checkpoint_chapter_history(root, relative)
    write_text_file(root, relative, content)
    return content


def _move_chapter_sidecar(root: Path, kind: str, old_rel: str, new_rel: str) -> None:
    old_dir = root / kind / old_rel
    if not old_dir.is_dir() or old_rel == new_rel:
        return
    new_dir = root / kind / new_rel
    new_dir.parent.mkdir(parents=True, exist_ok=True)
    if new_dir.exists():
        for item in old_dir.iterdir():
            if not item.is_file():
                continue
            dest = new_dir / item.name
            if dest.exists():
                dest = new_dir / f"{item.stem}-moved{item.suffix}"
            item.rename(dest)
        shutil.rmtree(old_dir, ignore_errors=True)
    else:
        old_dir.rename(new_dir)


def _move_chapter_history(root: Path, old_rel: str, new_rel: str) -> None:
    _move_chapter_sidecar(root, HISTORY_DIR, old_rel, new_rel)


def _tags_chapter_dir(root: Path, rel: str) -> Path:
    return resolve_inside(root, f"{TAGS_DIR}/{rel}")


def _normalize_tag_label(label: str) -> str:
    cleaned = " ".join((label or "").split())
    if not cleaned:
        raise PackageError("Tag label is required")
    if len(cleaned) > _TAG_LABEL_MAX:
        raise PackageError(f"Tag label must be {_TAG_LABEL_MAX} characters or fewer")
    return cleaned


def _tag_meta_path(content_path: Path) -> Path:
    return content_path.with_suffix(".json")


def _read_tag_label(content_path: Path) -> str:
    meta = _tag_meta_path(content_path)
    if not meta.is_file():
        return content_path.stem
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return content_path.stem
    label = data.get("label") if isinstance(data, dict) else None
    if isinstance(label, str) and label.strip():
        return label.strip()
    return content_path.stem


def _tag_meta(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    return {
        "id": path.name,
        "label": _read_tag_label(path),
        "saved_at": _revision_saved_at(path.stem),
        "word_count": _word_count(text),
    }


def create_chapter_tag(root: Path, relative: str, label: str) -> dict:
    """Snapshot on-disk chapter content as an operator-named tag."""
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have tags")
    cleaned = _normalize_tag_label(label)
    path = resolve_inside(root, rel)
    if not path.is_file():
        raise PackageError("File not found")
    normalized = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    tags_dir = _tags_chapter_dir(root, rel)
    tags_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    tag_id = f"{stamp}.md"
    target = tags_dir / tag_id
    suffix = 1
    while target.exists():
        tag_id = f"{stamp}-{suffix}.md"
        target = tags_dir / tag_id
        suffix += 1
    target.write_text(normalized, encoding="utf-8")
    _tag_meta_path(target).write_text(
        json.dumps({"label": cleaned}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return {
        "id": tag_id,
        "label": cleaned,
        "saved_at": _revision_saved_at(Path(tag_id).stem),
        "word_count": _word_count(normalized),
    }


def list_chapter_tags(root: Path, relative: str) -> list[dict]:
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have tags")
    tags_dir = root / TAGS_DIR / rel
    if not tags_dir.is_dir():
        return []
    paths = sorted(tags_dir.glob("*.md"), key=lambda p: _revision_sort_key(p.name), reverse=True)
    return [_tag_meta(path) for path in paths]


def read_chapter_tag(root: Path, relative: str, tag_id: str) -> str:
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have tags")
    if "/" in tag_id or "\\" in tag_id or tag_id in {".", ".."}:
        raise PackageError("Invalid tag")
    path = resolve_inside(root, f"{TAGS_DIR}/{rel}/{tag_id}")
    if not path.is_file():
        raise PackageError("Tag not found")
    return path.read_text(encoding="utf-8")


def delete_chapter_tag(root: Path, relative: str, tag_id: str) -> None:
    rel = relative.replace("\\", "/").lstrip("/")
    if not _is_manuscript_chapter(rel):
        raise PackageError("Only manuscript chapters have tags")
    if "/" in tag_id or "\\" in tag_id or tag_id in {".", ".."}:
        raise PackageError("Invalid tag")
    path = resolve_inside(root, f"{TAGS_DIR}/{rel}/{tag_id}")
    if not path.is_file():
        raise PackageError("Tag not found")
    meta = _tag_meta_path(path)
    path.unlink()
    meta.unlink(missing_ok=True)


def _move_chapter_tags(root: Path, old_rel: str, new_rel: str) -> None:
    _move_chapter_sidecar(root, TAGS_DIR, old_rel, new_rel)


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
    normalized = content.replace("\r\n", "\n")
    created = not path.exists()
    if not created and path.is_file():
        existing = path.read_text(encoding="utf-8")
        rel_existing = path.relative_to(root).as_posix()
        if _is_manuscript_chapter(rel_existing) and _would_wipe_chapter(existing, normalized):
            raise PackageError(
                "Refusing to replace chapter content with empty or near-empty text"
            )
    path.write_text(normalized, encoding="utf-8")
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
            if rel.startswith(f"{HISTORY_DIR}/") or rel.startswith(f"{TAGS_DIR}/"):
                continue
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
