"""
Programmatic ingestion API for JIRA tickets.

This module provides a clean programmatic interface for ingesting tickets
from JSON/CSV data into the pgvector database.
"""

import json
import logging
from typing import Any

from vectordb.parsers import get_parser
from vectordb.embeddings import build_embedding_text, generate_embeddings, truncate_text
from vectordb.db import get_connection, upsert_ticket

logger = logging.getLogger(__name__)


def ingest_from_data(
    tickets: list[dict[str, Any]],
    format_type: str = "json",
    template: str | None = None
) -> dict[str, Any]:
    """
    Ingest tickets from parsed data (not files).

    Args:
        tickets: List of ticket dictionaries (already parsed)
        format_type: Format type hint ("json" or "csv") - used for parser selection
        template: Optional template for embedding text (e.g., "{summary} {description}")

    Returns:
        Dictionary with ingestion results:
        {
            "ingested": int,
            "skipped": int,
            "errors": list[str]
        }
    """
    result = {
        "ingested": 0,
        "skipped": 0,
        "errors": []
    }

    if not tickets:
        result["errors"].append("No tickets provided")
        return result

    logger.info(f"Starting ingestion of {len(tickets)} tickets")

    try:
        # Parse tickets using appropriate parser
        parser = get_parser(format_type)
        parsed_tickets = parser.parse(tickets)

        if not parsed_tickets:
            result["errors"].append("No valid tickets after parsing")
            return result

        # Build embedding text for each ticket
        texts: list[str] = []
        valid_tickets: list[dict] = []

        for ticket in parsed_tickets:
            try:
                text = build_embedding_text(ticket, template=template)
                if text:
                    text = truncate_text(text)
                    ticket["embedding_text"] = text
                    texts.append(text)
                    valid_tickets.append(ticket)
                else:
                    logger.warning(
                        f"Skipping {ticket.get('jira_key', '?')}: no embeddable text"
                    )
                    result["skipped"] += 1
            except Exception as e:
                logger.error(f"Error processing ticket {ticket.get('jira_key', '?')}: {e}")
                result["skipped"] += 1
                result["errors"].append(f"{ticket.get('jira_key', '?')}: {str(e)}")

        if not valid_tickets:
            result["errors"].append("No tickets have embeddable text")
            return result

        logger.info(
            f"{len(valid_tickets)} tickets have embeddable text "
            f"({result['skipped']} skipped)"
        )

        # Generate embeddings in batch
        logger.info("Generating embeddings...")
        embeddings = generate_embeddings(texts)
        logger.info(f"Generated {len(embeddings)} embeddings")

        # Insert into database
        logger.info("Connecting to database...")
        conn = get_connection()

        try:
            for ticket, embedding in zip(valid_tickets, embeddings):
                try:
                    # Prepare ticket for database
                    ticket["embedding"] = embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding)

                    # Serialize JSON fields as strings
                    ticket["raw_json"] = json.dumps(ticket.pop("_raw", {}))
                    ticket["comments"] = json.dumps(ticket.get("comments", []))

                    # Ensure array fields are lists of strings
                    ticket["labels"] = list(ticket.get("labels", []))
                    ticket["components"] = list(ticket.get("components", []))

                    # embedding_text should already be set, keep it for database
                    # Don't remove it - it's needed for the INSERT

                    # Debug: Check for dict values in ticket
                    for key, value in ticket.items():
                        if isinstance(value, dict):
                            logger.error(f"Found dict in ticket['{key}']: {type(value)} = {value}")

                    upsert_ticket(conn, ticket)
                    result["ingested"] += 1

                    if result["ingested"] % 50 == 0:
                        logger.info(f"  Ingested {result['ingested']}/{len(valid_tickets)}")

                except Exception as e:
                    logger.error(f"Error inserting ticket {ticket.get('jira_key', '?')}: {e}")
                    result["errors"].append(f"{ticket.get('jira_key', '?')}: {str(e)}")

            conn.commit()
            logger.info(f"Successfully ingested {result['ingested']} tickets into the database")

        finally:
            conn.close()

    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        result["errors"].append(f"Ingestion failed: {str(e)}")

    return result


def ingest_from_json_file(file_path: str, template: str | None = None) -> dict[str, Any]:
    """
    Ingest tickets from a JSON file.

    Args:
        file_path: Path to JSON file
        template: Optional template for embedding text

    Returns:
        Ingestion results dictionary
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Handle both single ticket dict and list of tickets
    tickets = data if isinstance(data, list) else [data]

    return ingest_from_data(tickets, format_type="json", template=template)


def ingest_from_csv_file(file_path: str, template: str | None = None) -> dict[str, Any]:
    """
    Ingest tickets from a CSV file.

    Args:
        file_path: Path to CSV file
        template: Optional template for embedding text

    Returns:
        Ingestion results dictionary
    """
    # CSV parser reads directly from file path
    parser = get_parser("csv")
    tickets = parser.parse(file_path)

    return ingest_from_data(tickets, format_type="csv", template=template)
