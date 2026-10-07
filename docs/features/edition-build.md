# Edition build

## Intent

Operators need reading PDF and EPUB from the current manuscript, matching the local Leanpub-style edition: 5.625 × 9 inch PDF with cover and fonts, plus reflowable EPUB.

**Hypothesis:** We believe a default Pandoc + ReportLab engine plus an optional package script will produce those editions without a Leanpub preview.

## User-facing behaviour

```gherkin
Scenario: Default build
  Given a valid package with metadata.yaml and Book.txt
  And the operator does not request the package script
  When they create PDF and EPUB
  Then dist/ contains Markdown, PDF, EPUB, and build-report.json
  And filenames are derived from the book title

Scenario: Override build
  Given scripts/build_book.py exists
  When the operator checks “Use package build script” and builds
  Then that script runs with the package root as cwd
  And dist/ contains whatever the script wrote

Scenario: Download editions
  Given dist/*.pdf and dist/*.epub
  When the operator uses Download or Publish
  Then they can fetch PDF and EPUB (and source zips from Download)

Scenario: Failed build
  Given Book.txt is empty or invalid
  When a build runs
  Then the job is failed
  And the error is available on the job record
```

## Feature description

### Musts

- Default engine: combine chapters, Pandoc JSON, ReportLab PDF, Pandoc EPUB3, DejaVu fonts bundled in the app.
- Output directory is the package `dist/` on the data volume, not a git `dist/`.
- Override runs only when `scripts/build_book.py` exists **and** the operator sets `use_override`.
- Builds are SQLite jobs (`queued` / `running` / `succeeded` / `failed`) with log and error.
- Pandoc lives in the studio image.

### Must nots

- Must not treat a package script as the default.
- Must not claim printer-certified PDF.
- Must not call Leanpub’s network.

### Escalation

- If Pandoc is missing, fail the job with a clear error.
- If the package script exits non-zero, fail the job; do not fall back to the default engine on that run.

## Acceptance criteria

1. Default build of the tiny fixture writes `Tiny_Test_Book.pdf` and `Tiny_Test_Book.epub` and a page count ≥ 2 when Pandoc is present.
2. Override job with a stub `scripts/build_book.py` sets `used_override` and writes the script’s `dist/` output.
3. Invalid empty `Book.txt` raises a builder error.
4. Publish UI lists PDF and EPUB download links after a successful default build.
5. Covered by `tests/test_builder.py`.
