# Book Creator

Local Leanpub-style studio: store Markdown packages, edit them, and generate a reading PDF and EPUB.

Process for agents and humans: [docs/DEVELOPMENT-GUIDELINES.md](docs/DEVELOPMENT-GUIDELINES.md). Feature list: [docs/features/README.md](docs/features/README.md). Delivery artifacts follow [Agentic Continuous Delivery](https://beyond.minimumcd.org/docs/agentic-cd/).

## Package contract

A raw package is a zip (optional single wrapper folder) containing:

- `metadata.yaml` — title, subtitle, author, lang, rights, date, description
- `manuscript/Book.txt` — chapter order, one filename per line
- `manuscript/*.md` — chapter sources
- `manuscript/resources/` — cover (`cover.png`) and other assets
- optional `styles/epub.css`, `fonts/`, `scripts/build_book.py`

## Build behaviour

- **Default:** the studio builder (Pandoc + ReportLab) writes combined Markdown, PDF and EPUB under `dist/`.
- **Override:** packages may ship `scripts/build_book.py`. The studio ignores it unless you check **Use package override script** on the book page.

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
