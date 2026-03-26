// backend/server.js
// Secure backend for the Jira extension.
// Owns all secrets, proxies Jira API calls, and runs Jira-based analysis.
// The frontend (Chrome extension) sends user OAuth tokens per-request; they are never stored here.

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        if (process.env.NODE_ENV !== "production") return callback(null, true);
        return callback(new Error("Origin required in production"));
      }
      if (
        origin.startsWith("chrome-extension://") ||
        ALLOWED_ORIGINS.includes(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin not allowed: ${origin}`));
    },
  }),
);

// ── PII REDACTION ─────────────────────────────────────────────────────────────
const PII_PATTERNS = [
  {
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    regex:
      /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\w)/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    regex:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
    replacement: "[REDACTED_IP]",
  },
  { regex: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[REDACTED_NUMBER]" },
  { regex: /\b[a-f0-9]{32,64}\b/gi, replacement: "[REDACTED_TOKEN]" },
];

function redactPII(text) {
  if (!text || typeof text !== "string") return text;
  return PII_PATTERNS.reduce(
    (output, p) => output.replace(p.regex, p.replacement),
    text,
  );
}

// ── VALIDATION ────────────────────────────────────────────────────────────────
function requireStrings(obj, fields, res) {
  for (const field of fields) {
    if (!obj[field] || typeof obj[field] !== "string" || !obj[field].trim()) {
      res.status(400).json({ error: `Missing required field: ${field}` });
      return false;
    }
  }
  return true;
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

// ── TEXT UTILITIES ────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTokens(text) {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function extractJiraText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractJiraText).join(" ");
  if (typeof value === "object") {
    const text = typeof value.text === "string" ? value.text : "";
    const content = Array.isArray(value.content)
      ? value.content.map(extractJiraText).join(" ")
      : "";
    return `${text} ${content}`.trim();
  }
  return "";
}

function extractCommentsText(commentField) {
  const comments = Array.isArray(commentField?.comments)
    ? commentField.comments
    : [];
  return comments
    .map((c) => extractJiraText(c.body))
    .filter(Boolean)
    .join(" ");
}

function buildIssueAnalysisText(issue) {
  const summary = issue.fields?.summary || "";
  const description = extractJiraText(issue.fields?.description);
  const status = issue.fields?.status?.name || "";
  const comments = extractCommentsText(issue.fields?.comment);
  return normalizeText([summary, description, status, comments].join(" "));
}

// ── SCORING ───────────────────────────────────────────────────────────────────
function scoreIssueMatch(issue, supportText, ticketTokens) {
  const issueText = buildIssueAnalysisText(issue);
  const issueTokens = new Set(extractTokens(issueText));
  let overlap = 0;
  for (const token of ticketTokens) {
    if (issueTokens.has(token)) overlap++;
  }
  const overlapRatio = overlap / ticketTokens.length;
  const phraseBonus = issueText.includes(normalizeText(supportText)) ? 0.15 : 0;
  return {
    issue,
    score: Math.min(100, Math.round((overlapRatio + phraseBonus) * 100)),
    overlap,
  };
}

// ── CLASSIFICATION (rule-based fallback) ──────────────────────────────────────
function containsAny(text, terms) {
  return terms.some((t) => text.includes(t));
}

function classifyIntent(text) {
  if (containsAny(text, ["refund", "invoice", "charge", "billing", "payment"]))
    return "Billing request";
  if (
    containsAny(text, [
      "cannot login",
      "password",
      "access",
      "permission",
      "forbidden",
    ])
  )
    return "Access issue";
  if (containsAny(text, ["error", "failed", "bug", "crash", "exception"]))
    return "Bug report";
  if (containsAny(text, ["feature", "enhancement", "improve", "request"]))
    return "Feature request";
  if (containsAny(text, ["how to", "where", "question", "help", "clarify"]))
    return "How-to question";
  return "General support";
}

function classifyCategory(text) {
  if (containsAny(text, ["api", "integration", "webhook", "sync"]))
    return "Integration";
  if (containsAny(text, ["login", "auth", "sso", "token", "permission"]))
    return "Authentication";
  if (containsAny(text, ["slow", "latency", "timeout", "performance"]))
    return "Performance";
  if (containsAny(text, ["ui", "screen", "button", "layout", "page"]))
    return "User interface";
  if (containsAny(text, ["data", "missing", "incorrect", "report", "export"]))
    return "Data quality";
  if (containsAny(text, ["payment", "invoice", "charge", "refund"]))
    return "Billing";
  return "Platform";
}

function classifySentiment(text) {
  if (
    containsAny(text, [
      "urgent",
      "angry",
      "frustrated",
      "unacceptable",
      "critical",
    ])
  )
    return "High frustration";
  if (containsAny(text, ["please", "thanks", "thank you", "appreciate"]))
    return "Cooperative";
  return "Neutral";
}

function classifySupportRequest(supportText, matches) {
  const normalized = normalizeText(supportText);
  const jiraCorpus = normalizeText(
    matches.map((m) => buildIssueAnalysisText(m.issue)).join(" "),
  );
  const combined = `${jiraCorpus} ${normalized}`.trim();
  const intent = classifyIntent(combined);
  const sentiment = classifySentiment(combined);
  const category =
    jiraCorpus.includes("incident") || jiraCorpus.includes("outage")
      ? "Incident"
      : classifyCategory(combined);
  return { intent, category, sentiment };
}

// ── SUGGESTIONS (rule-based fallback) ─────────────────────────────────────────
function normalizePriorityName(value) {
  if (!value) return null;
  const n = String(value).toLowerCase().trim();
  if (n.includes("highest") || n === "critical") return "Highest";
  if (n === "high") return "High";
  if (n === "medium") return "Medium";
  if (n === "low") return "Low";
  if (n.includes("lowest")) return "Lowest";
  return null;
}

function suggestPriority(matches) {
  const votes = { Lowest: 0, Low: 0, Medium: 0, High: 0, Highest: 0 };
  let totalWeight = 0;
  for (const m of matches) {
    const name = normalizePriorityName(m.issue.fields?.priority?.name);
    if (!name) continue;
    const weight = Math.max(0.2, m.score / 100);
    votes[name] += weight;
    totalWeight += weight;
  }
  if (!totalWeight) {
    return {
      value: "Medium",
      confidence: 30,
      reason:
        "No active Jira matches with priority data; using medium fallback.",
    };
  }
  const [value, valueWeight] = Object.entries(votes).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return {
    value,
    confidence: Math.max(40, Math.round((valueWeight / totalWeight) * 100)),
    reason: "Based on priority patterns in current similar Jira tasks.",
  };
}

function suggestLabels(matches) {
  const weights = new Map();
  for (const m of matches) {
    const labels = Array.isArray(m.issue.fields?.labels)
      ? m.issue.fields.labels
      : [];
    for (const label of labels) {
      const key = normalizeText(label).replace(/\s+/g, "-");
      if (!key) continue;
      weights.set(key, (weights.get(key) || 0) + Math.max(0.2, m.score / 100));
    }
  }
  const top = Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([l]) => l);
  return {
    values: [...new Set(top)].slice(0, 6),
    reason: top.length
      ? "Based on labels used in current similar Jira tasks."
      : "No labels found in current similar Jira tasks.",
  };
}

function suggestAssignee(matches) {
  const weights = new Map();
  let totalWeight = 0;
  for (const m of matches) {
    const af = m.issue.fields?.assignee;
    if (!af?.displayName) continue;
    const weight = Math.max(0.2, m.score / 100);
    const existing = weights.get(af.displayName);
    weights.set(af.displayName, {
      weight: (existing?.weight || 0) + weight,
      accountId: af.accountId || existing?.accountId || null,
    });
    totalWeight += weight;
  }
  if (!weights.size || !totalWeight) {
    return {
      value: "Unassigned",
      accountId: null,
      confidence: 25,
      reason: "Similar issues were mostly unassigned.",
    };
  }
  const [value, { weight: vw, accountId }] = Array.from(weights.entries()).sort(
    (a, b) => b[1].weight - a[1].weight,
  )[0];
  return {
    value,
    accountId,
    confidence: Math.round((vw / totalWeight) * 100),
    reason: "Suggested from ownership patterns in the closest Jira matches.",
  };
}

function deriveSmartSuggestions(rankedMatches) {
  return {
    priority: suggestPriority(rankedMatches),
    labels: suggestLabels(rankedMatches),
    assignee: suggestAssignee(rankedMatches),
  };
}

// ── FALLBACK RESPONSE BUILDER ─────────────────────────────────────────────────
function resolveAssigneeAccountId(suggestedName, rankedMatches) {
  if (!suggestedName || suggestedName === "Unassigned") return null;
  for (const { issue } of rankedMatches) {
    const a = issue.fields?.assignee;
    if (a?.displayName === suggestedName && a?.accountId) return a.accountId;
  }
  return null;
}

// ── JIRA API HELPERS ──────────────────────────────────────────────────────────
async function getAccessibleResources(jiraToken) {
  const res = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    {
      headers: { Authorization: `Bearer ${jiraToken}` },
    },
  );
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    throw new Error("No Jira sites available for this account");
  }
  return data.map((resource) => ({
    id: resource.id,
    url: resource.url,
    name: resource.name || resource.url,
  }));
}

async function getWorkspaceContext(jiraToken, workspaceId) {
  const resources = await getAccessibleResources(jiraToken);
  const selectedResource = workspaceId
    ? resources.find((resource) => resource.id === workspaceId)
    : resources[0];

  if (!selectedResource) {
    throw new Error("Selected Jira workspace is no longer available");
  }

  return {
    cloudId: selectedResource.id,
    siteUrl: selectedResource.url,
    workspaceName: selectedResource.name,
  };
}

async function fetchWorkspaceProjects(cloudId, jiraToken) {
  const res = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?expand=insight`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jiraToken}`,
        Accept: "application/json",
      },
    },
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.errorMessages?.[0] || data.error || "Failed to load Jira projects",
    );
  }

  const projects = Array.isArray(data.values) ? data.values : [];
  return projects.map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name || project.key,
    projectTypeLabel: project.projectTypeKey || "",
  }));
}

async function fetchCandidateIssues(
  cloudId,
  jiraToken,
  ticketTokens,
  projectKey,
) {
  const SEARCH_PAGE_SIZE = Number(process.env.JIRA_SEARCH_PAGE_SIZE || 100);
  const SEARCH_CANDIDATE_LIMIT = Number(
    process.env.JIRA_SEARCH_CANDIDATE_LIMIT || 1000,
  );

  const performSearch = async (jql) => {
    let nextPageToken = null;
    let allIssues = [];

    while (allIssues.length < SEARCH_CANDIDATE_LIMIT) {
      const remaining = SEARCH_CANDIDATE_LIMIT - allIssues.length;
      const pageSize = Math.max(1, Math.min(SEARCH_PAGE_SIZE, remaining));

      const res = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jiraToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jql,
            maxResults: pageSize,
            ...(nextPageToken ? { nextPageToken } : {}),
            fields: [
              "summary",
              "status",
              "assignee",
              "description",
              "priority",
              "labels",
              "comment",
            ],
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.errorMessages?.[0] || "Failed to search Jira tickets",
        );
      }

      const pageIssues = Array.isArray(data.issues) ? data.issues : [];
      if (!pageIssues.length) break;

      allIssues = allIssues.concat(pageIssues);
      nextPageToken = data.nextPageToken || null;
      if (!nextPageToken) break;
    }

    return allIssues.slice(0, SEARCH_CANDIDATE_LIMIT);
  };

  const matchingClause = ticketTokens
    .slice(0, 8)
    .map(
      (t) =>
        `(summary ~ "${t}*" OR description ~ "${t}*" OR comment ~ "${t}*")`,
    )
    .join(" OR ");
  const projectFilter = projectKey ? `project = "${projectKey}" AND ` : "";
  // Include both open and completed tickets so historical resolved issues are
  // also available as matches.
  const keywordJql =
    `${projectFilter}(${matchingClause || "summary is not EMPTY"}) ` +
    `ORDER BY updated DESC`;

  const keywordIssues = await performSearch(keywordJql);
  if (keywordIssues.length) {
    return keywordIssues;
  }

  // Fallback: if tokenized JQL returns zero (common for very short/simple text
  // like single-word tickets), fetch recent issues and let local scoring filter.
  const fallbackJql = `${projectFilter}summary is not EMPTY ORDER BY updated DESC`;
  return performSearch(fallbackJql);
}

// ── POST /api/process ─────────────────────────────────────────────────────────
// Full pipeline: fetch Jira issues → score → Jira-based suggestions.
// Receives: Authorization: Bearer <jira_access_token>, body: { supportText }
// Returns:  { rankedMatches, candidateCount, classification, suggestions, rankingMode, siteUrl }
app.post("/api/process", async (req, res) => {
  if (!requireStrings(req.body, ["supportText"], res)) return;

  const jiraToken = extractBearerToken(req);
  if (!jiraToken)
    return res
      .status(401)
      .json({ error: "Jira token required in Authorization header" });

  const supportText = req.body.supportText.trim().slice(0, 4000);
  const ticketTokens = extractTokens(supportText);
  if (!ticketTokens.length) {
    return res
      .status(400)
      .json({ error: "Support text contains no meaningful keywords" });
  }

  const projectKey = (req.body.projectKey || "").trim();
  if (projectKey && !/^[A-Za-z][A-Za-z0-9]{0,49}$/.test(projectKey)) {
    return res.status(400).json({ error: "Invalid projectKey format" });
  }

  try {
    const { cloudId, siteUrl } = await getWorkspaceContext(
      jiraToken,
      req.body.workspaceId,
    );
    const candidateIssues = await fetchCandidateIssues(
      cloudId,
      jiraToken,
      ticketTokens,
      projectKey,
    );

    const lexicalMatches = candidateIssues
      .map((issue) => scoreIssueMatch(issue, supportText, ticketTokens))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);

    let rankingMode = "lexical";
    const rankedMatches = lexicalMatches.slice(0, 5);
    const classification = classifySupportRequest(supportText, rankedMatches);
    const suggestions = deriveSmartSuggestions(rankedMatches);
    if (suggestions?.assignee?.value) {
      suggestions.assignee.accountId = resolveAssigneeAccountId(
        suggestions.assignee.value,
        rankedMatches,
      );
    }

    return res.json({
      rankedMatches: rankedMatches.map(({ issue, score, overlap }) => ({
        issue: {
          key: issue.key,
          fields: {
            summary: issue.fields?.summary,
            status: issue.fields?.status,
            priority: issue.fields?.priority,
            assignee: issue.fields?.assignee,
            labels: issue.fields?.labels,
          },
        },
        score,
        overlap,
      })),
      candidateCount: candidateIssues.length,
      classification,
      suggestions,
      rankingMode,
      siteUrl,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/token ───────────────────────────────────────────────────────────
// Exchanges an OAuth authorization code for Jira access/refresh tokens.
// The Atlassian client_secret never leaves this server.
app.post("/api/token", async (req, res) => {
  if (!requireStrings(req.body, ["code", "verifier", "redirectUri"], res))
    return;

  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: "Atlassian credentials are not configured on the server",
    });
  }

  const { code, verifier, redirectUri } = req.body;
  if (
    !redirectUri.startsWith("https://") &&
    !redirectUri.startsWith("chrome-extension://")
  ) {
    return res.status(400).json({ error: "Invalid redirectUri" });
  }

  try {
    const tokenRes = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    const data = await tokenRes.json();
    if (!data.access_token) {
      return res
        .status(400)
        .json({ error: data.error_description || "Token exchange failed" });
    }
    return res.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/jira/issue ──────────────────────────────────────────────────────
// Proxies Jira issue creation; the extension sends its OAuth token per-request.
// Receives: Authorization: Bearer <jira_access_token>, body: { fields }
// Returns:  { key, siteUrl }
app.post("/api/jira/issue", async (req, res) => {
  const jiraToken = extractBearerToken(req);
  if (!jiraToken)
    return res
      .status(401)
      .json({ error: "Jira token required in Authorization header" });

  const { fields, workspaceId } = req.body;
  if (!fields || typeof fields !== "object") {
    return res.status(400).json({ error: "Missing required field: fields" });
  }

  try {
    const { cloudId, siteUrl } = await getWorkspaceContext(
      jiraToken,
      workspaceId,
    );

    const createRes = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jiraToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
      },
    );

    if (!createRes.ok) {
      const data = await createRes.json().catch(() => ({}));
      const fieldErrors = data.errors
        ? Object.values(data.errors).filter(Boolean).join(", ")
        : "";
      const message =
        data.errorMessages?.[0] || fieldErrors || "Failed to create ticket";
      return res.status(createRes.status).json({ error: message });
    }

    const data = await createRes.json();
    return res.json({ key: data.key, siteUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/jira/workspaces", async (req, res) => {
  const jiraToken = extractBearerToken(req);
  if (!jiraToken)
    return res
      .status(401)
      .json({ error: "Jira token required in Authorization header" });

  try {
    const workspaces = await getAccessibleResources(jiraToken);
    return res.json({ workspaces });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/jira/projects", async (req, res) => {
  const jiraToken = extractBearerToken(req);
  if (!jiraToken)
    return res
      .status(401)
      .json({ error: "Jira token required in Authorization header" });

  try {
    const { cloudId } = await getWorkspaceContext(
      jiraToken,
      req.query.workspaceId,
    );
    const projects = await fetchWorkspaceProjects(cloudId, jiraToken);
    return res.json({ projects });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/status", async (_req, res) => {
  return res.json({
    backend: {
      connected: true,
      detail: "Backend reachable",
    },
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Backend running on http://127.0.0.1:${PORT}`);
});
