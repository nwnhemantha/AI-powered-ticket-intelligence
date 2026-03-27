@echo off
REM Test script for vector ingestion API (Windows)

echo === Testing Vector Ingestion API ===
echo.

REM Test 1: Ingest sample tickets
echo Test 1: Ingesting sample tickets...
curl -X POST http://localhost:3000/api/ingest ^
  -H "Content-Type: application/json" ^
  -d "{\"tickets\": [{\"key\": \"TEST-101\", \"fields\": {\"summary\": \"Login fails after password reset\", \"description\": \"Users report they cannot login immediately after resetting their password.\", \"status\": {\"name\": \"Open\"}, \"priority\": {\"name\": \"High\"}, \"issuetype\": {\"name\": \"Bug\"}, \"labels\": [\"login\", \"authentication\"]}}, {\"key\": \"TEST-102\", \"fields\": {\"summary\": \"Dashboard loads slowly\", \"description\": \"The main dashboard takes 5-10 seconds to load.\", \"status\": {\"name\": \"In Progress\"}, \"priority\": {\"name\": \"Medium\"}, \"labels\": [\"performance\"]}}, {\"key\": \"TEST-103\", \"fields\": {\"summary\": \"Add dark mode support\", \"description\": \"Request to add a dark mode theme option.\", \"status\": {\"name\": \"Backlog\"}, \"priority\": {\"name\": \"Low\"}, \"labels\": [\"ui\", \"theme\"]}}]}"

echo.
echo.

REM Wait for ingestion
timeout /t 2 /nobreak > nul

REM Test 2: Verify in database
echo Test 2: Verifying tickets in database...
docker-compose exec -T db psql -U vectordb -d jira_tickets -c "SELECT jira_key, summary FROM tickets WHERE jira_key LIKE 'TEST-%%' ORDER BY jira_key;"

echo.
echo.

REM Test 3: Vector search test
echo Test 3: Testing vector search with ingested tickets...
curl -X POST http://localhost:3000/api/vector-search ^
  -H "Content-Type: application/json" ^
  -d "{\"supportText\":\"User cannot login after changing password\"}"

echo.
echo.

REM Test 4: Another search
echo Test 4: Testing vector search for performance issues...
curl -X POST http://localhost:3000/api/vector-search ^
  -H "Content-Type: application/json" ^
  -d "{\"supportText\":\"Application is running very slow\"}"

echo.
echo.
echo === Tests Complete ===
pause
