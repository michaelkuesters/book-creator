from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_caddyfile_serves_books_localhost_on_dedicated_port():
    text = (ROOT / "Caddyfile").read_text(encoding="utf-8")
    assert "https://books.localhost:17443" in text
    assert "tls internal" in text
    assert "reverse_proxy studio:8080" in text
    assert "acme" not in text.lower()
    assert "letsencrypt" not in text.lower()


def test_compose_publishes_only_dedicated_loopback_port():
    text = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    assert "caddy:" in text
    assert "127.0.0.1:17443:17443" in text
    assert "127.0.0.1:80:80" not in text
    assert "127.0.0.1:443:443" not in text
    assert "127.0.0.1:8080:8080" not in text
    assert "./Caddyfile:/etc/caddy/Caddyfile:ro" in text


def test_makefile_run_is_detached_and_stop_exists():
    text = (ROOT / "Makefile").read_text(encoding="utf-8")
    assert "up --build -d" in text
    assert "Studio: https://books.localhost:17443" in text
    assert "make trust" in text
    assert "down" in text
    assert "stop:" in text


def test_makefile_new_runs_test_then_run():
    text = (ROOT / "Makefile").read_text(encoding="utf-8")
    assert "new: test" in text
    assert "$(MAKE) run" in text


def test_makefile_trust_exports_and_installs_caddy_root_ca():
    text = (ROOT / "Makefile").read_text(encoding="utf-8")
    assert "trust:" in text
    assert "/data/caddy/pki/authorities/local/root.crt" in text
    assert ".caddy-local-root.crt" in text
    assert "scripts/trust-caddy-ca.sh" in text
    script = (ROOT / "scripts" / "trust-caddy-ca.sh").read_text(encoding="utf-8")
    assert "certutil" in script
    assert "security add-trusted-cert" in script
    assert "update-ca-certificates" in script
