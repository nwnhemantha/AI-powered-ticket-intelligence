"""
API wrapper for ingestion - reads tickets from stdin, outputs result to stdout.

This script provides a stdin/stdout interface for Node.js to call the Python
ingestion logic. It accepts JSON via stdin and returns the result as JSON to stdout.

Usage:
    echo '{"tickets": [...]}' | python -m vectordb.ingest_api
    echo '{"tickets": [...], "format": "json", "template": "..."}' | python -m vectordb.ingest_api
"""

import json
import sys
import logging

# Configure logging to stderr so it doesn't interfere with stdout JSON
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
    stream=sys.stderr
)

from vectordb.ingest import ingest_from_data


def main():
    """Main entry point for stdin/stdout ingestion API."""
    try:
        # Read input from stdin
        input_data = json.load(sys.stdin)

        # Extract parameters
        tickets = input_data.get("tickets", [])
        format_type = input_data.get("format", "json")
        template = input_data.get("template")

        if not tickets:
            error_result = {
                "ingested": 0,
                "skipped": 0,
                "errors": ["No tickets provided in input"]
            }
            print(json.dumps(error_result))
            sys.exit(1)

        # Perform ingestion
        result = ingest_from_data(tickets, format_type=format_type, template=template)

        # Output result as JSON to stdout
        print(json.dumps(result))

        # Exit with non-zero code if there were errors
        if result["errors"]:
            sys.exit(1)

    except json.JSONDecodeError as e:
        error_result = {
            "ingested": 0,
            "skipped": 0,
            "errors": [f"Invalid JSON input: {str(e)}"]
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)

    except Exception as e:
        error_result = {
            "ingested": 0,
            "skipped": 0,
            "errors": [f"Ingestion failed: {str(e)}"]
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
