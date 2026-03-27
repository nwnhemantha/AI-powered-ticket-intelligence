/**
 * Vector Ingestion Module
 *
 * This module provides a Node.js interface to the Python-based ticket ingestion system.
 * It spawns a Python subprocess to ingest JIRA tickets into the pgvector database.
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * Ingest tickets into the VectorDB.
 *
 * @param {Array<Object>} tickets - Array of ticket objects to ingest
 * @param {Object} options - Optional ingestion parameters
 * @param {string} options.format - Format type ("json" or "csv")
 * @param {string} options.template - Optional embedding text template
 * @returns {Promise<Object>} Ingestion result: { ingested, skipped, errors }
 */
async function ingestTickets(tickets, options = {}) {
  return new Promise((resolve, reject) => {
    // Prepare input data
    const inputData = {
      tickets,
      format: options.format || 'json',
      template: options.template,
    };

    // Spawn Python subprocess
    // Run from /app with -m vectordb.ingest_api (not from inside vectordb/)
    // Set PYTHONPATH to /app so Python can find the vectordb module
    const proc = spawn('python3', ['-m', 'vectordb.ingest_api'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, PYTHONPATH: __dirname },
    });

    // Send input via stdin
    proc.stdin.write(JSON.stringify(inputData));
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    // Collect stdout (JSON result)
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr (logs and errors)
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log Python subprocess output
      console.error('[vectordb-ingest]', data.toString().trim());
    });

    // Handle process completion
    proc.on('close', (code) => {
      if (code !== 0) {
        // Parse error from stderr or stdout
        let errorMsg = 'Ingestion failed';
        try {
          const errorResult = JSON.parse(stdout || stderr);
          if (errorResult.errors && errorResult.errors.length > 0) {
            errorMsg = errorResult.errors.join('; ');
          }
        } catch (e) {
          errorMsg = stderr || stdout || 'Unknown ingestion error';
        }
        return reject(new Error(errorMsg));
      }

      // Parse successful result
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse ingestion result: ${err.message}`));
      }
    });

    // Handle spawn errors
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });

    // Add timeout (5 minutes for large ingestions)
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Ingestion timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    // Clear timeout on completion
    proc.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Get the total count of tickets in the database.
 *
 * @returns {Promise<number>} Total ticket count
 */
async function getTicketCount() {
  // Reuse the PostgreSQL connection from vectorSearch module
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.VECTORDB_URL,
    max: 5,
  });

  try {
    const result = await pool.query('SELECT COUNT(*) FROM tickets');
    return parseInt(result.rows[0].count, 10);
  } finally {
    await pool.end();
  }
}

module.exports = {
  ingestTickets,
  getTicketCount,
};
