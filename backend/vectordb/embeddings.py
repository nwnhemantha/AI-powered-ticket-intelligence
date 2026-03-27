from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer

from vectordb.config import (
    EMBEDDING_MODEL,
    EMBEDDING_BATCH_SIZE,
    logger,
)

# Lazy-loaded model singleton
_model: SentenceTransformer | None = None

DEFAULT_TEMPLATE = "Summary: {summary}\nDescription: {description}\nComments: {comments}\nResolution: {resolution}"


def _get_model() -> SentenceTransformer:
    """Load the sentence-transformers model (downloaded on first use)."""
    global _model
    if _model is None:
        logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
        _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model


def _flatten_comments(comments: Any) -> str:
    """Convert a JSONB comments list to plain text for embedding."""
    if not comments or not isinstance(comments, list):
        return ""
    parts = []
    for c in comments:
        if isinstance(c, dict) and c.get("body"):
            author = c.get("author", "Unknown")
            parts.append(f"{author}: {c['body']}")
    return "\n".join(parts)


def build_embedding_text(
    ticket: dict[str, Any], template: str | None = None
) -> str | None:
    """Build the text to embed from a ticket dict.

    Returns None if the result is empty (nothing to embed).
    """
    tmpl = template or DEFAULT_TEMPLATE
    # Flatten structured comments into text for embedding
    data = _SafeDict(ticket)
    if isinstance(data.get("comments"), list):
        data["comments"] = _flatten_comments(data["comments"])
    text = tmpl.format_map(data)
    # Strip and collapse whitespace
    text = " ".join(text.split())
    return text if text.strip() else None


def truncate_text(text: str, max_tokens: int | None = None) -> str:
    """Truncate text to fit within the model's max sequence length."""
    model = _get_model()
    limit = max_tokens or model.max_seq_length
    tokenizer = model.tokenizer
    tokens = tokenizer.encode(text, add_special_tokens=False)
    if len(tokens) <= limit:
        return text
    logger.warning(
        f"Truncating text from {len(tokens)} to {limit} tokens"
    )
    return tokenizer.decode(tokens[:limit], skip_special_tokens=True)


def generate_embeddings(texts: list[str]) -> list[np.ndarray]:
    """Generate embeddings for a list of texts using the local model."""
    model = _get_model()
    all_embeddings: list[np.ndarray] = []
    total_batches = (len(texts) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE

    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i : i + EMBEDDING_BATCH_SIZE]
        batch_num = i // EMBEDDING_BATCH_SIZE + 1
        logger.info(f"Embedding batch {batch_num}/{total_batches} ({len(batch)} texts)")

        vectors = model.encode(batch, show_progress_bar=False)
        for v in vectors:
            all_embeddings.append(np.array(v, dtype=np.float32))

    return all_embeddings


class _SafeDict(dict):
    """Dict subclass that returns empty string for missing keys in format_map."""

    def __missing__(self, key: str) -> str:
        return ""
