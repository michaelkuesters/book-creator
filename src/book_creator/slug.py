from __future__ import annotations

import re


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    cleaned = re.sub(r"[-\s]+", "_", cleaned.strip())
    return cleaned or "book"
