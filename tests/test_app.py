from __future__ import annotations

from fastapi.testclient import TestClient

from book_creator.app import app
from book_creator.packages import create_book


def test_home_and_book_pages(data_dir):
    book = create_book("UI Book")
    client = TestClient(app)
    home = client.get("/")
    assert home.status_code == 200
    assert b"Library" in home.content
    assert b"UI Book" in home.content
    page = client.get(f"/books/{book['id']}")
    assert page.status_code == 200
    assert b"Contents" in page.content
    assert b"Write" in page.content
    assert b"Publish" in page.content
    assert b"UI Book" in page.content
    details = client.get(f"/books/{book['id']}/details")
    assert details.status_code == 200
    assert b"Book details" in details.content
    assets = client.get(f"/books/{book['id']}/assets")
    assert assets.status_code == 200
    assert b"Assets" in assets.content
    saved = client.post(
        f"/books/{book['id']}/files",
        data={"path": "manuscript/00-start.md", "content": "# UI Book\n\nSaved from test.\n"},
        follow_redirects=True,
    )
    assert saved.status_code == 200
    assert b"Saved from test" in saved.content


def test_autosave_returns_json(data_dir):
    book = create_book("Autosave Book")
    client = TestClient(app)
    response = client.post(
        f"/books/{book['id']}/files",
        data={"path": "manuscript/00-start.md", "content": "# Autosave\n\nIdle save.\n"},
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
