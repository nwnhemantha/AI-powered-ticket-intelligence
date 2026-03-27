# Multi-runtime Dockerfile for Node.js backend with Python embedding
FROM node:20-slim

# Install Python 3.11 and dependencies (optimized with --no-install-recommends)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3-pip \
    python3.11-venv \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Set working directory
WORKDIR /app

# Copy Node.js dependencies and install
COPY package*.json ./
RUN npm ci --only=production --prefer-offline

# Copy Python requirements and install (CPU-only PyTorch via requirements.txt)
COPY vectordb/requirements.txt ./vectordb/
RUN pip3 install --no-cache-dir --break-system-packages -r vectordb/requirements.txt

# Pre-download the embedding model (saves startup time)
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "server.js"]
