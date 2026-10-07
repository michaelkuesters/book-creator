# Development Guidelines

These rules are the always-loaded process core for Book Creator. They apply to every change. Feature-specific intent is listed in the [feature registry](feature-registry.md) and detailed under [features/](features/); load only the one feature document for the work in hand.

This repository follows [Agentic Continuous Delivery](https://beyond.minimumcd.org/docs/agentic-cd/). Humans own intent and accountability. Agents may read and generate artifacts. Agents may not redefine artifact authority. The pipeline’s test verdict is definitive.

Entry points for agents: root [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) both require this file.

## Commands

- `make build` — build the studio image. Do not hand-edit a repo `dist/` folder.
- `make test` — run the test suite in that image. A red suite means the change is not done.
- `make run` — serve the studio on http://127.0.0.1:8080.

Never invent extra Make targets or pipeline steps unless a feature document requires them.

## Delivery artifacts

| Priority | Artifact | Where |
| --- | --- | --- |
| 1 | Intent | `docs/features/<name>.md` — Intent |
| 2 | User-facing behaviour | same file — User-facing behaviour |
| 3 | Feature constraints | same file — Feature description |
| 4 | Acceptance criteria | same file — Acceptance criteria |
| 5 | System constraints | this file |
| 6 | Implementation | `src/`, `web/`, `tests/`, container files |

When artifacts conflict, the higher row wins. Change the implementation to match the documents. Do not silently weaken tests to match code.

The [feature registry](feature-registry.md) lists every current feature and what it does. Add a row when a feature is introduced. Retire or remove the row when it is gone. Do not leave unique process knowledge only in chat.

## System constraints

- Single-user local studio: no login, bind to localhost.
- SQLite plus a Docker volume under `DATA_DIR` (`/data` in the container). Manuscript bytes live on disk so zip import/export stays Leanpub-shaped.
- Package contract: `metadata.yaml`, `manuscript/Book.txt`, `manuscript/*.md`, optional `manuscript/resources/`, `styles/`, `fonts/`, `scripts/build_book.py`.
- Default builder produces reading PDF and EPUB. A package override script runs only when the operator explicitly asks.
- The ACD book manuscript is not stored in this git repo. Operators import it.
- No Leanpub cloud publish, no multi-user accounts, no printer-certified PDF in v1.
- No secrets in source. No path traversal out of a book package.
- While tests are red, only generate changes that restore them.

## Working a change

1. Identify the feature in the [feature registry](feature-registry.md). If none fits, add a feature document and registry row before coding.
2. Keep the change to one feature outcome.
3. Put tests with the behaviour. Run `make test`.
4. Do not promote, tag, or deploy. Humans run `make run` locally.

## Retrieval

Load this file for every session. Use the [feature registry](feature-registry.md) to pick exactly one feature document for the next approved outcome. Do not dump the whole `docs/` tree into context.
