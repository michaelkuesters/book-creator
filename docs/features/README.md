# Feature library

This is the authoritative catalogue of Book Creator product features. Agents and humans use it to find which feature document governs the next change. Do not invent features that are not listed here.

System-wide rules stay in [../DEVELOPMENT-GUIDELINES.md](../DEVELOPMENT-GUIDELINES.md). Load that file always. Load only the one feature document needed for the approved outcome.

## Current features

| ID | Feature | Document | Status | Outcome |
| --- | --- | --- | --- | --- |
| library | Library | [library.md](library.md) | active | Operators browse, create, import, and remove books |
| manuscript-editing | Manuscript editing | [manuscript-editing.md](manuscript-editing.md) | active | Operators write chapters, manage assets, and edit details |
| package-exchange | Package exchange | [package-exchange.md](package-exchange.md) | active | Operators upload and download Leanpub-shaped zips |
| edition-build | Edition build | [edition-build.md](edition-build.md) | active | Operators generate and download PDF and EPUB |

## How to use this library

1. Find the row that matches the change. If none matches, stop and add a feature before coding.
2. Open that document. Treat its Intent, User-facing behaviour, Feature description, and Acceptance criteria as pipeline inputs.
3. Keep the change inside that feature’s outcome. Do not silently widen scope across rows.
4. When the feature is finished or removed, update this table in the same change (add, set status to `retired`, or delete the row and file).

## Status values

- `active` — implemented and maintained; tests must stay green for its acceptance criteria.
- `planned` — document exists; no implementation claim yet.
- `retired` — no longer part of the product; keep the file only if historical context is still useful, otherwise delete it and remove the row.

## Document contract

Every feature document in this folder must contain, in order:

1. **Intent** — problem and hypothesis (human-owned).
2. **User-facing behaviour** — observable outcomes (BDD scenarios).
3. **Feature description** — musts, must nots, preferences, escalation triggers.
4. **Acceptance criteria** — pipeline-verifiable done definition.

New feature IDs use lowercase kebab-case matching the filename (`foo-bar` → `foo-bar.md`).
