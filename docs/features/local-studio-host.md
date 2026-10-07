# Local studio host

## Intent

Operators need a stable local URL for the studio and a run mode that does not tie up a terminal—without exposing the app beyond the machine or colliding with other local apps’ ports.

**Hypothesis:** We believe HTTPS on `books.localhost` via Caddy on a Book Creator–specific loopback port, with Compose running detached, will feel like a normal local service while staying single-user and clash-resistant.

## User-facing behaviour

```gherkin
Scenario: Start the studio
  Given Docker is available
  When the operator runs make run
  Then the studio containers start in the background
  And the operator can close the terminal without stopping the studio

Scenario: Build, test, and start in one go
  Given Docker is available
  When the operator runs make new
  Then the studio image is built
  And the test suite runs
  And if tests pass the studio starts detached

Scenario: Open the studio over HTTPS
  Given the studio is running
  When the operator opens https://books.localhost:17443
  Then the Book Creator UI is served
  And traffic reaches the studio only through the local reverse proxy

Scenario: Trust the local Caddy CA
  Given the studio is running
  When the operator runs make trust
  Then Caddy’s local root CA is installed in the OS trust store
  And a restarted browser shows https://books.localhost:17443 as trusted

Scenario: Stop the studio
  Given the studio is running detached
  When the operator runs make stop
  Then the studio containers stop
```

## Feature description

### Musts

- `make run` builds (if needed) and starts Compose services **detached** (`docker compose up --build -d`).
- `make new` runs `build`, then `test`, then `run` in one go (does not start the studio if tests fail).
- `make stop` stops the Compose stack (`docker compose down`).
- `make trust` (stack already up) exports Caddy’s local root CA and installs it into the OS trust store once per machine.
- `make run` prints the HTTPS URL and a one-line hint to run `make trust` if the browser warns.
- Caddy terminates TLS for `books.localhost` with an internal local CA and reverse-proxies to the studio container.
- The only host-published port is `127.0.0.1:17443` (HTTPS). The studio app port is not published on the host.
- Must not bind host ports `80`, `443`, or `8080` (common local-app defaults).
- Primary operator URL is `https://books.localhost:17443`.
- Process docs (`DEVELOPMENT-GUIDELINES.md` Commands) name `make run` / `make new` / `make stop` / `make trust` and that HTTPS URL.

### Must nots

- Must not require login or any cloud account.
- Must not publish the studio beyond localhost.
- Must not claim well-known ports that other local stacks commonly need (`80`, `443`, `8080`).
- Must not use public ACME or Let’s Encrypt for `books.localhost` (not publicly attestible).
- Must not invent extra Make targets beyond what this feature requires (`run`, `new`, `stop`, `trust`, plus existing `build` / `test`).

### Preferences

- Prefer Caddy’s `tls internal` for local HTTPS over checking secrets or public ACME into git.
- Prefer a single dedicated high port (`17443`) over stealing default HTTPS.

### Escalation

- If the browser distrusts the local Caddy CA, the operator runs `make trust` once per machine (may need elevation), then restarts the browser.
- If `*.localhost` does not resolve on an unusual host, the operator adds a hosts entry for `books.localhost` → `127.0.0.1`.
- If `17443` is already taken on this machine, stop and change the documented port in this feature (and matching Compose/Caddyfile/docs) rather than silently overlapping another app.

## Acceptance criteria

1. `compose.yaml` defines a Caddy service that proxies to the studio and publishes only `127.0.0.1:17443` (no host `80`/`443`/`8080`).
2. A repo `Caddyfile` serves `books.localhost` on `17443` with `tls internal` and reverse-proxies to the studio service (no public ACME).
3. `make run` uses detached Compose up and prints `https://books.localhost:17443` plus a `make trust` hint; `make stop` brings the stack down.
4. `make new` invokes `test` then `run` (so build → test → run); a failing test suite must not start the studio.
5. `make trust` copies Caddy’s local root CA from the running container and installs it into the OS trust store.
6. Covered by `tests/test_local_studio_host.py` for Compose/Caddyfile/`Makefile` contracts.
