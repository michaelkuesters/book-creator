FROM python:3.12-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends pandoc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
COPY tests ./tests

RUN pip install --no-cache-dir -e ".[dev]"

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080

CMD ["uvicorn", "book_creator.app:app", "--host", "0.0.0.0", "--port", "8080"]
