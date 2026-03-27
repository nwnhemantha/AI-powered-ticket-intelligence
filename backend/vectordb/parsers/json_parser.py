from typing import Any

from vectordb.parsers.base import TicketParser


def _safe_get(obj: Any, *keys: str, default: Any = None) -> Any:
    """Safely navigate nested dicts."""
    current = obj
    for key in keys:
        if current is None or not isinstance(current, dict):
            return default
        current = current.get(key)
    return current if current is not None else default


def _extract_adf_text(adf: Any) -> str:
    """Extract plain text from Atlassian Document Format (ADF)."""
    if isinstance(adf, str):
        return adf
    if not isinstance(adf, dict):
        return ""

    # ADF structure has a 'content' array
    content = adf.get('content', [])
    if not isinstance(content, list):
        return ""

    text_parts = []
    for node in content:
        if not isinstance(node, dict):
            continue

        # Extract text from this node
        node_type = node.get('type')
        if node_type == 'text':
            text_parts.append(node.get('text', ''))
        elif node_type in ('paragraph', 'listItem', 'bulletList', 'orderedList'):
            # Recursively extract text from nested content
            nested_text = _extract_adf_text(node)
            if nested_text:
                text_parts.append(nested_text)

        # Check for nested content array
        if 'content' in node:
            nested_text = _extract_adf_text(node)
            if nested_text:
                text_parts.append(nested_text)

    return ' '.join(text_parts)


class JiraJsonParser(TicketParser):
    """Parse JIRA JSON data (REST API format or flat dict format)."""

    def parse(self, data: Any) -> list[dict[str, Any]]:
        """Parse ticket data from JSON objects."""
        if isinstance(data, dict):
            # Single ticket
            tickets = [data]
        elif isinstance(data, list):
            # List of tickets
            tickets = data
        else:
            raise ValueError(f"Expected dict or list, got {type(data)}")

        result = []
        for item in tickets:
            # Check if fields are nested (Jira REST API format)
            fields = item.get("fields", item)

            # Extract ticket data
            ticket = {
                "jira_key": item.get("key", ""),
                "summary": fields.get("summary", "") or "",
                "description": _extract_adf_text(fields.get("description", "")) or "",
                "resolution": _safe_get(fields, "resolution", "name") or "",
                "status": _safe_get(fields, "status", "name") or "",
                "priority": _safe_get(fields, "priority", "name") or "",
                "issue_type": _safe_get(fields, "issuetype", "name") or "",
                "assignee": _safe_get(fields, "assignee", "displayName") or "",
                "reporter": _safe_get(fields, "reporter", "displayName") or "",
                "labels": fields.get("labels", []) if isinstance(fields.get("labels"), list) else [],
                "components": [c.get("name", "") for c in fields.get("components", []) if isinstance(c, dict)],
                "created_date": fields.get("created"),
                "resolved_date": fields.get("resolutiondate"),
                "updated_date": fields.get("updated"),
                "comments": [],  # Comments handling can be added later if needed
                "_raw": item,  # Store original ticket for raw_json field
            }

            result.append(ticket)

        return result
