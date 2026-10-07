from __future__ import annotations

from fastapi.testclient import TestClient

from book_creator.app import app
from book_creator.packages import (
    book_root,
    create_book,
    read_book_txt,
    read_text_file,
    write_text_file,
)


def test_settings_sheet(data_dir):
    client = TestClient(app)
    home = client.get("/")
    assert home.status_code == 200
    assert b'id="studio-settings"' in home.content
    assert b'id="open-settings"' in home.content
    assert b'id="theme-light"' in home.content
    assert b'id="theme-dark"' in home.content
    assert b'id="ink-color"' in home.content
    assert b'type="color"' in home.content
    assert b"Writing text color" in home.content
    assert b'rel="icon"' in home.content
    assert b"/static/favicon.svg" in home.content
    favicon = client.get("/static/favicon.svg")
    assert favicon.status_code == 200
    assert b"<svg" in favicon.content
    book = create_book("Settings Book")
    page = client.get(f"/books/{book['id']}")
    assert page.status_code == 200
    assert b'id="studio-settings"' in page.content
    assert b'id="open-settings"' in page.content
    assert b"/static/favicon.svg" in page.content
    redirected = client.get("/settings", follow_redirects=False)
    assert redirected.status_code == 303
    assert redirected.headers["location"] == "/"
    css = client.get("/static/style.css")
    assert css.status_code == 200
    assert b"--write-ink" in css.content
    # Toast UI hardcodes content colors; studio rules must beat light and dark themes.
    assert b".wysiwyg-host .toastui-editor-contents p" in css.content
    assert b".wysiwyg-host .toastui-editor-dark .toastui-editor-contents p" in css.content
    assert b"color: var(--write-ink)" in css.content
    # Unsaved edits: add/remove cues via maximal equal-substring diff, not a whole-editor backdrop.
    assert b".bc-unsaved-add" in css.content
    assert b".bc-unsaved-del" in css.content
    assert b"opacity: 0.1" in css.content
    assert b"text-decoration: line-through" in css.content
    assert b".wysiwyg-host.is-dirty" not in css.content
    studio_js = client.get("/static/studio.js")
    assert studio_js.status_code == 200
    assert b"unsavedDiffPlugin" in studio_js.content
    assert b"bc-unsaved-add" in studio_js.content
    assert b"bc-unsaved-del" in studio_js.content
    assert b"baseline: null" in studio_js.content
    assert b"settleUnsavedBaseline" in studio_js.content
    assert b"!dirty" in studio_js.content
    assert b"diffStrings" in studio_js.content
    assert b"findLongestMatch" in studio_js.content
    assert b"UNSAVED_SEGMENT_LIMIT = 50" in studio_js.content
    assert b"queueConsolidateSave" in studio_js.content
    assert b"pushGapOps" in studio_js.content
    assert b"slicesEqual" in studio_js.content
    assert b"isDiffJunkChar" in studio_js.content
    assert b"diffChars" not in studio_js.content


def test_home_and_book_pages(data_dir):
    book = create_book("UI Book")
    client = TestClient(app)
    home = client.get("/")
    assert home.status_code == 200
    assert b"Library" in home.content
    assert b"UI Book" in home.content
    assert b'id="open-settings"' in home.content
    page = client.get(f"/books/{book['id']}")
    assert page.status_code == 200
    assert b"Contents" in page.content
    assert b"Write" in page.content
    assert b"Publish" in page.content
    assert b"UI Book" in page.content
    assert b"chapter-title-input" in page.content
    assert b"insert-asset-btn" in page.content
    assert b"chapter-more-menu" in page.content
    assert b"chapter-download-btn" in page.content
    assert b"chapter-tags-btn" in page.content
    assert b"chapter-history-btn" in page.content
    assert b">More</summary>" in page.content
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


def test_force_save_shortcut_wiring(data_dir):
    client = TestClient(app)
    studio_js = client.get("/static/studio.js")
    assert studio_js.status_code == 200
    assert b"setupForceSaveShortcut" in studio_js.content
    assert b"event.ctrlKey || event.metaKey" in studio_js.content
    assert b'key !== "s" && key !== "S"' in studio_js.content
    assert b"if (saving) return" in studio_js.content
    assert b"if (!dirty) return" in studio_js.content
    assert b"preventDefault" in studio_js.content


def test_chapter_history_list_and_restore(data_dir):
    book = create_book("History Book")
    client = TestClient(app)
    path = "manuscript/History Book.md"
    first = "# History\n\nFirst saved body with enough characters.\n"
    second = "# History\n\nSecond saved body with enough characters.\n"
    idle = client.post(
        f"/books/{book['id']}/files",
        data={"path": path, "content": first},
        params={"autosave": "true"},
        headers={"Accept": "application/json"},
    )
    assert idle.status_code == 200
    assert idle.json().get("revision") is None
    empty = client.get(
        f"/books/{book['id']}/files/history",
        params={"path": path},
        headers={"Accept": "application/json"},
    )
    assert empty.status_code == 200
    assert empty.json()["revisions"] == []
    leave = client.post(
        f"/books/{book['id']}/files",
        data={"path": path, "content": first},
        params={"autosave": "true", "checkpoint": "true"},
        headers={"Accept": "application/json"},
    )
    assert leave.status_code == 200
    assert leave.json()["revision"] is not None
    assert leave.json()["revision"]["word_count"] > 0
    assert (
        client.post(
            f"/books/{book['id']}/files",
            data={"path": path, "content": second},
            params={"autosave": "true", "checkpoint": "true"},
            headers={"Accept": "application/json"},
        ).status_code
        == 200
    )
    listed = client.get(
        f"/books/{book['id']}/files/history",
        params={"path": path},
        headers={"Accept": "application/json"},
    )
    assert listed.status_code == 200
    revisions = listed.json()["revisions"]
    assert len(revisions) == 2
    assert "saved_at" in revisions[0]
    assert "word_count" in revisions[0]
    squash = listed.json()["squash"]
    assert squash["all"] is True
    assert squash["same_days"] is True
    target = next(
        rev
        for rev in revisions
        if client.get(
            f"/books/{book['id']}/files/history/revision",
            params={"path": path, "id": rev["id"]},
            headers={"Accept": "application/json"},
        ).json()["content"]
        == first
    )
    preview = client.get(
        f"/books/{book['id']}/files/history/revision",
        params={"path": path, "id": target["id"]},
        headers={"Accept": "application/json"},
    )
    assert preview.status_code == 200
    assert preview.json()["content"] == first
    # Opening a revision is read-only over HTTP; Latest on disk must stay intact.
    assert read_text_file(book_root(book["id"]), path) == second
    page = client.get(f"/books/{book['id']}?file={path}")
    assert page.status_code == 200
    assert b"chapter-history-btn" in page.content
    assert b"chapter-history-squash-btn" in page.content
    assert b"chapter-squash-dialog" in page.content
    assert b"Same days" in page.content
    assert b"Same week" in page.content
    assert b"version-promote-dialog" in page.content
    assert b"version-proceed" in page.content
    assert b"version-open-readonly" in page.content
    assert b"Back to Latest" in page.content
    kept_id = revisions[0]["id"]
    kept_at = revisions[0]["saved_at"]
    squashed = client.post(
        f"/books/{book['id']}/files/history/squash",
        data={"path": path, "mode": "all"},
        headers={"Accept": "application/json"},
    )
    assert squashed.status_code == 200
    body = squashed.json()
    assert body["removed"] == 1
    assert len(body["revisions"]) == 1
    assert body["revisions"][0]["id"] == kept_id
    assert body["revisions"][0]["saved_at"] == kept_at
    assert body["squash"] == {"same_days": False, "same_week": False, "all": False}
    studio_js = client.get("/static/studio.js")
    assert b"insertMarkdownParsed" in studio_js.content
    assert b"markdownInlineInputPlugin" in studio_js.content
    assert b"appendTransaction" in studio_js.content
    assert b"bcMarkdownInlineInput" in studio_js.content
    assert b"scheduleMarkdownReplace" in studio_js.content
    assert b"tryBlock" in studio_js.content or b"ATX heading" in studio_js.content
    assert b"bulletList" in studio_js.content
    assert b"orderedList" in studio_js.content
    assert b"linkUrl" in studio_js.content
    assert b"imageUrl" in studio_js.content
    assert b"isTableSeparator" in studio_js.content
    assert b"hideModeSwitch: false" in studio_js.content
    assert b"sessionNeedsCheckpoint" in studio_js.content
    assert b"files/history/checkpoint" in studio_js.content
    assert b"files/history/squash" in studio_js.content
    assert b"openHistoricVersion" in studio_js.content
    assert b"offerVersionPromote" in studio_js.content
    assert b"Open Read-Only" in page.content


def test_chapter_tags_create_open_delete(data_dir):
    book = create_book("Tagged Book")
    client = TestClient(app)
    path = "manuscript/Tagged Book.md"
    body = "# Tagged\n\nEnough characters for a tagged snapshot.\n"
    assert (
        client.post(
            f"/books/{book['id']}/files",
            data={"path": path, "content": body},
            params={"autosave": "true"},
            headers={"Accept": "application/json"},
        ).status_code
        == 200
    )
    empty = client.get(
        f"/books/{book['id']}/files/tags",
        params={"path": path},
        headers={"Accept": "application/json"},
    )
    assert empty.status_code == 200
    assert empty.json()["tags"] == []
    created = client.post(
        f"/books/{book['id']}/files/tags",
        data={"path": path, "label": "section 1 reworked"},
        headers={"Accept": "application/json"},
    )
    assert created.status_code == 200
    tag = created.json()["tag"]
    assert tag["label"] == "section 1 reworked"
    assert tag["word_count"] > 0
    listed = client.get(
        f"/books/{book['id']}/files/tags",
        params={"path": path},
        headers={"Accept": "application/json"},
    )
    assert listed.status_code == 200
    assert len(listed.json()["tags"]) == 1
    preview = client.get(
        f"/books/{book['id']}/files/tags/revision",
        params={"path": path, "id": tag["id"]},
        headers={"Accept": "application/json"},
    )
    assert preview.status_code == 200
    assert preview.json()["content"] == body
    later = "# Tagged\n\nLater edits that remain Latest on disk.\n"
    assert (
        client.post(
            f"/books/{book['id']}/files",
            data={"path": path, "content": later},
            params={"autosave": "true", "checkpoint": "true"},
            headers={"Accept": "application/json"},
        ).status_code
        == 200
    )
    assert read_text_file(book_root(book["id"]), path) == later
    assert (
        client.get(
            f"/books/{book['id']}/files/tags/revision",
            params={"path": path, "id": tag["id"]},
            headers={"Accept": "application/json"},
        ).json()["content"]
        == body
    )
    history = client.get(
        f"/books/{book['id']}/files/history",
        params={"path": path},
        headers={"Accept": "application/json"},
    )
    assert history.status_code == 200
    assert all("label" not in rev or rev.get("label") is None for rev in history.json()["revisions"])
    assert len(history.json()["revisions"]) >= 1
    deleted = client.post(
        f"/books/{book['id']}/files/tags/delete",
        data={"path": path, "id": tag["id"]},
        headers={"Accept": "application/json"},
    )
    assert deleted.status_code == 200
    assert (
        client.get(
            f"/books/{book['id']}/files/tags",
            params={"path": path},
            headers={"Accept": "application/json"},
        ).json()["tags"]
        == []
    )
    assert read_text_file(book_root(book["id"]), path) == later
    assert len(
        client.get(
            f"/books/{book['id']}/files/history",
            params={"path": path},
            headers={"Accept": "application/json"},
        ).json()["revisions"]
    ) >= 1
    page = client.get(f"/books/{book['id']}?file={path}")
    assert page.status_code == 200
    assert b"chapter-tags-btn" in page.content
    assert b"chapter-tags-dialog" in page.content
    assert b"chapter-tag-create-dialog" in page.content
    assert b"chapter-tag-delete-dialog" in page.content
    studio_js = client.get("/static/studio.js")
    assert b"setupChapterTags" in studio_js.content
    assert b"files/tags" in studio_js.content


def test_autosave_refuses_empty_wipe(data_dir):
    book = create_book("Wipe Guard")
    client = TestClient(app)
    path = "manuscript/Wipe Guard.md"
    body = "# Wipe Guard\n\n" + ("Substantial chapter text. " * 20) + "\n"
    seeded = client.post(
        f"/books/{book['id']}/files",
        data={"path": path, "content": body},
        params={"autosave": "true"},
        headers={"Accept": "application/json"},
    )
    assert seeded.status_code == 200
    wiped = client.post(
        f"/books/{book['id']}/files",
        data={"path": path, "content": ""},
        params={"autosave": "true"},
        headers={"Accept": "application/json"},
    )
    assert wiped.status_code == 400
    assert "Refusing to replace chapter content" in wiped.json()["detail"]
    assert read_text_file(book_root(book["id"]), path) == body


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


def test_download_chapter_markdown(data_dir):
    book = create_book("Download Me")
    client = TestClient(app)
    root = book_root(book["id"])
    path = "manuscript/Download Me.md"
    body = "# 2. Prepare the Runway\n\nChapter body for download.\n"
    write_text_file(root, path, body)
    response = client.get(
        f"/books/{book['id']}/chapters/download",
        params={"path": path},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "2- Prepare the Runway-" in disposition
    assert '.md"' in disposition
    assert response.content.decode("utf-8").startswith("# 2. Prepare the Runway\n")
    bad = client.get(
        f"/books/{book['id']}/chapters/download",
        params={"path": "metadata.yaml"},
    )
    assert bad.status_code == 400


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
