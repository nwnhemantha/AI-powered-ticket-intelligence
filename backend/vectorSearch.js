/**
 * Vector Search Module
 * Handles VectorDB integration for semantic similarity search
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.VECTORDB_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection on startup
pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('[VectorDB] Connection failed:', err.message);
  } else {
    console.log('[VectorDB] Connected successfully');
  }
});

/**
 * Generate embedding for a query using VectorDB's Python model
 * @param {string} queryText - The search query
 * @returns {Promise<number[]>} - 384-dimensional embedding
 */
async function generateQueryEmbedding(queryText) {
  return new Promise((resolve, reject) => {
    // Use local vectordb module (embedded in backend)
    // Run from parent directory (__dirname = /app) with module path
    // Set PYTHONPATH to include the current directory so Python can find the vectordb module
    const proc = spawn('python3', ['-m', 'vectordb.embed_query'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true, // Windows compatibility
      env: { ...process.env, PYTHONPATH: __dirname },
    });

    let stdout = '';
    let stderr = '';

    const input = JSON.stringify({ query: queryText });
    proc.stdin.write(input);
    proc.stdin.end();

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Embedding generation timeout (30s)'));
    }, 30000);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        console.error('[VectorDB] Embedding stderr:', stderr);
        return reject(new Error(`Embedding generation failed (exit ${code})`));
      }

      try {
        const embedding = JSON.parse(stdout.trim());
        if (!Array.isArray(embedding) || embedding.length !== 384) {
          return reject(new Error('Invalid embedding format'));
        }
        resolve(embedding);
      } catch (parseErr) {
        reject(new Error(`Failed to parse embedding: ${parseErr.message}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

/**
 * Search for similar tickets using vector similarity
 * @param {number[]} embedding - Query embedding
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array>} - Array of matching tickets
 */
async function similaritySearch(embedding, topK = 5) {
  const query = `
    SELECT jira_key, summary, description, resolution, status, priority,
           assignee, labels,
           1 - (embedding <=> $1::vector) AS similarity
    FROM tickets
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2;
  `;

  const result = await pool.query(query, [JSON.stringify(embedding), topK]);
  return result.rows;
}

/**
 * Get total count of indexed tickets
 * @returns {Promise<number>} - Total ticket count
 */
async function getTotalTicketCount() {
  const result = await pool.query(
    'SELECT COUNT(*) FROM tickets WHERE embedding IS NOT NULL'
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Format VectorDB results to match frontend expectations
 * @param {Array} matches - Raw database matches
 * @returns {Array} - Formatted rankedMatches
 */
function formatVectorResults(matches) {
  return matches.map((match) => {
    // Convert similarity (0-1) to percentage (0-100)
    const score = Math.round(match.similarity * 100);

    return {
      issue: {
        key: match.jira_key,
        fields: {
          summary: match.summary,
          status: match.status ? { name: match.status } : null,
          priority: match.priority ? { name: match.priority } : null,
          assignee: match.assignee ? { displayName: match.assignee } : null,
          labels: match.labels || [],
        },
      },
      score,
      overlap: 0,  // Vector search has no keyword overlap (semantic matching instead)
    };
  });
}

/**
 * Health check for VectorDB connection
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  generateQueryEmbedding,
  similaritySearch,
  getTotalTicketCount,
  formatVectorResults,
  healthCheck,
};
