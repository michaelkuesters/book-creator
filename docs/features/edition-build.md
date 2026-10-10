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
  Then dist/ is cleared of prior edition outputs first
  And dist/ then contains only that run’s Markdown, PDF, EPUB, and build-report.json
  And filenames are derived from the book title
  And leftover PDFs/EPUBs from an older title or earlier build are gone

Scenario: Override build
  Given scripts/build_book.py exists
  When the operator checks “Use package build script” and builds
  Then that script runs with the package root as cwd
  And dist/ contains whatever the script wrote

Scenario: Download editions
  Given dist/*.pdf and dist/*.epub
  When the operator uses Download or Publish
  Then they can fetch PDF and EPUB (and source zips from Download)
  And edition download responses must not be reused from browser disk cache after a newer build
    (no-store cache headers; download links include a file-mtime cache buster)

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

Scenario: Chapter images in the default build
  Given a valid package whose chapter Markdown embeds an image under manuscript/resources/
    (for example `![diagram](resources/diagram.png)` from Insert illustration)
  And the referenced image file exists
  And the operator builds with the default studio engine (not the package script)
  When PDF and EPUB are produced
  Then the job succeeds
  And the image appears in the reading PDF
  And the EPUB resource path still resolves the same image
  And the job does not raise Unsupported inline: Image

Scenario: Citations do not fail the default build
  Given a valid package whose Markdown contains a Pandoc citation (Cite inline)
  And the operator builds with the default studio engine (not the package script)
  When PDF rendering walks the Pandoc AST
  Then the job succeeds
  And the citation’s display text is rendered in the PDF
  And the job does not raise Unsupported inline: Cite
```

## Feature description

### Musts

- Default engine: combine chapters, Pandoc JSON, ReportLab PDF, Pandoc EPUB3, DejaVu fonts bundled in the app.
- Default PDF walker renders Pandoc `Image` inlines (and `Figure` blocks that contain them) from `manuscript/resources/` paths used by the editor; missing image files are skipped with the rest of the paragraph text still rendered.
- Default PDF walker renders Pandoc `Cite` inlines as their display text (no bibliography/citeproc requirement for the reading PDF).
- Default PDF walker tolerates Pandoc `RawInline` / `RawBlock`: HTML break tags (`br`) map to a line break; other raw HTML is skipped (content omitted) so residual or imported HTML does not fail the job.
- Output directory is the package `dist/` on the data volume, not a git `dist/`.
- Before writing outputs, a default-engine build removes existing files under that package’s `dist/` (so only the current run’s editions remain—no pile-up of old titles or stale PDF/EPUB/Markdown/report files). Override builds are unchanged: the package script owns `dist/`.
- Override runs only when `scripts/build_book.py` exists **and** the operator sets `use_override`.
- Builds are SQLite jobs (`queued` / `running` / `succeeded` / `failed`) with log and error.
- Pandoc lives in the studio image.
- Edition file downloads (`/books/<id>/editions/<name>`) send `Cache-Control: no-store` (and related no-cache headers). UI links to those editions include a `v=<mtime>` query so a newer build cannot be shadowed by a prior browser disk cache of the same filename.

### Must nots

- Must not treat a package script as the default.
- Must not claim printer-certified PDF.
- Must not call Leanpub’s network.
- Must not fail a default-engine build solely because Pandoc emitted `RawInline` or `RawBlock` for HTML.
- Must not fail a default-engine build solely because Pandoc emitted an `Image` inline for a chapter illustration under `resources/`.
- Must not fail a default-engine build solely because Pandoc emitted a `Cite` inline.
- Must not rewrite the operator’s package `scripts/build_book.py`; override behaviour stays package-owned.
- Must not delete files outside the book package `dist/` (browser Downloads and other OS folders are out of scope).

### Escalation

- If Pandoc is missing, fail the job with a clear error.
- If the package script exits non-zero, fail the job; do not fall back to the default engine on that run.

## Acceptance criteria

1. Default build of the tiny fixture writes `Tiny_Test_Book.pdf` and `Tiny_Test_Book.epub` and a page count ≥ 2 when Pandoc is present.
2. Default build removes pre-existing `dist/` files first; after success, `dist/` contains only the new stem’s `.md`/`.pdf`/`.epub` plus `build-report.json` (no leftover foreign PDF/EPUB).
3. Override job with a stub `scripts/build_book.py` sets `used_override` and writes the script’s `dist/` output.
4. Invalid empty `Book.txt` raises a builder error.
5. Publish UI lists PDF and EPUB download links after a successful default build; those links include a mtime cache buster and the edition response sets no-store cache headers.
6. Default build of a chapter that still contains an HTML `<br>` (Pandoc `RawInline`) succeeds; the job does not raise `Unsupported inline: RawInline`.
7. Default build of a chapter that embeds `![…](resources/<file>)` with the file present under `manuscript/resources/` succeeds; the PDF includes the image and the job does not raise `Unsupported inline: Image`.
8. Default build of a chapter that contains a Pandoc citation (`Cite`) succeeds; the job does not raise `Unsupported inline: Cite`.
9. Covered by `tests/test_builder.py` and edition download coverage in `tests/test_app.py`.
