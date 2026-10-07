# Claude

Follow the same process as [AGENTS.md](AGENTS.md).

**Always load** [docs/DEVELOPMENT-GUIDELINES.md](docs/DEVELOPMENT-GUIDELINES.md) before making changes.

**Route work** through [docs/feature-registry.md](docs/feature-registry.md), then open exactly one matching `docs/features/<id>.md`.

Humans own intent. The test suite (`make test`) is the delivery verdict. Do not weaken tests to match incorrect implementation. Do not invent features or pipeline steps that are not in the docs.
