#!/bin/bash
# Test script for vector ingestion API

echo "=== Testing Vector Ingestion API ==="
echo ""

# Test 1: Ingest sample tickets
echo "Test 1: Ingesting sample tickets..."
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "tickets": [
      {
        "key": "TEST-101",
        "fields": {
          "summary": "Login fails after password reset",
          "description": "Users report they cannot login immediately after resetting their password. The password reset email arrives correctly, but when they use the new password, they get an authentication error.",
          "status": {"name": "Open"},
          "priority": {"name": "High"},
          "issuetype": {"name": "Bug"},
          "assignee": {"displayName": "John Doe"},
          "labels": ["login", "authentication", "password"],
          "created": "2025-01-15T10:00:00.000Z"
        }
      },
      {
        "key": "TEST-102",
        "fields": {
          "summary": "Dashboard loads slowly",
          "description": "The main dashboard takes 5-10 seconds to load. Users with many projects experience even longer load times.",
          "status": {"name": "In Progress"},
          "priority": {"name": "Medium"},
          "issuetype": {"name": "Bug"},
          "assignee": {"displayName": "Jane Smith"},
          "labels": ["performance", "dashboard"],
          "created": "2025-01-16T14:30:00.000Z"
        }
      },
      {
        "key": "TEST-103",
        "fields": {
          "summary": "Add dark mode support",
          "description": "Request to add a dark mode theme option in user settings. Many users prefer dark mode for nighttime work.",
          "status": {"name": "Backlog"},
          "priority": {"name": "Low"},
          "issuetype": {"name": "Feature Request"},
          "reporter": {"displayName": "Bob Wilson"},
          "labels": ["ui", "theme", "enhancement"],
          "created": "2025-01-17T09:15:00.000Z"
        }
      }
    ]
  }'

echo ""
echo ""

# Wait for ingestion to complete
sleep 2

# Test 2: Verify tickets in database
echo "Test 2: Verifying tickets in database..."
docker-compose exec -T db psql -U vectordb -d jira_tickets \
  -c "SELECT jira_key, summary, SUBSTRING(description, 1, 50) || '...' as description FROM tickets WHERE jira_key LIKE 'TEST-%' ORDER BY jira_key;"

echo ""
echo ""

# Test 3: Test vector search with ingested data
echo "Test 3: Testing vector search with ingested tickets..."
curl -X POST http://localhost:3000/api/vector-search \
  -H "Content-Type: application/json" \
  -d '{"supportText":"User cannot login after changing password"}'

echo ""
echo ""

# Test 4: Another vector search query
echo "Test 4: Testing vector search for performance issues..."
curl -X POST http://localhost:3000/api/vector-search \
  -H "Content-Type: application/json" \
  -d '{"supportText":"Application is running very slow"}'

echo ""
echo ""
echo "=== Tests Complete ==="
