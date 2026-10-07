# Agents

You are working in **Book Creator**, an Agentic Continuous Delivery (ACD) repository.

## Mandatory process

1. **Read and follow** [docs/DEVELOPMENT-GUIDELINES.md](docs/DEVELOPMENT-GUIDELINES.md) for every session. That file is the process core. Do not skip it.
2. **Find the feature** in [docs/feature-registry.md](docs/feature-registry.md). Open only that feature’s document under `docs/features/` for the approved outcome.
3. Treat feature Intent → behaviour → description → acceptance criteria as higher authority than existing code. Change code to match docs; do not weaken tests to match wrong code.
4. One feature outcome per change. Update the registry when you add or retire a feature.
5. Verify with `make test`. A red suite means the change is not done.
6. Do not invent Make targets, deploy, or leave process knowledge only in chat.

## Do not

- Redefine artifact authority or invent undocumented features.
- Load the entire `docs/` tree into context.
- Put manuscripts or secrets into git.
- Hand-edit a repo `dist/` folder.
