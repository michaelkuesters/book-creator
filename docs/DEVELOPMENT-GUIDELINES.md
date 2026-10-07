# Development Guidelines

These rules are the always-loaded process core for Book Creator. They apply to every change. Feature-specific intent is listed in the [feature registry](feature-registry.md) and detailed under [features/](features/); load only the one feature document for the work in hand.

This repository follows [Agentic Continuous Delivery](https://beyond.minimumcd.org/docs/agentic-cd/). Humans own intent and accountability. Agents may read and generate artifacts. Agents may not redefine artifact authority. The pipeline’s test verdict is definitive.

**Human approval gate (mandatory):** When Intent, User-facing behaviour, Feature description, or Acceptance criteria are new or changed, a human must approve those document edits before any implementation (code, tests, container files, or registry status that claims the outcome). Drafting or revising feature docs does not authorize coding. Plans, chat agreement to “implement the plan,” or prior sessions do not replace this gate. If approval is missing, stop after the doc change and ask.

Entry points for agents: root [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) both require this file.

## Commands

- `make build` — build the studio image. Do not hand-edit a repo `dist/` folder.
- `make test` — run the test suite in that image. A red suite means the change is not done.
- `make run` — start the studio stack detached; open https://books.localhost:17443 (Caddy on a dedicated loopback port).
- `make trust` — install Caddy’s local root CA into the OS trust store (once per machine; stack must be running).
- `make new` — build, test, then run in one go (stops before run if tests fail).
- `make stop` — stop the studio stack.

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
- Local operator URL is `https://books.localhost:17443` via Caddy; the only published host port is `127.0.0.1:17443` (not `80`/`443`/`8080`).
- SQLite plus a Docker volume under `DATA_DIR` (`/data` in the container). Manuscript bytes live on disk so zip import/export stays Leanpub-shaped.
- Package contract: `metadata.yaml`, `manuscript/Book.txt`, `manuscript/*.md`, optional `manuscript/resources/`, `styles/`, `fonts/`, `scripts/build_book.py`.
- Default builder produces reading PDF and EPUB. A package override script runs only when the operator explicitly asks.
- The ACD book manuscript is not stored in this git repo. Operators import it.
- No Leanpub cloud publish, no multi-user accounts, no printer-certified PDF in v1.
- No secrets in source. No path traversal out of a book package.
- While tests are red, only generate changes that restore them.

## Frontend

- Prefer server-rendered pages plus small scripts; no client-side SPA build requirement.
- Use HTML `<dialog>` (with the studio’s sheet styling) for operator prompts: rename/edit fields, confirmations, pickers, and similar. Do not use `window.prompt`, `window.confirm`, or `window.alert` for product UI.

## Working a change

1. Identify the feature in the [feature registry](feature-registry.md). If none fits, draft a feature document and registry row (docs only).
2. If Intent, User-facing behaviour, Feature description, or Acceptance criteria are new or changed: write or update only those docs, then **stop and obtain explicit human approval**. Do not implement until approved.
3. Keep the change to one feature outcome.
4. Put tests with the behaviour. Run `make test`.
5. Do not promote, tag, or deploy. Humans run `make run` locally.

## Retrieval

Load this file for every session. Use the [feature registry](feature-registry.md) to pick exactly one feature document for the next approved outcome. Do not dump the whole `docs/` tree into context.
