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
- Importing a zip POSTs to `/books/import`.
- Book records live in SQLite; package files live under `DATA_DIR/books/<id>/`.
- Cover image, when present, is served from `/books/<id>/cover`.

### Must nots

- Must not require an account.
- Must not list other operators’ data (there is only local data).
- Must not copy third-party manuscripts into git.

### Escalation

- If zip import fails validation, show an error; do not create a partial book row without files.

## Acceptance criteria

1. An empty library renders an empty state with create and import actions.
2. Creating a book adds a SQLite row and an on-disk package, then opens the studio.
3. Importing a valid package zip adds a library entry titled from `metadata.yaml`.
4. Removing a book from the studio deletes its row and files and it no longer appears on the library.
5. Tests cover create and library page rendering (`tests/test_app.py`, `tests/test_packages.py`).
