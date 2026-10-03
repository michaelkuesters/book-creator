# Book Creator

Local Leanpub-style studio: store Markdown packages, edit them, and generate a reading PDF and EPUB.

## Package contract

A raw package is a zip (optional single wrapper folder) containing:

- `metadata.yaml` — title, subtitle, author, lang, rights, date, description
- `manuscript/Book.txt` — chapter order, one filename per line
- `manuscript/*.md` — chapter sources
- `manuscript/resources/` — cover (`cover.png`) and other assets
- optional `styles/epub.css`, `fonts/`, `scripts/build_book.py`

## Build behaviour

- **Default:** the studio builder (Pandoc + ReportLab) writes combined Markdown, PDF and EPUB under `dist/`.
- **Override:** if `scripts/build_book.py` exists, that script is run instead, with the package root as the working directory.

## Run

```sh
make run
```

Open http://127.0.0.1:8080 (bound to localhost). Data lives in the Docker volume.

```sh
make build
make test
```

The ACD book manuscript is not bundled. Import its Leanpub zip through the UI.
