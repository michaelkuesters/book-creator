# Library

## Intent

Operators need a home screen that shows every book in the local studio so they can open one, start a blank package, or bring in an existing zip.

**Hypothesis:** We believe a cover-led library will make the studio usable without training because it matches how people already think about a shelf of books.

## User-facing behaviour

```gherkin
Scenario: Empty studio
  Given the studio has no books
  When the operator opens the library
  Then they see that the library is empty
  And they can create a book or import a package

Scenario: Create a book
  Given the library page
  When the operator creates a book titled "Demo"
  Then the studio opens that book
  And the library later lists "Demo"
  And the new package includes the studio’s default DejaVu font family under fonts/
    (regular, bold, italic, and bold-italic serif faces, plus the bundled sans/mono files and LICENSE)
  So a default PDF build can render emphasis without the operator adding fonts by hand

Scenario: Open an existing book
  Given a book is in the library
  When the operator chooses it
  Then they reach the Write view for that book
  And the book navbar offers Assets, Details, Download, and Publish

Scenario: Cover on the shelf
  Given a book has manuscript/resources/cover.png
  When the operator views the library
  Then that cover is shown for the book
```

## Feature description

### Musts

- Library is `/`.
- Creating a book POSTs to `/books` and redirects into the studio.
- Creating a book seeds `fonts/` from the studio’s bundled DejaVu set (the same faces the default edition builder uses), including serif italic and bold-italic, so in-studio books are publishable with emphasis without a manual font drop-in.
- Importing a zip POSTs to `/books/import` and keeps whatever `fonts/` the zip already has (no forced overwrite with studio defaults).
- Book records live in SQLite; package files live under `DATA_DIR/books/<id>/`.
- Cover image, when present, is served from `/books/<id>/cover`.

### Must nots

- Must not require an account.
- Must not list other operators’ data (there is only local data).
- Must not copy third-party manuscripts into git.
- Must not replace an imported package’s `fonts/` with the studio defaults.

### Escalation

- If zip import fails validation, show an error; do not create a partial book row without files.

## Acceptance criteria

1. An empty library renders an empty state with create and import actions.
2. Creating a book adds a SQLite row and an on-disk package, then opens the studio.
3. A newly created package’s `fonts/` contains the bundled DejaVu files including `DejaVuSerif-Italic.ttf` and `DejaVuSerif-BoldItalic.ttf`.
4. Importing a valid package zip adds a library entry titled from `metadata.yaml` without overwriting that zip’s `fonts/`.
5. Removing a book from the studio deletes its row and files and it no longer appears on the library.
6. Tests cover create and library page rendering (`tests/test_app.py`, `tests/test_packages.py`), including default font seeding on create.
