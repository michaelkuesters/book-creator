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

Scenario: Residual raw HTML does not fail the default build
  Given a valid package whose Markdown still contains a Pandoc RawInline or RawBlock
    (for example a leftover HTML <br> from an older editor save or an imported chapter)
  And the operator builds with the default studio engine (not the package script)
  When PDF rendering walks the Pandoc AST
  Then the job succeeds
  And known break tags become line breaks in the PDF
  And other raw HTML inlines/blocks are omitted rather than aborting the build
```

## Feature description

### Musts

- Default engine: combine chapters, Pandoc JSON, ReportLab PDF, Pandoc EPUB3, DejaVu fonts bundled in the app.
- Default PDF walker tolerates Pandoc `RawInline` / `RawBlock`: HTML break tags (`br`) map to a line break; other raw HTML is skipped (content omitted) so residual or imported HTML does not fail the job.
- Output directory is the package `dist/` on the data volume, not a git `dist/`.
- Override runs only when `scripts/build_book.py` exists **and** the operator sets `use_override`.
- Builds are SQLite jobs (`queued` / `running` / `succeeded` / `failed`) with log and error.
- Pandoc lives in the studio image.

### Must nots

- Must not treat a package script as the default.
- Must not claim printer-certified PDF.
- Must not call Leanpub’s network.
- Must not fail a default-engine build solely because Pandoc emitted `RawInline` or `RawBlock` for HTML.
- Must not rewrite the operator’s package `scripts/build_book.py`; override behaviour stays package-owned.

### Escalation

- If Pandoc is missing, fail the job with a clear error.
- If the package script exits non-zero, fail the job; do not fall back to the default engine on that run.

## Acceptance criteria

1. Default build of the tiny fixture writes `Tiny_Test_Book.pdf` and `Tiny_Test_Book.epub` and a page count ≥ 2 when Pandoc is present.
2. Override job with a stub `scripts/build_book.py` sets `used_override` and writes the script’s `dist/` output.
3. Invalid empty `Book.txt` raises a builder error.
4. Publish UI lists PDF and EPUB download links after a successful default build.
5. Default build of a chapter that still contains an HTML `<br>` (Pandoc `RawInline`) succeeds; the job does not raise `Unsupported inline: RawInline`.
6. Covered by `tests/test_builder.py`.
