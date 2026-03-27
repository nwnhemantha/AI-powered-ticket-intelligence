# Docker Deployment Guide

This backend now includes an embedded VectorDB module and can run entirely in Docker with PostgreSQL.

## Quick Start

### 1. Start Everything with Docker Compose

```bash
cd backend

# Start both database and backend
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop everything
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

### 2. Environment Variables

Create a `.env` file or export these variables:

```bash
export ATLASSIAN_CLIENT_ID=your-client-id
export ATLASSIAN_CLIENT_SECRET=your-client-secret
```

Or use the existing `.env` file - docker-compose will read it automatically.

### 3. Wait for Services to Start

The backend waits for PostgreSQL to be healthy before starting. This takes about 10-20 seconds on first run.

```bash
# Check status
docker-compose ps

# Wait for healthy status
docker-compose logs -f
```

### 4. Test the Vector Search Endpoint

```bash
# Test vector search
curl -X POST http://localhost:3000/api/vector-search \
  -H "Content-Type: application/json" \
  -d '{"supportText":"Login fails after password reset"}'
```

## Build Performance

### Expected Build Times

- **First build (clean):** 5-10 minutes
- **Rebuild after code changes:** 10-20 seconds
- **Rebuild after dependency changes:** 2-4 minutes

### CPU-Only PyTorch

This project uses **CPU-only PyTorch** for embedding generation. The `requirements.txt` file specifies the CPU wheel index to prevent downloading 300+ MB of unnecessary CUDA packages.

```bash
# The requirements.txt uses this index:
--index-url https://download.pytorch.org/whl/cpu
```

This is intentional and provides identical functionality for our use case since:
- The container runs on CPU (no GPU hardware)
- Embedding generation is fast enough on CPU (~100ms per query)
- Image size is reduced from ~1.8GB to ~800MB

### Fast Builds with BuildKit

Use Docker BuildKit for better caching and parallel processing:

```bash
# Enable BuildKit
DOCKER_BUILDKIT=1 docker-compose build

# Or export it permanently
export DOCKER_BUILDKIT=1
```

### Troubleshooting Slow Builds

If builds are taking longer than 10 minutes:

1. **Check if CUDA packages are being downloaded:**
   ```bash
   docker-compose logs | grep "nvidia-cudnn"
   ```
   If you see nvidia-cudnn, the CPU-only PyTorch isn't being used correctly.

2. **Clear build cache and rebuild:**
   ```bash
   docker-compose down -v
   docker system prune -af
   DOCKER_BUILDKIT=1 docker-compose build
   ```

3. **Verify requirements.txt has CPU index:**
   ```bash
   cat vectordb/requirements.txt | head -n 5
   ```
   Should show: `--index-url https://download.pytorch.org/whl/cpu`

## Development Workflow

### Hot Reload Enabled

The docker-compose mounts your source code, so changes to these files are reflected immediately:
- `server.js`
- `vectorSearch.js`
- `vectordb/*.py`

Just edit and save - the server will auto-restart.

### Access the Database

```bash
# Connect to PostgreSQL
docker-compose exec db psql -U vectordb -d jira_tickets

# Run queries
SELECT COUNT(*) FROM tickets;
SELECT jira_key, summary FROM tickets LIMIT 5;
```

### Ingest Sample Data

The backend now includes a built-in ingestion API - no need for the external VectorDB project!

```bash
# Option 1: Use the test script (recommended)
cd backend
./test-ingestion.bat  # Windows
# or
./test-ingestion.sh   # Linux/Mac

# Option 2: Manual API call
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "tickets": [
      {
        "key": "PROJ-123",
        "fields": {
          "summary": "Login fails",
          "description": "User cannot login after password reset",
          "status": {"name": "Open"},
          "priority": {"name": "High"}
        }
      }
    ]
  }'

# Option 3: From the external VectorDB project (if you have Python env set up)
cd ../../Hackathon2026/VectorDB
python -m src.ingest data/sample_tickets.csv
# The data will be available in the Docker database since it's on localhost:5432
```

### Verify Ingested Data

```bash
# Check ticket count
docker-compose exec db psql -U vectordb -d jira_tickets \
  -c "SELECT COUNT(*) FROM tickets;"

# View ingested tickets
docker-compose exec db psql -U vectordb -d jira_tickets \
  -c "SELECT jira_key, summary FROM tickets LIMIT 10;"

# Test vector search
curl -X POST http://localhost:3000/api/vector-search \
  -H "Content-Type: application/json" \
  -d '{"supportText":"Login fails after password reset"}'
```

## Architecture

```
docker-compose up
    │
    ├── PostgreSQL (pgvector)
    │   - Port 5432
    │   - Volume: postgres_data
    │   - Schema: auto-initialized from init.sql
    │
    └── Backend (Node.js + Python)
        - Port 3000
        - Contains embedded vectordb Python module
        - Pre-loaded embedding model
        - Hot reload enabled
```

## Troubleshooting

### Backend Can't Connect to Database

```bash
# Check database health
docker-compose ps
docker-compose logs db

# Restart services
docker-compose restart
```

### Python Module Not Found

```bash
# Rebuild the backend container
docker-compose build backend
docker-compose up -d backend
```

### Model Download Issues

The Dockerfile pre-downloads the embedding model. If it fails:

```bash
# Rebuild with no cache
docker-compose build --no-cache backend
```

### Reset Everything

```bash
# Stop and remove all containers, volumes, and networks
docker-compose down -v

# Start fresh
docker-compose up -d
```

## Production Deployment

For ECS/production deployment:

1. Build the production image:
```bash
docker build -t ai-ticket-backend:prod .
```

2. Push to ECR:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
docker tag ai-ticket-backend:prod ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ai-ticket-backend:latest
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ai-ticket-backend:latest
```

3. Deploy to ECS using the task definition (see ecs-deployment.md plan)

## File Structure

```
backend/
├── vectordb/              # Embedded Python module
│   ├── __init__.py
│   ├── config.py
│   ├── embeddings.py
│   ├── embed_query.py
│   └── requirements.txt
├── vectorSearch.js        # Uses local vectordb/
├── server.js
├── Dockerfile
├── docker-compose.yml
└── .dockerignore
```

## Comparison: Docker vs Native

### Docker (This Setup)
- ✅ No manual PostgreSQL setup
- ✅ No Python environment management
- ✅ Consistent across all developers
- ✅ Same image for dev and production
- ✅ Easy cleanup (`docker-compose down -v`)

### Native (Previous Setup)
- ⚠️ Manual PostgreSQL installation
- ⚠️ Separate VectorDB Python project
- ⚠️ Environment configuration complexity
- ✅ Faster iterations (no rebuild)
- ✅ Easier debugging

Choose based on your workflow preference!
