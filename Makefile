IMAGE ?= book-creator
COMPOSE ?= docker compose

.PHONY: build test run

build:
	$(COMPOSE) build

test: build
	$(COMPOSE) run --rm --no-deps -e DATA_DIR=/tmp/book-creator-test studio pytest -q

run:
	$(COMPOSE) up --build
