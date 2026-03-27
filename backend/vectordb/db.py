import os
import numpy as np
import psycopg2
import psycopg2.extras
from pgvector.psycopg2 import register_vector

from vectordb.config import logger

# Get DATABASE_URL from environment
DATABASE_URL = os.environ.get(
    "VECTORDB_URL",
    "postgresql://vectordb:vectordb_pass@localhost:5432/jira_tickets",
)


def get_connection():
    """Get a psycopg2 connection with pgvector types registered."""
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn


def upsert_ticket(conn, ticket: dict) -> None:
    """Insert or update a single ticket (idempotent on jira_key)."""
    sql = """
        INSERT INTO tickets (
            jira_key, summary, description, resolution, status, priority,
            issue_type, assignee, reporter, labels, components,
            created_date, resolved_date, updated_date,
            comments, raw_json, embedding_text, embedding
        ) VALUES (
            %(jira_key)s, %(summary)s, %(description)s, %(resolution)s,
            %(status)s, %(priority)s, %(issue_type)s, %(assignee)s,
            %(reporter)s, %(labels)s, %(components)s,
            %(created_date)s, %(resolved_date)s, %(updated_date)s,
            %(comments)s, %(raw_json)s, %(embedding_text)s, %(embedding)s
        )
        ON CONFLICT (jira_key) DO UPDATE SET
            summary = EXCLUDED.summary,
            description = EXCLUDED.description,
            resolution = EXCLUDED.resolution,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            issue_type = EXCLUDED.issue_type,
            assignee = EXCLUDED.assignee,
            reporter = EXCLUDED.reporter,
            labels = EXCLUDED.labels,
            components = EXCLUDED.components,
            created_date = EXCLUDED.created_date,
            resolved_date = EXCLUDED.resolved_date,
            updated_date = EXCLUDED.updated_date,
            comments = EXCLUDED.comments,
            raw_json = EXCLUDED.raw_json,
            embedding_text = EXCLUDED.embedding_text,
            embedding = EXCLUDED.embedding;
    """
    with conn.cursor() as cur:
        cur.execute(sql, ticket)
    conn.commit()


def similarity_search(
    conn, query_embedding: np.ndarray, top_k: int = 5
) -> list[dict]:
    """Find the top-k most similar tickets by cosine similarity."""
    sql = """
        SELECT jira_key, summary, description, resolution, status, priority,
               comments, 1 - (embedding <=> %s) AS similarity
        FROM tickets
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> %s
        LIMIT %s;
    """
    with conn.cursor() as cur:
        cur.execute(sql, (query_embedding, query_embedding, top_k))
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
