"""
Standalone script to generate embeddings for search queries.
Accepts JSON input via stdin and outputs embedding as JSON array to stdout.

Usage:
    echo '{"query": "Login fails after password reset"}' | python -m vectordb.embed_query
"""

import json
import sys
from vectordb.embeddings import generate_embeddings


def main():
    try:
        # Read input from stdin
        input_data = json.load(sys.stdin)
        query = input_data.get("query", "").strip()

        if not query:
            print(json.dumps({"error": "Empty query"}), file=sys.stderr)
            sys.exit(1)

        # Generate embedding for the query
        embeddings = generate_embeddings([query])

        # Output as JSON array
        print(json.dumps(embeddings[0].tolist()))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
