# Manuscript editing

## Intent

Operators need to write and rearrange Markdown chapters, set book details, manage illustrations, and publish without leaving the studio—or dropping into a raw package tree for everyday work.

**Hypothesis:** We believe a Write / Assets / Details split, with WYSIWYG that still saves Markdown, will feel like a book app while keeping the Leanpub-shaped package as the source of truth.

## User-facing behaviour

```gherkin
Scenario: Navigate the book
  Given an open book
  When the operator uses the book navbar
  Then Write, Assets, Details, Download, and Publish are available

Scenario: Add a chapter
  Given the Write view
  When the operator adds a chapter
  Then the file exists under manuscript/
  And its filename is appended to Book.txt
  And the editor opens that chapter

Scenario: Edit with WYSIWYG
  Given an open chapter
  When the operator views the editor
  Then Markdown emphasis and structure are shown as formatted text
  And saving persists Markdown on disk, not HTML

Scenario: Autosave
  Given the operator typed in the chapter editor
  And ten seconds pass with no further keypress
  When the idle timer fires
  Then the chapter file is saved through the same save endpoint as an explicit save

Scenario: Autosave on leave
  Given the operator has unsaved edits in the chapter editor
  When they navigate away in the studio or close the tab
  Then the chapter is saved through the same autosave endpoint asynchronously
  And the browser does not show a leave-confirm dialog

Scenario: Unsaved edits highlight
  Given the operator has unsaved edits in the chapter editor
  When the editor is dirty
  Then the editor surface shows a soft blue backdrop

Scenario: Reorder chapters from Write
  Given the Write view with two or more chapters
  When the operator drag-and-drops a chapter in the Contents list
  Then Book.txt order matches the new list order

Scenario: Rename a chapter from Write
  Given a chapter in the Contents list or the open chapter header
  When the operator renames it (sidebar pen opens a dialog; the open chapter title is edited inline above the editor)
  Then the chapter heading title and manuscript filename stay in sync
  And Book.txt uses the new filename
  And the Contents list shows the new title

Scenario: Delete a chapter from Write
  Given a chapter that is not Book.txt or metadata.yaml
  When the operator hovers that chapter and chooses remove
  And confirms in a dialog
  Then the file is gone
  And it is removed from Book.txt

Scenario: Book details page
  Given an open book
  When the operator opens Details
  Then they can edit metadata.yaml fields
  And they can edit Book.txt order
  And they can remove the book from the library

Scenario: Assets gallery
  Given uploaded files under manuscript/resources/
  When the operator opens Assets
  Then each asset is listed with a preview when it is an image
  And the Markdown path for embedding is shown

Scenario: Upload an asset
  Given the Assets page or the insert-illustration dialog
  When the operator uploads a file
  Then it is stored under manuscript/resources/

Scenario: Insert illustration into a chapter
  Given the Write view and at least one image asset
  When the operator inserts an illustration
  Then the chapter Markdown gains an image pointing at resources/<filename>
  And the editor shows the image while editing
```

## Feature description

### Musts

- Book chrome: Write (`/books/<id>`), Assets (`/books/<id>/assets`), Details (`/books/<id>/details`), plus Download and Publish in the navbar.
- Chapter sources are `manuscript/*.md`; the Write sidebar lists chapters in `Book.txt` order by heading title when available.
- Reading order is `manuscript/Book.txt` (one filename per line, unique, files must exist). Operators reorder it by drag-and-drop in the Write Contents list; Details still accepts a raw order edit.
- Hovering a Contents row reveals rename (pen) and remove (trash) actions. Remove confirms via `<dialog>`. Rename is available from that pen (dialog) and by inline-editing the open chapter title above the editor. Renaming updates the Markdown heading title and the `manuscript/*.md` filename together (and `Book.txt`); they must not drift.
- Write chrome does not explain autosave or “saved as Markdown” to the operator; those are implementation details.
- Details fields map to `metadata.yaml`: title, subtitle, author, lang, rights, date, description.
- Assets live in `manuscript/resources/`; images are served at `/books/<id>/assets/<name>` for preview and editor display.
- Embedded images in Markdown use `resources/<filename>` so Pandoc’s manuscript resource path still resolves them.
- The chapter editor is WYSIWYG for reading, Markdown for storage (including autosave and explicit save).
- Leaving a dirty chapter (in-app navigation or unload) saves through the same autosave endpoint asynchronously; the browser must not show a leave-confirm dialog.
- While the editor is dirty, the editor surface uses a soft blue backdrop.
- Paths stay inside the book package; `..` is rejected.
- `metadata.yaml` and `manuscript/Book.txt` cannot be deleted.

### Must nots

- Must not rewrite chapter bytes except when the operator (or autosave) saves them.
- Must not store HTML as the chapter source of truth.
- Must not require a client-side SPA build; server-rendered pages plus small scripts (and CDN editor assets) are enough.
- Must not bury Download or Publish only inside the chapter layout; they belong in the book navbar.
- Must not block navigation with a browser leave-confirm dialog when the chapter has unsaved edits.

### Preferences

- Autosave after about ten seconds of idle input is preferred.
- Prefer silent async save on leave over blocking the operator.
- Cover image should be named `cover.png` (or another supported cover filename) under `manuscript/resources/`.

### Escalation

- If a requested path is not a text file, do not put it in the Markdown editor.
- If an asset is missing, the Assets page simply omits it; broken image links in a chapter stay the operator’s problem until they fix or re-upload.

## Acceptance criteria

1. Adding a chapter creates `manuscript/<name>.md`, appends it to `Book.txt`, and opens Write on that file.
2. Editing a chapter persists UTF-8 Markdown without turning `\n` into `\r\n`; idle autosave, Save now, and leave-save use the same endpoint; leave does not use a browser confirm dialog; dirty state shows a soft blue editor backdrop.
3. WYSIWYG displays formatted emphasis (for example italic and strikethrough) while the saved file remains Markdown.
4. Drag-and-drop in Write Contents persists the new order to `Book.txt`; rename (dialog or inline header) updates heading title and filename together and rewrites `Book.txt`; remove (dialog confirm) deletes the file and drops it from `Book.txt`.
5. Details page saves metadata and chapter order; removing the book deletes its SQLite row and package directory.
6. Assets page lists `manuscript/resources/` entries; JSON upload returns a `resources/<name>` Markdown path; `/books/<id>/assets/<name>` serves the file.
7. Insert illustration (picker or editor image upload) writes a `resources/…` image into the chapter Markdown.
8. Covered by `tests/test_packages.py` and `tests/test_app.py` (including autosave JSON, chapter rename/reorder/remove, and asset upload/serve).
