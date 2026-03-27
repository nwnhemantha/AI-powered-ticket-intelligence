from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class TicketRecord:
    """Normalized representation of a JIRA ticket for storage in pgvector."""

    jira_key: str
    summary: str = ""
    description: str = ""
    resolution: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    issue_type: Optional[str] = None
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    labels: list[str] = field(default_factory=list)
    components: list[str] = field(default_factory=list)
    created_date: Optional[str] = None
    resolved_date: Optional[str] = None
    updated_date: Optional[str] = None
    comments: Optional[list] = None  # Can be JSONB or list of dicts
    raw_json: Optional[str] = None
    embedding_text: Optional[str] = None
    embedding: Optional[np.ndarray] = None

    def to_db_dict(self) -> dict:
        """Convert to a dict suitable for psycopg2 parameterized query."""
        return {
            "jira_key": self.jira_key,
            "summary": self.summary,
            "description": self.description,
            "resolution": self.resolution,
            "status": self.status,
            "priority": self.priority,
            "issue_type": self.issue_type,
            "assignee": self.assignee,
            "reporter": self.reporter,
            "labels": self.labels,
            "components": self.components,
            "created_date": self.created_date,
            "resolved_date": self.resolved_date,
            "updated_date": self.updated_date,
            "comments": self.comments or [],
            "raw_json": self.raw_json,
            "embedding_text": self.embedding_text,
            "embedding": self.embedding,
        }
