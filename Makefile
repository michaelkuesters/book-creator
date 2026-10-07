IMAGE ?= book-creator
COMPOSE ?= docker compose
CA_EXPORT ?= .caddy-local-root.crt
CA_IN_CONTAINER ?= /data/caddy/pki/authorities/local/root.crt

.PHONY: build test run new stop trust

build:
	$(COMPOSE) build

test: build
	$(COMPOSE) run --rm --no-deps -e DATA_DIR=/tmp/book-creator-test studio pytest -q

run:
	$(COMPOSE) up --build -d
	@echo "Studio: https://books.localhost:17443"
	@echo "If the browser warns Not secure, run: make trust"

new: test
	$(MAKE) run

stop:
	$(COMPOSE) down

trust:
	MSYS_NO_PATHCONV=1 $(COMPOSE) cp caddy:$(CA_IN_CONTAINER) $(CA_EXPORT)
	@sh scripts/trust-caddy-ca.sh $(CA_EXPORT)
