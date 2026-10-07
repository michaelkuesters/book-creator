from __future__ import annotations

from fastapi.testclient import TestClient

from book_creator.app import app
from book_creator.packages import create_book, read_book_txt, read_text_file, book_root


def test_settings_page(data_dir):
    client = TestClient(app)
    page = client.get("/settings")
    assert page.status_code == 200
    assert b"Settings" in page.content
    assert b'theme-light' in page.content or b'id="theme-light"' in page.content
    assert b'id="theme-dark"' in page.content
    assert b'id="ink-color"' in page.content
    assert b'type="color"' in page.content
    home = client.get("/")
    assert b'href="/settings"' in home.content


def test_home_and_book_pages(data_dir):
    book = create_book("UI Book")
    client = TestClient(app)
    home = client.get("/")
    assert home.status_code == 200
    assert b"Library" in home.content
    assert b"UI Book" in home.content
    assert b'href="/settings"' in home.content
    page = client.get(f"/books/{book['id']}")
    assert page.status_code == 200
    assert b"Contents" in page.content
    assert b"Write" in page.content
    assert b"Publish" in page.content
    assert b"UI Book" in page.content
    assert b"chapter-title-input" in page.content
    assert b"edits autosave as Markdown" not in page.content
    details = client.get(f"/books/{book['id']}/details")
    assert details.status_code == 200
    assert b"Book details" in details.content
    assets = client.get(f"/books/{book['id']}/assets")
    assert assets.status_code == 200
    assert b"Assets" in assets.content
    saved = client.post(
        f"/books/{book['id']}/files",
        data={"path": "manuscript/UI Book.md", "content": "# UI Book\n\nSaved from test.\n"},
        follow_redirects=True,
    )
    assert saved.status_code == 200
    assert b"Saved from test" in saved.content


def test_autosave_returns_json(data_dir):
    book = create_book("Autosave Book")
    client = TestClient(app)
    response = client.post(
        f"/books/{book['id']}/files",
        data={"path": "manuscript/Autosave Book.md", "content": "# Autosave\n\nIdle save.\n"},
        params={"autosave": "true"},
        headers={"Accept": "application/json"},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_asset_upload_json_and_serve(data_dir):
    book = create_book("Asset Book")
    client = TestClient(app)
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    uploaded = client.post(
        f"/books/{book['id']}/resources",
        files={"resource": ("diagram.png", png, "image/png")},
        params={"json": "true"},
        headers={"Accept": "application/json"},
    )
    assert uploaded.status_code == 200
    payload = uploaded.json()
    assert payload["markdown"] == "resources/diagram.png"
    served = client.get(f"/books/{book['id']}/assets/diagram.png")
    assert served.status_code == 200
    page = client.get(f"/books/{book['id']}/assets")
    assert b"diagram.png" in page.content


def test_chapter_reorder_rename_remove(data_dir):
    book = create_book("Chapter Ops")
    client = TestClient(app)
    added = client.post(
        f"/books/{book['id']}/files/new",
        data={"name": "Second chapter"},
        follow_redirects=False,
    )
    assert added.status_code == 303
    root = book_root(book["id"])
    assert read_book_txt(root) == ["Chapter Ops.md", "Second chapter.md"]

    reordered = client.post(
        f"/books/{book['id']}/order",
        data={"order": "Second chapter.md\nChapter Ops.md"},
        headers={"Accept": "application/json"},
    )
    assert reordered.status_code == 200
    assert reordered.json()["order"] == ["Second chapter.md", "Chapter Ops.md"]
    assert read_book_txt(root) == ["Second chapter.md", "Chapter Ops.md"]

    renamed = client.post(
        f"/books/{book['id']}/files/rename",
        data={"path": "manuscript/Second chapter.md", "title": "Later thoughts"},
        headers={"Accept": "application/json"},
    )
    assert renamed.status_code == 200
    payload = renamed.json()
    assert payload["title"] == "Later thoughts"
    assert payload["name"] == "Later thoughts.md"
    assert payload["path"] == "manuscript/Later thoughts.md"
    assert read_text_file(root, "manuscript/Later thoughts.md").startswith("# Later thoughts\n")
    assert read_book_txt(root) == ["Later thoughts.md", "Chapter Ops.md"]
    assert not (root / "manuscript" / "Second chapter.md").exists()

    page = client.get(f"/books/{book['id']}")
    assert page.status_code == 200
    assert b"rename-chapter-dialog" in page.content
    assert b"remove-chapter-dialog" in page.content
    assert b"Later thoughts" in page.content

    removed = client.post(
        f"/books/{book['id']}/files/delete",
        data={"path": "manuscript/Later thoughts.md"},
        headers={"Accept": "application/json"},
    )
    assert removed.status_code == 200
    assert removed.json()["ok"] is True
    assert read_book_txt(root) == ["Chapter Ops.md"]
    assert not (root / "manuscript" / "Later thoughts.md").exists()
