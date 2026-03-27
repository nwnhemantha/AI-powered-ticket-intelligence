# VectorDB Module

Embedded Python module for ticket ingestion and semantic search using pgvector.

## Overview

This module provides:
- **Ticket Ingestion**: Parse and embed JIRA tickets into PostgreSQL with pgvector
- **Query Embedding**: Generate embeddings for search queries
- **Similarity Search**: Find semantically similar tickets (handled by vectorSearch.js)

## Architecture

```
Node.js Backend
    ├── vectorSearch.js  → Spawns embed_query.py for search
    ├── vectorIngest.js  → Spawns ingest_api.py for ingestion
    └── vectordb/
        ├── embeddings.py      → Core embedding generation (sentence-transformers)
        ├── embed_query.py     → Standalone query embedding script
        ├── ingest.py          → Programmatic ingestion API
        ├── ingest_api.py      → stdin/stdout wrapper for Node.js
        ├── db.py              → PostgreSQL + pgvector operations
        ├── models.py          → TicketRecord dataclass
        ├── parsers/           → JSON and CSV parsers
        └── config.py          → Configuration
```

## Dependencies

All Python dependencies are in `requirements.txt`:
- **torch** (CPU-only): PyTorch for neural networks
- **sentence-transformers**: Pre-trained embedding models
- **psycopg2-binary**: PostgreSQL database adapter
- **pgvector**: Vector similarity extension for PostgreSQL
- **pandas**: CSV parsing (optional)
- **numpy**: Numerical operations

## Embedding Model

- **Model**: `all-MiniLM-L6-v2` (384 dimensions)
- **Pre-downloaded**: Model is cached during Docker build
- **CPU-only**: No GPU required, ~100ms per query

## Ingestion API

### Programmatic Usage (Python)

```python
from vectordb.ingest import ingest_from_data

tickets = [
    {
        "jira_key": "PROJ-123",
        "summary": "Login fails after password reset",
        "description": "Users cannot login...",
        "status": "Open",
        "priority": "High",
        # ... other fields
    }
]

result = ingest_from_data(tickets, format_type="json")
print(f"Ingested: {result['ingested']}, Skipped: {result['skipped']}")
```

### Command-line Usage (stdin/stdout)

```bash
echo '{"tickets": [...]}' | python -m vectordb.ingest_api
# Output: {"ingested": 10, "skipped": 0, "errors": []}
```

### REST API Usage (via Node.js)

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "tickets": [
      {
        "key": "PROJ-123",
        "fields": {
          "summary": "Login fails",
          "description": "Cannot login after password reset",
          "status": {"name": "Open"},
          "priority": {"name": "High"}
        }
      }
    ]
  }'

# Response:
# {
#   "success": true,
#   "ingested": 1,
#   "skipped": 0,
#   "message": "Successfully ingested 1 tickets"
# }
```

## Ticket Schema

### Input Format (Jira REST API format)

```json
{
  "key": "PROJ-123",
  "fields": {
    "summary": "string",
    "description": "string",
    "status": {"name": "Open"},
    "priority": {"name": "High"},
    "issuetype": {"name": "Bug"},
    "assignee": {"displayName": "John Doe"},
    "reporter": {"displayName": "Jane Smith"},
    "resolution": {"name": "Fixed"},
    "labels": ["bug", "ui"],
    "components": [{"name": "Frontend"}],
    "created": "2025-01-15T10:00:00.000Z",
    "resolutiondate": "2025-01-20T15:30:00.000Z",
    "updated": "2025-01-20T15:30:00.000Z"
  }
}
```

### Database Schema

```sql
CREATE TABLE tickets (
    jira_key VARCHAR PRIMARY KEY,
    summary TEXT,
    description TEXT,
    resolution TEXT,
    status VARCHAR,
    priority VARCHAR,
    issue_type VARCHAR,
    assignee VARCHAR,
    reporter VARCHAR,
    labels TEXT[],
    components TEXT[],
    comments JSONB,
    raw_json JSONB,
    created_date TIMESTAMP,
    resolved_date TIMESTAMP,
    updated_date TIMESTAMP,
    embedding vector(384)
);
```

## Embedding Text Template

By default, tickets are embedded using this template:

```
Summary: {summary}
Description: {description}
Comments: {comments}
Resolution: {resolution}
```

You can customize the template:

```javascript
// Node.js
await vectorIngest.ingestTickets(tickets, {
  template: "{summary} {description} {labels}"
});
```

```python
# Python
ingest_from_data(tickets, template="{summary} - {status}")
```

## Parsers

### JSON Parser (`parsers/json_parser.py`)

Handles:
- Single ticket object or array of tickets
- Nested "fields" structure (Jira REST API format)
- Flat structure (custom format)

### CSV Parser (`parsers/csv_parser.py`)

Maps common Jira CSV export columns:
- `Issue key` → `jira_key`
- `Summary` → `summary`
- `Description` → `description`
- `Status` → `status`
- `Priority` → `priority`
- etc.

## Error Handling

Ingestion is designed to be resilient:
- **Partial failures**: If some tickets fail, others still get ingested
- **Idempotent**: Re-ingesting the same ticket (by `jira_key`) updates it
- **Missing fields**: Handled gracefully with defaults
- **Invalid embeddings**: Tickets with no embeddable text are skipped

Result structure:
```json
{
  "ingested": 8,
  "skipped": 2,
  "errors": [
    "PROJ-123: Invalid field format",
    "PROJ-456: Missing required field 'jira_key'"
  ]
}
```

## Configuration

Environment variables (set in `.env` or docker-compose):

```env
# Database connection
VECTORDB_URL=postgresql://vectordb:vectordb_pass@localhost:5432/jira_tickets

# Python module path (for spawning subprocesses)
VECTORDB_PYTHON_PATH=/app/vectordb  # Docker
VECTORDB_PYTHON_PATH=c:\Repos\...\backend\vectordb  # Windows

# Optional: Customize embedding model
EMBEDDING_MODEL=all-MiniLM-L6-v2  # Default
EMBEDDING_DIMENSIONS=384           # Default
EMBEDDING_BATCH_SIZE=64            # Default

# Logging
LOG_LEVEL=INFO
```

## Testing

### 1. Test Python Module Directly

```bash
cd backend/vectordb

# Test ingestion
python -c "
from ingest import ingest_from_data
tickets = [{'jira_key': 'TEST-1', 'summary': 'Test ticket', 'description': 'Testing'}]
result = ingest_from_data(tickets)
print(result)
"
```

### 2. Test via stdin/stdout Wrapper

```bash
cd backend/vectordb

echo '{
  "tickets": [
    {"jira_key": "TEST-2", "summary": "Another test", "description": "Testing ingestion"}
  ]
}' | python -m ingest_api
```

### 3. Test REST API

```bash
# Start backend
cd backend
docker-compose up -d

# Test ingestion
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "tickets": [
      {
        "key": "TEST-3",
        "fields": {
          "summary": "REST API test",
          "description": "Testing via HTTP endpoint"
        }
      }
    ]
  }'

# Verify in database
docker-compose exec db psql -U vectordb -d jira_tickets \
  -c "SELECT jira_key, summary FROM tickets WHERE jira_key LIKE 'TEST-%';"

# Test vector search with ingested data
curl -X POST http://localhost:3000/api/vector-search \
  -H "Content-Type: application/json" \
  -d '{"supportText":"testing ingestion"}'
```

## Development

### Adding New Parsers

1. Create parser in `parsers/` directory:
   ```python
   from vectordb.parsers.base import TicketParser

   class MyParser(TicketParser):
       def parse(self, data):
           # Return list of ticket dicts
           return [...]
   ```

2. Register in `parsers/__init__.py`:
   ```python
   def get_parser(format_type: str):
       if format_type == "myformat":
           return MyParser()
   ```

### Modifying Embedding Template

Edit `embeddings.py`:
```python
DEFAULT_TEMPLATE = "Summary: {summary}\nDescription: {description}"
```

### Customizing Database Schema

1. Update SQL in VectorDB project's `init.sql`
2. Update `db.py` `upsert_ticket()` function
3. Update `models.py` `TicketRecord` dataclass
4. Update parsers to handle new fields

## Troubleshooting

### "Module 'vectordb' not found"

- Ensure you're running from the correct directory
- Check `PYTHONPATH` or use `python -m` notation
- In Docker: verify `/app/vectordb` is mounted

### "Could not connect to database"

- Check `VECTORDB_URL` environment variable
- Verify PostgreSQL is running: `docker-compose ps`
- Test connection: `docker-compose exec db psql -U vectordb -d jira_tickets`

### "pgvector extension not found"

- Ensure you're using `pgvector/pgvector` Docker image
- Check if extension is enabled: `SELECT * FROM pg_extension WHERE extname='vector';`

### "Sentence-transformers model download fails"

- Model is pre-downloaded during Docker build
- For manual download: `python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"`
- Check network connectivity

### "Ingestion is slow"

- **Embedding generation**: ~100ms per ticket (batched)
- **Database writes**: Batched, ~1000 tickets/second
- For large ingestions (>10k tickets): Consider increasing `EMBEDDING_BATCH_SIZE`

## Performance

### Benchmarks

- **Query embedding**: ~100ms (single query)
- **Batch embedding**: ~50 tickets/second
- **Database insert**: ~1000 tickets/second (upsert)
- **Similarity search**: ~50ms (10k tickets)

### Scaling Considerations

- **Large datasets**: pgvector handles 100k+ vectors efficiently
- **Concurrent requests**: Use connection pooling (pg.Pool)
- **Memory**: ~2GB for model + ~1GB per 100k embeddings
- **CPU**: 2-4 cores recommended for production

## License

Internal use only.
