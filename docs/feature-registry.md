# Feature registry

Authoritative catalogue of Book Creator product features: what exists, what each feature is for, and which document owns its intent.

Agents and humans use this file to route work. Do not invent features that are not listed here.

| Document | Role |
| --- | --- |
| [DEVELOPMENT-GUIDELINES.md](DEVELOPMENT-GUIDELINES.md) | Always-on process, system constraints, commands |
| This registry | Which features exist and which doc to open |
| `docs/features/<id>.md` | Intent, behaviour, constraints, acceptance for one feature |

Load the guidelines every session. Load **one** feature document for the approved outcome. Do not dump the whole `docs/` tree into context.

## Current features

| ID | Feature | Document | Status | What it does |
| --- | --- | --- | --- | --- |
| `library` | Library | [features/library.md](features/library.md) | active | Browse, create, import, and remove books; cover-led shelf |
| `manuscript-editing` | Manuscript editing | [features/manuscript-editing.md](features/manuscript-editing.md) | active | Write chapters (WYSIWYG→Markdown), manage assets, edit details and order |
| `chapter-tags` | Chapter tags | [features/chapter-tags.md](features/chapter-tags.md) | active | Named free-text tags for a chapter “as of now”; open/delete without overwriting Latest |
| `package-exchange` | Package exchange | [features/package-exchange.md](features/package-exchange.md) | active | Upload and download Leanpub-shaped zips |
| `edition-build` | Edition build | [features/edition-build.md](features/edition-build.md) | active | Generate and download PDF and EPUB (default studio builder or explicit override) |
| `studio-settings` | Studio settings | [features/studio-settings.md](features/studio-settings.md) | active | Studio-wide light/dark mode; writing-area text color (localStorage) |
| `local-studio-host` | Local studio host | [features/local-studio-host.md](features/local-studio-host.md) | active | Detached Compose run; HTTPS via Caddy at books.localhost:17443; `make trust` for local CA |

## How to use this registry

1. Find the row that matches the change. If none matches, **stop** and add a feature document + registry row before coding.
2. Open that document. Treat Intent, User-facing behaviour, Feature description, and Acceptance criteria as pipeline inputs.
3. Keep the change inside that feature’s outcome. Do not silently widen scope across rows.
4. When the feature ships, changes, or is removed, update this table in the same change (`active` / `planned` / `retired`, or delete the row and file).

## Status values

- `active` — implemented and maintained; tests must stay green for its acceptance criteria.
- `planned` — document exists; no implementation claim yet.
- `retired` — no longer part of the product; keep the file only if historical context is still useful, otherwise delete it and remove the row.

## Feature document contract

Every file under [features/](features/) must contain, in order:

1. **Intent** — problem and hypothesis (human-owned).
2. **User-facing behaviour** — observable outcomes (BDD scenarios).
3. **Feature description** — musts, must nots, preferences, escalation triggers.
4. **Acceptance criteria** — pipeline-verifiable done definition.

Feature IDs use lowercase kebab-case matching the filename (`foo-bar` → `features/foo-bar.md`).
