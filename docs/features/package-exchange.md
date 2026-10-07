# Package exchange

## Intent

Operators already keep Leanpub-shaped folders and zips. They need to load a whole package into the studio and take one back out without a proprietary format.

**Hypothesis:** We believe zip round-trip of the canonical tree will let the ACD book (and later books) move in and out without a Leanpub account.

## User-facing behaviour

```gherkin
Scenario: Import a wrapped zip
  Given a zip whose files sit under one wrapper folder
  And the wrapper contains metadata.yaml and manuscript/
  When the operator imports it
  Then the studio stores the inner tree, not the wrapper name

Scenario: Import without Book.txt
  Given manuscript/*.md files and no Book.txt
  When the operator imports the zip
  Then Book.txt is created listing those Markdown files

Scenario: Download source
  When the operator downloads the source zip
  Then it contains the package files
  And it omits dist/

Scenario: Download with editions
  Given dist/ contains built files
  When the operator downloads the zip with editions
  Then dist/ is included
```

## Feature description

### Musts

- Canonical tree: `metadata.yaml`, `manuscript/`, optional `styles/`, `fonts/`, `scripts/`, examples, and usual sidecar files.
- Zip size limit is enforced.
- Export names the file from the book slug.
- Filesystem is source of truth; SQLite only stores book identity and jobs.

### Must nots

- Must not unpack paths that escape the book directory.
- Must not put the operator’s manuscript into this git repository.

## Acceptance criteria

1. A zip with a single wrapper directory imports as if the wrapper were absent.
2. A zip missing `metadata.yaml` or `manuscript/` is rejected and leaves no book.
3. Source export contains `metadata.yaml` and `manuscript/Book.txt` and does not contain `dist/`.
4. Export with editions includes `dist/` entries when they exist.
5. Covered by `tests/test_packages.py` and the override job’s include-dist assertion in `tests/test_builder.py`.
