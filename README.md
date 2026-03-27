# AI-Powered Ticket Intelligence

A Chrome extension that uses AI and vector search to analyze Jira support tickets and find similar historical tickets.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Google Chrome

### 1. Start Docker Containers

```bash
cd backend
docker-compose up -d
```

This will:
- Start PostgreSQL database with pgvector extension
- Start Node.js backend on port 3000
- Download dependencies (~8 min first time)

Check status:
```bash
docker-compose ps
docker-compose logs -f backend
```

### 2. Seed Database (Optional)

Load sample Jira tickets for testing:

```bash
# Seed with sample data
docker-compose exec -T db psql -U vectordb -d jira_tickets < seed.sql

# Verify tickets loaded
docker-compose exec db psql -U vectordb -d jira_tickets -c "SELECT COUNT(*) FROM tickets;"
```

### 3. Install Chrome Extension

1. Open Chrome: `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `frontend` folder

### 4. Configure Jira OAuth

Update `backend/.env`:
```env
ATLASSIAN_CLIENT_ID=your-client-id
ATLASSIAN_CLIENT_SECRET=your-client-secret
```

Restart backend:
```bash
docker-compose restart backend
```

## Usage

1. Click extension icon
2. Connect to Jira (OAuth)
3. Paste support ticket text
4. Click "Vector Search" to find similar tickets

## Common Commands

```bash
# View logs
docker-compose logs -f backend

# Restart backend
docker-compose restart backend

# Stop all services
docker-compose down

# Reset database
docker-compose down -v
docker-compose up -d
```

## Tech Stack

- **Frontend**: Chrome Extension (HTML/JS)
- **Backend**: Node.js + Python
- **Database**: PostgreSQL with pgvector
- **AI**: sentence-transformers (all-MiniLM-L6-v2)
