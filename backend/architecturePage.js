function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getArchitecturePage(config = {}) {
  const port = escapeHtml(config.port || "3000");
  const vectorDbUrl = escapeHtml(config.vectorDbUrl || "http://127.0.0.1:6333");
  const vectorDbCollection = escapeHtml(
    config.vectorDbCollection || "jira_issues",
  );
  const embeddingProvider = escapeHtml(config.embeddingProvider || "openai");
  const embeddingModel = escapeHtml(
    config.embeddingModel || "text-embedding-3-small",
  );

  const diagram = String.raw`flowchart LR
    U[Support Agent in Chrome] --> E[Chrome Extension Popup\npopup.html + popup.js]
    E --> I[chrome.identity PKCE OAuth]
    I --> A[Atlassian OAuth]
    A --> E
    E --> S[Express Backend\nserver.js]
    S --> T[/api/token\nOAuth code exchange/]
    S --> W[/api/jira/workspaces\nAccessible Jira sites/]
    S --> P[/api/jira/projects\nProject listing/]
    S --> R[/api/process\nAnalysis pipeline/]
    S --> C[/api/jira/issue\nCreate Jira issue/]
    S --> X[/api/vectordb/index\nVector sync/]
    S --> H[/api/status\nHealth and dependency status/]
    T --> J[Atlassian Cloud APIs]
    W --> J
    P --> J
    R --> J
    C --> J
    X --> J
    R --> V[(Vector DB)]
    X --> V
    R --> O[Embedding Provider]
    X --> O
    S --> D[PII Redaction + Rule-based Suggestions]
    D --> R`;

  const analysisDiagram = String.raw`flowchart TD
    A[User enters support ticket] --> B[Popup validateSupportTicket]
    B --> C[POST /api/process]
    C --> D{Analysis mode}
    D -->|jira| E[Run Jira analysis]
    E --> E1[Search Jira candidate issues]
    E1 --> E2[Score keyword overlap]
    E2 --> H[Ranked matches]
    D -->|vectordb| F[Run vector analysis]
    F --> F1[Redact PII]
    F1 --> F2[Create embedding]
    F2 --> F3[Search vector DB]
    F3 --> H
    D -->|both| G[Run Jira and vector analysis in parallel]
    G --> H
    H --> I[Classify intent category sentiment]
    I --> J[Derive priority labels assignee]
    J --> K[Return results to popup]
    K --> L[Render matches and draft suggestions]`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jira Extension Architecture</title>
    <style>
      :root {
        --bg: #f4efe7;
        --panel: rgba(255, 251, 245, 0.92);
        --panel-strong: #fffaf2;
        --ink: #1d1a16;
        --muted: #5f5549;
        --accent: #0a6a69;
        --accent-2: #d46a4b;
        --line: rgba(39, 29, 19, 0.12);
        --shadow: 0 20px 60px rgba(52, 35, 18, 0.12);
        --radius: 22px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(212, 106, 75, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(10, 106, 105, 0.16), transparent 24%),
          linear-gradient(180deg, #f7f1e8 0%, var(--bg) 52%, #efe6d8 100%);
      }

      .page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 40px 20px 56px;
      }

      .hero {
        display: grid;
        gap: 18px;
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: calc(var(--radius) + 6px);
        background: linear-gradient(135deg, rgba(255, 250, 242, 0.96), rgba(247, 238, 225, 0.9));
        box-shadow: var(--shadow);
      }

      .eyebrow {
        margin: 0;
        color: var(--accent);
        font-family: Arial, sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(34px, 5vw, 62px);
        line-height: 0.95;
        letter-spacing: -0.04em;
      }

      .hero p {
        margin: 0;
        max-width: 76ch;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.65;
      }

      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .pill {
        padding: 10px 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.7);
        font-family: Arial, sans-serif;
        font-size: 13px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 18px;
        margin-top: 22px;
      }

      .card {
        grid-column: span 12;
        padding: 22px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }

      .card h2,
      .card h3 {
        margin: 0 0 12px;
        font-family: Arial, sans-serif;
        letter-spacing: -0.03em;
      }

      .lede {
        color: var(--muted);
        line-height: 1.65;
      }

      .span-7 {
        grid-column: span 7;
      }

      .span-5 {
        grid-column: span 5;
      }

      .span-6 {
        grid-column: span 6;
      }

      .list {
        margin: 0;
        padding-left: 18px;
        line-height: 1.7;
      }

      .list li + li {
        margin-top: 8px;
      }

      .callout {
        padding: 14px 16px;
        border-left: 4px solid var(--accent-2);
        background: rgba(212, 106, 75, 0.08);
        border-radius: 12px;
        color: #5f2a1b;
        font-family: Arial, sans-serif;
        line-height: 1.6;
      }

      .meta-table {
        width: 100%;
        border-collapse: collapse;
        font-family: Arial, sans-serif;
        font-size: 14px;
      }

      .meta-table td {
        padding: 10px 0;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }

      .meta-table td:first-child {
        width: 180px;
        color: var(--muted);
        font-weight: 700;
      }

      .code {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(10, 106, 105, 0.08);
        color: var(--accent);
        font-family: Consolas, Monaco, monospace;
        font-size: 13px;
      }

      .route-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .route {
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.65);
      }

      .route strong {
        display: block;
        margin-bottom: 6px;
        font-family: Arial, sans-serif;
      }

      .mermaid-wrap {
        overflow-x: auto;
        padding: 8px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.68);
        border: 1px solid var(--line);
      }

      .footer-note {
        margin-top: 18px;
        color: var(--muted);
        font-family: Arial, sans-serif;
        font-size: 13px;
      }

      @media (max-width: 900px) {
        .span-7,
        .span-6,
        .span-5 {
          grid-column: span 12;
        }

        .route-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Architecture Overview</p>
        <h1>AI-powered Jira ticket intelligence</h1>
        <p>
          The current system is a two-tier design: a Chrome extension popup as the
          client and a single Express backend as the application layer. The popup
          owns UX, PKCE login initiation, local token storage, and rendering. The
          backend owns secrets, Atlassian proxy calls, Jira analysis, vector search,
          PII redaction, and ticket creation.
        </p>
        <div class="hero-meta">
          <span class="pill">Popup-only MV3 extension</span>
          <span class="pill">Express backend on port ${port}</span>
          <span class="pill">Embedding provider: ${embeddingProvider}</span>
          <span class="pill">Vector collection: ${vectorDbCollection}</span>
        </div>
      </section>

      <section class="grid">
        <article class="card span-7">
          <h2>Component diagram</h2>
          <p class="lede">
            This diagram shows the current runtime boundaries and the main request
            paths between the extension, backend, Atlassian APIs, vector DB, and
            embedding provider.
          </p>
          <div class="mermaid-wrap">
            <pre class="mermaid">${escapeHtml(diagram)}</pre>
          </div>
          <p class="footer-note">
            If Mermaid is blocked in the browser, the source diagram text still
            appears and can be copied into any Mermaid renderer.
          </p>
        </article>

        <aside class="card span-5">
          <h2>Current runtime details</h2>
          <table class="meta-table">
            <tr>
              <td>Backend process</td>
              <td><span class="code">server.js</span></td>
            </tr>
            <tr>
              <td>Browser client</td>
              <td><span class="code">frontend/popup.html</span> + <span class="code">frontend/popup.js</span></td>
            </tr>
            <tr>
              <td>Vector DB URL</td>
              <td><span class="code">${vectorDbUrl}</span></td>
            </tr>
            <tr>
              <td>Vector collection</td>
              <td><span class="code">${vectorDbCollection}</span></td>
            </tr>
            <tr>
              <td>Embedding model</td>
              <td><span class="code">${embeddingModel}</span></td>
            </tr>
            <tr>
              <td>Auth strategy</td>
              <td>PKCE in extension, code exchange on backend, Jira access token forwarded per request.</td>
            </tr>
          </table>
        </aside>

        <article class="card span-6">
          <h3>Frontend responsibilities</h3>
          <ul class="list">
            <li>Launch Atlassian OAuth via <span class="code">chrome.identity</span> and store tokens in <span class="code">chrome.storage.local</span>.</li>
            <li>Render health status, workspace and project selectors, analysis results, suggestions, logs, and draft ticket UI.</li>
            <li>Call backend routes for token exchange, workspace loading, project loading, hybrid analysis, vector sync, and ticket creation.</li>
            <li>Detect likely auth failures and force logout when the Jira session looks expired.</li>
          </ul>
        </article>

        <article class="card span-6">
          <h3>Backend responsibilities</h3>
          <ul class="list">
            <li>Keep Atlassian client secret on the server and perform OAuth code exchange.</li>
            <li>Resolve accessible Jira workspaces and projects for the user token supplied by the extension.</li>
            <li>Run lexical Jira search, semantic vector search, or both in parallel.</li>
            <li>Redact PII before embedding requests and derive classification, labels, assignee hints, and priority suggestions.</li>
            <li>Proxy Jira issue creation and expose dependency health for backend and vector DB.</li>
          </ul>
        </article>

        <article class="card span-7">
          <h2>Primary browser-to-backend flows</h2>
          <ol class="list">
            <li>Login: popup creates PKCE verifier and launches Atlassian auth, then posts the authorization code to <span class="code">POST /api/token</span>.</li>
            <li>Setup: popup uses the Jira access token to call <span class="code">GET /api/jira/workspaces</span> and <span class="code">GET /api/jira/projects</span>.</li>
            <li>Analysis: popup sends support text, workspace, project, and mode to <span class="code">POST /api/process</span>.</li>
            <li>Vector indexing: popup triggers <span class="code">POST /api/vectordb/index</span> to embed and upsert Jira issues into the vector store.</li>
            <li>Ticket creation: popup submits the prepared Jira fields to <span class="code">POST /api/jira/issue</span>.</li>
          </ol>
        </article>

        <article class="card span-5">
          <h2>Backend routes</h2>
          <div class="route-grid">
            <div class="route">
              <strong>POST /api/token</strong>
              Exchange OAuth code for Jira access and refresh tokens.
            </div>
            <div class="route">
              <strong>GET /api/jira/workspaces</strong>
              Return accessible Jira sites for the current user token.
            </div>
            <div class="route">
              <strong>GET /api/jira/projects</strong>
              Return projects for the selected workspace.
            </div>
            <div class="route">
              <strong>POST /api/process</strong>
              Run Jira, vector, or hybrid analysis and produce suggestions.
            </div>
            <div class="route">
              <strong>POST /api/jira/issue</strong>
              Create a Jira issue through the backend proxy.
            </div>
            <div class="route">
              <strong>POST /api/vectordb/index</strong>
              Generate embeddings and upsert issue vectors.
            </div>
            <div class="route">
              <strong>GET /api/status</strong>
              Show backend reachability and vector DB health.
            </div>
            <div class="route">
              <strong>GET /architecture</strong>
              Render this architecture overview page.
            </div>
          </div>
        </article>

        <article class="card span-7">
          <h2>How analysis works</h2>
          <p class="lede">
            The analysis path is a retrieval pipeline. The extension sends the
            support text and filters to the backend. The backend then runs lexical
            Jira retrieval, semantic vector retrieval, or both, and uses the
            returned matches to classify the request and suggest draft field values.
          </p>
          <ol class="list">
            <li>The popup gathers support text, workspace, project filter, and selected analysis mode.</li>
            <li>The backend validates the payload and extracts meaningful keywords from the support text.</li>
            <li>In Jira mode, the backend searches Jira and scores issues by keyword overlap.</li>
            <li>In vector mode, the backend redacts PII, creates an embedding, and searches the vector collection for semantic neighbors.</li>
            <li>In both mode, both branches run in parallel and the backend combines the results.</li>
            <li>The backend derives intent, category, sentiment, priority, labels, and assignee hints from the matched issues.</li>
            <li>The popup renders the ranked matches, classification output, and draft ticket suggestions.</li>
          </ol>
        </article>

        <article class="card span-5">
          <h2>Simple analysis diagram</h2>
          <div class="mermaid-wrap">
            <pre class="mermaid">${escapeHtml(analysisDiagram)}</pre>
          </div>
          <p class="footer-note">
            This is the operational analysis path used by the current extension,
            not a target-state design.
          </p>
        </article>

        <article class="card span-12">
          <h2>Current strengths and pressure points</h2>
          <div class="callout">
            Strength: the backend is the trust boundary for secrets and the place where PII redaction is enforced before AI-related requests. Pressure point: both the popup and backend are implemented as large single files, so feature growth will make change isolation and testing harder.
          </div>
          <ul class="list" style="margin-top: 14px;">
            <li>The overall split is sensible: UI and Chrome APIs stay in the extension; secrets and integrations stay on the server.</li>
            <li>The server is doing orchestration, retrieval, heuristics, and integrations in one file, which is efficient now but not ideal for long-term maintainability.</li>
            <li>The popup is effectively a controller for all UI state and network interactions, which makes behavior easy to trace but hard to modularize.</li>
            <li>The current product is not purely LLM-driven; it is a hybrid of Jira lexical search, vector retrieval, and rule-based suggestion logic.</li>
          </ul>
        </article>
      </section>
    </main>

    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({
        startOnLoad: true,
        theme: "neutral",
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: "basis",
        },
      });
    </script>
  </body>
</html>`;
}

module.exports = { getArchitecturePage };
