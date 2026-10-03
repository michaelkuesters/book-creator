from __future__ import annotations

from fastapi.testclient import TestClient

from book_creator.app import app
from book_creator.packages import create_book


def test_home_and_book_pages(data_dir):
    book = create_book("UI Book")
    client = TestClient(app)
    home = client.get("/")
    assert home.status_code == 200
    assert b"UI Book" in home.content
    page = client.get(f"/books/{book['id']}")
    assert page.status_code == 200
    assert b"00-start.md" in page.content
    saved = client.post(
        f"/books/{book['id']}/files",
        data={"path": "manuscript/00-start.md", "content": "# UI Book\n\nSaved from test.\n"},
        follow_redirects=True,
    )
    assert saved.status_code == 200
    assert b"Saved from test" in saved.content
