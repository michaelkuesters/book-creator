FROM python:3.12-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends pandoc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency metadata only — reuse this layer until pyproject.toml changes
COPY pyproject.toml README.md ./
RUN python -c "import pathlib, tomllib; \
p = tomllib.loads(pathlib.Path('pyproject.toml').read_text()); \
deps = p['project']['dependencies'] + p['project']['optional-dependencies']['dev']; \
pathlib.Path('/tmp/requirements.txt').write_text('\\n'.join(deps))" \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# App + test contract files change often; deps stay cached
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY Makefile Caddyfile compose.yaml ./
RUN pip install --no-cache-dir --no-deps -e .

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080

CMD ["uvicorn", "book_creator.app:app", "--host", "0.0.0.0", "--port", "8080"]
