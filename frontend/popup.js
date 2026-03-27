// frontend/popup.js
// Thin UI + auth layer for Jira ticket intelligence.
// This file handles Chrome extension APIs, DOM rendering, and user interactions.

const CLIENT_ID = "w9INPC3ijaNnuUTkrcuQL8p0AQy3js22";
const BACKEND_BASE_URL = "http://127.0.0.1:3000";

let latestSuggestions = null;
let latestClassification = null;
let isBackendAvailable = false;
let latestMatches = [];
let latestSupportText = "";
let latestCandidateCount = 0;
let latestSiteUrl = "";
let availableWorkspaces = [];
let availableProjects = [];
let _aiStepTimers = [];
let _pendingHide = false;
let _stepsAllComplete = false;
const MAX_UI_LOG_LINES = 400;
let uiLogLines = [];
let _consolePatched = false;

document.addEventListener("DOMContentLoaded", init);
document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("logoutBtn").addEventListener("click", logout);
document
  .getElementById("workspaceSelect")
  .addEventListener("change", handleWorkspaceChange);
document
  .getElementById("analyzeProjectSelect")
  .addEventListener("change", handleAnalyzeProjectChange);
document
  .getElementById("validateTicketBtn")
  .addEventListener("click", validateSupportTicket);
document
  .getElementById("smartSuggestions")
  .addEventListener("click", handleSuggestionActionClick);
document
  .getElementById("applyAllSuggestionsBtn")
  .addEventListener("click", () => applySuggestionTarget("all"));
document
  .getElementById("resetDraftBtn")
  .addEventListener("click", resetDraftComposer);
document
  .getElementById("insertDraftBtn")
  .addEventListener("click", insertDraftIntoTicket);
document
  .getElementById("exportMatchesBtn")
  .addEventListener("click", exportMatchingLinksExcel);
document.getElementById("tabAnalyzeBtn").addEventListener("click", () => {
  switchTab("analyze");
});
document.getElementById("tabLogsBtn").addEventListener("click", () => {
  switchTab("logs");
});
document.getElementById("clearLogsBtn").addEventListener("click", clearLogs);
document.getElementById("copyLogsBtn").addEventListener("click", copyLogs);
document
  .getElementById("draftTargetIssueKey")
  .addEventListener("change", handleProjectChange);

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  setupConsoleLogMirroring();
  bindGlobalErrorLogging();
  // renderOauthDebug();
  appendUiLog("info", "Popup initialized");
  const { token } = await chrome.storage.local.get("token");
  setConnectedState(!!token);
  setBackendAvailability(false);
  updateExportButtonState(false, false);
  if (token) {
    await loadWorkspaces();
  } else {
    availableWorkspaces = [];
    renderWorkspaceState([], "Connect to Jira to load workspaces.");
  }
  await refreshConnectionStatus();
  setInterval(refreshConnectionStatus, 15000);
}

function setBackendAvailability(isAvailable) {
  isBackendAvailable = isAvailable;
  const loginBtn = document.getElementById("loginBtn");
  loginBtn.disabled = !isAvailable;
  loginBtn.title = isAvailable
    ? "Connect to Jira"
    : "Backend is disconnected. Start backend service first.";
}

function setServiceStatus(
  element,
  serviceName,
  state,
  detail,
  modelName = "",
  endpointUrl = "",
) {
  if (!element) return;

  element.classList.remove(
    "status-connected",
    "status-disconnected",
    "status-checking",
  );
  element.classList.add(`status-${state}`);

  const stateLabel =
    state === "connected"
      ? "Connected"
      : state === "disconnected"
        ? "Disconnected"
        : "Checking";

  const hasEndpoint =
    typeof endpointUrl === "string" && /^https?:\/\//.test(endpointUrl);
  const modelMeta = modelName ? `Model: ${escapeHtml(modelName)}` : "";
  const endpointMeta = hasEndpoint
    ? `<a class="service-link" href="${escapeHtml(endpointUrl)}" target="_blank" rel="noreferrer">Endpoint</a>`
    : "";
  const metaMarkup =
    modelMeta || endpointMeta
      ? `<div class="service-meta">${modelMeta}${modelMeta && endpointMeta ? " · " : ""}${endpointMeta}</div>`
      : "";

  element.innerHTML =
    `<div class="service-status-header">` +
    `<span class="service-dot" aria-hidden="true"></span>` +
    `<span class="service-name">${escapeHtml(serviceName)}</span>` +
    `<span class="service-pill">${stateLabel}</span>` +
    `</div>` +
    `<div class="service-detail">${escapeHtml(detail || "Unknown status")}</div>` +
    metaMarkup;
}

async function refreshConnectionStatus() {
  const backendEl = document.getElementById("backendStatus");

  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/status`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Status endpoint returned ${res.status}`);
    }

    const data = await res.json();
    appendUiLog(
      "info",
      `Status: backend=${data.backend?.connected ? "up" : "down"}`,
    );
    setBackendAvailability(!!data.backend?.connected);
    setServiceStatus(
      backendEl,
      "Backend",
      data.backend?.connected ? "connected" : "disconnected",
      data.backend?.detail || "Unknown",
    );
  } catch {
    appendUiLog("warn", "Status check failed: backend unreachable");
    setServiceStatus(
      backendEl,
      "Backend",
      "disconnected",
      "Cannot reach backend service",
    );
    setBackendAvailability(false);
  }
}

function renderOauthDebug() {
  const debugEl = document.getElementById("oauthDebug");
  if (!debugEl) return;

  const extensionId = chrome.runtime?.id || "unknown";
  const redirectUri = chrome.identity.getRedirectURL();
  debugEl.innerText =
    `OAuth debug\n` +
    `Client ID: ${CLIENT_ID}\n` +
    `Extension ID: ${extensionId}\n` +
    `Redirect URI: ${redirectUri}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function logout() {
  appendUiLog("info", "Logout requested");
  await chrome.storage.local.clear();
  location.reload();
}

// ── PKCE ──────────────────────────────────────────────────────────────────────
async function generatePKCE() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = base64UrlEncode(array);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
async function login() {
  try {
    appendUiLog("info", "Login flow started");
    clearError();
    const redirectUri = chrome.identity.getRedirectURL();
    const { verifier, challenge } = await generatePKCE();
    const state = crypto.randomUUID();

    await chrome.storage.local.remove([
      "token",
      "refreshToken",
      "verifier",
      "oauthState",
    ]);
    await chrome.storage.local.set({ verifier, oauthState: state });

    const baseAuthUrl =
      `https://auth.atlassian.com/authorize` +
      `?audience=api.atlassian.com` +
      `&client_id=${CLIENT_ID}` +
      `&scope=${encodeURIComponent("read:jira-work read:jira-user write:jira-work offline_access")}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&response_type=code` +
      `&code_challenge=${challenge}` +
      `&code_challenge_method=S256`;

    // Some browser profiles block/limit silent web auth; use explicit interactive consent.
    const redirectUrl = await runWebAuthFlow(
      `${baseAuthUrl}&prompt=consent`,
      true,
    );

    if (!redirectUrl) {
      showError("Login failed");
      return;
    }

    const redirect = new URL(redirectUrl);
    const code = redirect.searchParams.get("code");
    const returnedState = redirect.searchParams.get("state");

    if (returnedState !== state) {
      showError("Security check failed. Please try login again.");
      return;
    }
    if (!code) {
      showError("Authorization failed");
      return;
    }

    await exchangeCode(code);
    appendUiLog("info", "Login flow completed");
  } catch (err) {
    showError(err.message);
  }
}

function runWebAuthFlow(url, interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        const rawMessage =
          chrome.runtime.lastError.message ||
          "Authorization page could not be loaded.";
        const redirectUri = chrome.identity.getRedirectURL();
        reject(
          new Error(
            `${rawMessage} Confirm this redirect URL is added in your Atlassian OAuth app: ${redirectUri}`,
          ),
        );
        return;
      }
      resolve(redirectUrl);
    });
  });
}

// ── TOKEN EXCHANGE (via backend) ──────────────────────────────────────────────
async function exchangeCode(code) {
  try {
    const redirectUri = chrome.identity.getRedirectURL();
    const { verifier } = await chrome.storage.local.get("verifier");

    const res = await fetch(`${BACKEND_BASE_URL}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, verifier, redirectUri }),
    });

    const data = await res.json();
    if (!data.access_token)
      throw new Error(data.error || "Token exchange failed");

    await chrome.storage.local.set({
      token: data.access_token,
      refreshToken: data.refresh_token,
    });
    appendUiLog("info", "Token exchange succeeded");
    setConnectedState(true);
    await loadWorkspaces();
  } catch (err) {
    showError(err.message);
  }
}

async function loadWorkspaces() {
  const { token, selectedWorkspaceId } = await chrome.storage.local.get([
    "token",
    "selectedWorkspaceId",
  ]);

  if (!token) {
    availableWorkspaces = [];
    renderWorkspaceState([], "Connect to Jira to load workspaces.");
    return;
  }

  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/jira/workspaces`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to load workspaces (${res.status})`);
    }

    const { workspaces } = await res.json();
    availableWorkspaces = Array.isArray(workspaces) ? workspaces : [];

    const selectedId = availableWorkspaces.some(
      (w) => w.id === selectedWorkspaceId,
    )
      ? selectedWorkspaceId
      : availableWorkspaces[0]?.id || "";

    await chrome.storage.local.set({ selectedWorkspaceId: selectedId });
    renderWorkspaceState(availableWorkspaces, "", selectedId);

    await loadProjectsForWorkspace(selectedId);
    appendUiLog(
      "info",
      `Loaded ${availableWorkspaces.length} Jira workspace(s)`,
    );
  } catch (err) {
    availableWorkspaces = [];
    renderWorkspaceState([], err.message || "Failed to load workspaces.");
    showError(err.message || "Failed to load workspaces.");
  }
}

function renderWorkspaceState(workspaces, message = "", selectedId = "") {
  const select = document.getElementById("workspaceSelect");

  if (!workspaces.length) {
    select.innerHTML = `<option value="">No workspaces available</option>`;
    select.disabled = true;
    if (message) {
      appendUiLog("warn", message);
    }
    return;
  }

  const options = workspaces
    .map(
      (workspace) =>
        `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name || workspace.url)}</option>`,
    )
    .join("");
  select.innerHTML = options;
  select.disabled = false;
  select.value =
    workspaces.some((workspace) => workspace.id === selectedId) && selectedId
      ? selectedId
      : workspaces[0].id;
}

async function handleWorkspaceChange(event) {
  const workspaceId = String(event.target.value || "");
  if (!availableWorkspaces.some((workspace) => workspace.id === workspaceId)) {
    return;
  }

  await chrome.storage.local.set({
    selectedWorkspaceId: workspaceId,
    selectedProjectKey: "",
  });
  appendUiLog("info", "Workspace changed. Reloading projects...");
  await loadProjectsForWorkspace(workspaceId);
}

async function loadProjectsForWorkspace(workspaceId) {
  const { token, selectedProjectKey } = await chrome.storage.local.get([
    "token",
    "selectedProjectKey",
  ]);

  if (!token || !workspaceId) {
    availableProjects = [];
    renderProjectState([], "Select a workspace to load projects.");
    return;
  }

  renderProjectLoading();

  try {
    const res = await fetch(
      `${BACKEND_BASE_URL}/api/jira/projects?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to load projects (${res.status})`);
    }

    const { projects } = await res.json();
    availableProjects = Array.isArray(projects) ? projects : [];

    const projectKey =
      pickProjectKey(selectedProjectKey) || availableProjects[0]?.key || "";

    if (projectKey) {
      await chrome.storage.local.set({ selectedProjectKey: projectKey });
    }

    renderProjectState(availableProjects, "", projectKey);
    appendUiLog(
      "info",
      `Loaded ${availableProjects.length} project(s) for selected workspace`,
    );
  } catch (err) {
    availableProjects = [];
    renderProjectState([], err.message || "Failed to load projects.");
    showError(err.message || "Failed to load projects.");
  }
}

function renderProjectLoading() {
  const select = document.getElementById("draftTargetIssueKey");
  const analyzeSelect = document.getElementById("analyzeProjectSelect");
  const meta = document.getElementById("projectMeta");
  select.innerHTML = `<option value="">Loading projects...</option>`;
  analyzeSelect.innerHTML = `<option value="">Loading projects...</option>`;
  select.disabled = true;
  analyzeSelect.disabled = true;
  meta.innerText = "Fetching Jira projects for the selected workspace...";
  document.getElementById("ticketInputSection").classList.add("hidden");
}

function renderProjectState(projects, message = "", selectedKey = "") {
  const select = document.getElementById("draftTargetIssueKey");
  const analyzeSelect = document.getElementById("analyzeProjectSelect");
  const meta = document.getElementById("projectMeta");

  if (!projects.length) {
    select.innerHTML = `<option value="">No projects available</option>`;
    analyzeSelect.innerHTML = `<option value="">All projects</option>`;
    select.disabled = true;
    analyzeSelect.disabled = false;
    meta.innerText = message || "No projects are available in this workspace.";
    document.getElementById("ticketInputSection").classList.add("hidden");
    return;
  }

  const projectOptions = projects
    .map(
      (project) =>
        `<option value="${escapeHtml(project.key)}">${escapeHtml(project.name)} (${escapeHtml(project.key)})</option>`,
    )
    .join("");
  select.innerHTML = projectOptions;
  select.disabled = false;
  select.value = pickProjectKey(selectedKey) || projects[0].key;

  analyzeSelect.innerHTML =
    `<option value="">All projects</option>` + projectOptions;
  analyzeSelect.disabled = false;
  analyzeSelect.value = pickProjectKey(selectedKey) || projects[0].key;

  const selectedProject = projects.find(
    (project) => project.key === select.value,
  );
  meta.innerText = message || selectedProject?.projectTypeLabel || "";
  document.getElementById("ticketInputSection").classList.remove("hidden");
}

function pickProjectKey(candidateKey) {
  return availableProjects.some((project) => project.key === candidateKey)
    ? candidateKey
    : "";
}

async function handleProjectChange(event) {
  const selectedProjectKey = pickProjectKey(event.target.value);
  const projectMeta = document.getElementById("projectMeta");
  const selectedProject = availableProjects.find(
    (project) => project.key === selectedProjectKey,
  );

  if (!selectedProjectKey) {
    projectMeta.innerText = "Please select a Jira project.";
    return;
  }

  await chrome.storage.local.set({ selectedProjectKey });
  projectMeta.innerText = selectedProject?.projectTypeLabel || "";
  appendUiLog(
    "info",
    `Project selected: ${selectedProject?.name || selectedProjectKey}`,
  );
}

async function handleAnalyzeProjectChange(event) {
  const key = event.target.value || "";
  if (key && availableProjects.some((p) => p.key === key)) {
    document.getElementById("draftTargetIssueKey").value = key;
    await chrome.storage.local.set({ selectedProjectKey: key });
  } else {
    await chrome.storage.local.set({ selectedProjectKey: "" });
  }
  appendUiLog("info", `Analyze project filter: ${key || "all projects"}`);
}

// ── MAIN ANALYSIS (via backend) ───────────────────────────────────────────────
async function validateSupportTicket() {
  clearError();
  hideValidationResults();
  updateApplyAllButtonState(false);

  const supportText = document
    .getElementById("supportTicketInput")
    .value.trim();
  latestSupportText = supportText;
  if (!supportText) {
    showError("Please enter support ticket text first.");
    return;
  }

  const { token } = await chrome.storage.local.get("token");
  if (!token) {
    showError("Please connect first.");
    return;
  }

  const selectedWorkspaceId = await getSelectedWorkspaceId();
  if (!selectedWorkspaceId) {
    showError("No Jira workspace found. Please reconnect.");
    return;
  }
  prefillDraftFromSupportText(supportText);
  appendUiLog("info", `Analysis started (${supportText.length} chars)`);
  setLoading(true);
  document.getElementById("loading").innerText = "Processing...";

  try {
    const res = await fetchWithTimeout(
      `${BACKEND_BASE_URL}/api/process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          supportText,
          workspaceId: selectedWorkspaceId,
          projectKey:
            document.getElementById("analyzeProjectSelect").value || "",
        }),
      },
      90000,
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error (${res.status})`);
    }

    const {
      rankedMatches,
      candidateCount,
      classification,
      suggestions,
      rankingMode,
      siteUrl,
    } = await res.json();

    latestClassification = classification;
    latestSuggestions = suggestions;
    latestMatches = rankedMatches;
    latestCandidateCount = candidateCount;
    latestSiteUrl = siteUrl || "";

    renderValidationResults(rankedMatches, candidateCount);
    updateExportButtonState(rankedMatches.length > 0, rankedMatches.length > 0);
    renderSmartSuggestions(suggestions);
    renderClassification(classification);
    setDraftModeVisible(true);
    appendUiLog(
      "info",
      `Analysis complete: matches=${rankedMatches.length}, candidates=${candidateCount}, ranking=${rankingMode || "n/a"}`,
    );
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ── CREATE TICKET (via backend proxy) ─────────────────────────────────────────
async function insertDraftIntoTicket() {
  clearError();

  const projectKey = document
    .getElementById("draftTargetIssueKey")
    .value.trim()
    .toUpperCase();
  const summary = document.getElementById("draftSummary").value.trim();
  const description = document.getElementById("draftDescription").value.trim();
  const priority = document.getElementById("draftPriority").value;
  const labelsRaw = document.getElementById("draftLabels").value;

  if (!projectKey) {
    showError("Please select a Jira project.");
    return;
  }
  if (!summary || !description) {
    showError("Draft summary and description are required before create.");
    return;
  }

  const { token } = await chrome.storage.local.get("token");
  if (!token) {
    showError("Please connect first.");
    return;
  }

  const selectedWorkspaceId = await getSelectedWorkspaceId();
  if (!selectedWorkspaceId) {
    showError("No Jira workspace found. Please reconnect.");
    return;
  }

  const btn = document.getElementById("insertDraftBtn");
  const originalLabel = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Creating...";

  try {
    const labels = labelsRaw
      .split(",")
      .map((v) => normalizeText(v).replace(/\s+/g, "-"))
      .filter(Boolean);

    const assigneeEl = document.getElementById("draftAssignee");
    const assignee = assigneeEl.value.trim();
    const assigneeAccountId = assigneeEl.dataset.accountId || "";

    const fields = {
      project: { key: projectKey },
      issuetype: { name: "Task" },
      summary,
      description: toAdfDocument(description),
      priority: { name: priority },
    };

    if (labelsRaw.trim()) fields.labels = labels;
    if (assigneeAccountId) {
      fields.assignee = { accountId: assigneeAccountId };
    } else if (assignee && assignee.toLowerCase() !== "unassigned") {
      fields.assignee = { name: assignee };
    }

    const res = await fetch(`${BACKEND_BASE_URL}/api/jira/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fields, workspaceId: selectedWorkspaceId }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to create ticket from draft.");
    }

    const { key, siteUrl } = await res.json();
    resetStateAfterCreate(key || "new ticket", siteUrl);
  } catch (err) {
    showError(err.message || "Draft create failed.");
  } finally {
    btn.disabled = false;
    btn.innerText = originalLabel;
  }
}

// ── RENDERING ─────────────────────────────────────────────────────────────────
function setConnectedState(isConnected) {
  document.getElementById("loginBtn").style.display = isConnected
    ? "none"
    : "block";
  document.getElementById("logoutBtn").classList.toggle("hidden", !isConnected);
  document
    .getElementById("supportTool")
    .classList.toggle("hidden", !isConnected);
  document.getElementById("statusText").innerText = isConnected
    ? "Connected to Jira"
    : "Connect your Jira account to classify, prioritize, and respond to support requests";
  if (!isConnected) {
    renderWorkspaceState([], "Connect to Jira to load workspaces.");
    hideValidationResults();
  }
}

function setLoading(isLoading) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("validateTicketBtn").disabled = isLoading;
  if (isLoading) showAiOverlay();
  else hideAiOverlay();
}

const AI_STEP_DELAYS = [0, 1100, 3000, 5200, 7800];

function showAiOverlay() {
  _pendingHide = false;
  _stepsAllComplete = false;

  const overlay = document.getElementById("aiOverlay");
  const steps = overlay?.querySelectorAll(".ai-step") || [];
  steps.forEach((s) => s.classList.remove("active", "done"));
  overlay?.classList.remove("hidden");

  _aiStepTimers.forEach(clearTimeout);
  _aiStepTimers = [];

  AI_STEP_DELAYS.forEach((delay, i) => {
    _aiStepTimers.push(
      setTimeout(() => {
        if (i > 0 && steps[i - 1]) {
          steps[i - 1].classList.remove("active");
          steps[i - 1].classList.add("done");
        }
        if (steps[i]) steps[i].classList.add("active");
      }, delay),
    );
  });

  // After last step activates, mark it done then hide if API already responded
  const lastDelay = AI_STEP_DELAYS[AI_STEP_DELAYS.length - 1];
  _aiStepTimers.push(
    setTimeout(() => {
      const last = steps[steps.length - 1];
      if (last) {
        last.classList.remove("active");
        last.classList.add("done");
      }
      _stepsAllComplete = true;
      if (_pendingHide) {
        _aiStepTimers.push(
          setTimeout(() => {
            overlay?.classList.add("hidden");
            steps.forEach((s) => s.classList.remove("done", "active"));
          }, 350),
        );
      }
    }, lastDelay + 450),
  );
}

function hideAiOverlay() {
  if (_stepsAllComplete) {
    // All steps already finished — hide after a brief pause
    _aiStepTimers.forEach(clearTimeout);
    _aiStepTimers = [];
    const overlay = document.getElementById("aiOverlay");
    const steps = overlay?.querySelectorAll(".ai-step") || [];
    _aiStepTimers.push(
      setTimeout(() => {
        overlay?.classList.add("hidden");
        steps.forEach((s) => s.classList.remove("done", "active"));
      }, 350),
    );
  } else {
    // Steps still animating — defer hide until they complete naturally
    _pendingHide = true;
  }
}

function setDraftModeVisible(isVisible) {
  document.getElementById("issueDraft").classList.toggle("hidden", !isVisible);
}

function renderValidationResults(matches, candidateCount) {
  const validationMeta = document.getElementById("validationMeta");
  const validationResults = document.getElementById("validationResults");

  if (!matches.length) {
    validationMeta.innerText =
      candidateCount > 0
        ? `No likely duplicates found in ${candidateCount} Jira tickets.`
        : "No matching Jira tickets were returned for this support text.";
    validationMeta.classList.remove("hidden");
    validationResults.classList.add("hidden");
    validationResults.innerHTML = "";
    updateExportButtonState(false, false);
    return;
  }

  validationMeta.innerText = `Top ${matches.length} matches from ${candidateCount} Jira tickets.`;
  validationMeta.classList.remove("hidden");
  validationResults.innerHTML = matches
    .map(
      ({ issue, score, overlap }) => `
      <article class="match-card">
        <div class="issue-header">
          <span class="issue-key">${escapeHtml(issue.key)}</span>
          <span class="match-score">${score}% match</span>
        </div>
        <div class="summary">${escapeHtml(issue.fields.summary || "No summary")}</div>
        <div class="meta">${overlap} keyword overlap | Status: ${escapeHtml(issue.fields.status?.name || "Unknown")}</div>
      </article>`,
    )
    .join("");
  validationResults.classList.remove("hidden");
}

function updateExportButtonState(isEnabled, isVisible = true) {
  const exportBtn = document.getElementById("exportMatchesBtn");
  exportBtn.classList.toggle("hidden", !isVisible);
  exportBtn.disabled = !isEnabled;
}

function excelEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function exportMatchingLinksExcel() {
  clearError();

  if (!latestMatches.length) {
    showError("No matching cards to export yet. Run validation first.");
    return;
  }

  const inputRows = [
    ["Support Text", latestSupportText],
    ["Exported At", new Date().toISOString()],
    ["Candidate Tickets Returned", latestCandidateCount],
    ["Matched Tickets", latestMatches.length],
  ]
    .map(
      ([label, value]) =>
        `<tr><td class="label">${excelEscape(label)}</td><td>${excelEscape(value)}</td></tr>`,
    )
    .join("");

  const matchRows = latestMatches
    .map((match) => {
      const issue = match.issue || {};
      const fields = issue.fields || {};
      const key = issue.key || "";
      const link = latestSiteUrl && key ? `${latestSiteUrl}/browse/${key}` : "";
      const clickableLink = link
        ? `<a href="${excelEscape(encodeURI(link))}">${excelEscape(link)}</a>`
        : "";

      return (
        `<tr>` +
        `<td>${excelEscape(key)}</td>` +
        `<td>${excelEscape(fields.summary || "")}</td>` +
        `<td>${excelEscape(match.score ?? "")}</td>` +
        `<td>${excelEscape(fields.status?.name || "")}</td>` +
        `<td>${excelEscape(fields.priority?.name || "")}</td>` +
        `<td>${clickableLink}</td>` +
        `</tr>`
      );
    })
    .join("");

  const html =
    `<!doctype html><html><head><meta charset="UTF-8">` +
    `<style>` +
    `body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#172b4d}` +
    `h2{margin:0 0 8px 0;font-size:16px}` +
    `table{border-collapse:collapse;margin-bottom:12px;width:100%}` +
    `th,td{border:1px solid #dfe1e6;padding:6px 8px;vertical-align:top}` +
    `th{background:#deebff;font-weight:700}` +
    `td.label{width:180px;background:#f4f5f7;font-weight:600}` +
    `tr:nth-child(even) td{background:#fafbfc}` +
    `a{color:#0747a6;text-decoration:underline}` +
    `</style></head><body>` +
    `<h2>Jira Matching Export</h2>` +
    `<table><tbody>${inputRows}</tbody></table>` +
    `<table><thead><tr>` +
    `<th>Issue Key</th><th>Summary</th><th>Match %</th><th>Status</th><th>Priority</th><th>Ticket Link</th>` +
    `</tr></thead><tbody>${matchRows}</tbody></table>` +
    `</body></html>`;

  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateSuffix = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  link.href = url;
  link.download = `jira-matching-links-${dateSuffix}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderClassification(classification) {
  document.getElementById("classificationIntent").innerHTML =
    `<span class="suggestion-label">Intent:</span> ${escapeHtml(classification.intent)}`;
  document.getElementById("classificationCategory").innerHTML =
    `<span class="suggestion-label">Category:</span> ${escapeHtml(classification.category)}`;
  document.getElementById("classificationSentiment").innerHTML =
    `<span class="suggestion-label">Customer sentiment:</span> ${escapeHtml(classification.sentiment)}`;
  document.getElementById("ticketClassification").classList.remove("hidden");
}

function renderSmartSuggestions(suggestions) {
  document.getElementById("suggestionsMeta").innerText =
    "Suggestions source: Jira-based analysis.";

  document.getElementById("suggestedPriority").innerHTML =
    `<div class="suggestion-row">` +
    `<div><span class="suggestion-label">Priority:</span> ` +
    `${escapeHtml(suggestions.priority.value)} ` +
    `(${suggestions.priority.confidence}% confidence) - ` +
    `${escapeHtml(suggestions.priority.reason)}</div>` +
    `<button type="button" class="apply-suggestion-btn" data-apply-target="priority">Apply</button>` +
    `</div>`;

  const labelsMarkup = suggestions.labels.values.length
    ? suggestions.labels.values
        .map((l) => `<span class="chip">${escapeHtml(l)}</span>`)
        .join("")
    : `<span class="chip">needs-triage</span>`;

  document.getElementById("suggestedLabels").innerHTML =
    `<div class="suggestion-row">` +
    `<div><span class="suggestion-label">Labels:</span> ` +
    `<span class="label-chips">${labelsMarkup}</span> - ` +
    `${escapeHtml(suggestions.labels.reason)}</div>` +
    `<button type="button" class="apply-suggestion-btn" data-apply-target="labels">Apply</button>` +
    `</div>`;

  document.getElementById("suggestedAssignee").innerHTML =
    `<div class="suggestion-row">` +
    `<div><span class="suggestion-label">Assignee hint:</span> ` +
    `${escapeHtml(suggestions.assignee.value)} ` +
    `(${suggestions.assignee.confidence}% confidence) - ` +
    `${escapeHtml(suggestions.assignee.reason)}</div>` +
    `<button type="button" class="apply-suggestion-btn" data-apply-target="assignee">Apply</button>` +
    `</div>`;

  document.getElementById("smartSuggestions").classList.remove("hidden");
  updateApplyAllButtonState(true);
}

function hideValidationResults() {
  latestSuggestions = null;
  latestClassification = null;
  latestMatches = [];
  latestCandidateCount = 0;
  latestSiteUrl = "";
  setDraftModeVisible(false);

  const hiddenIds = [
    "validationMeta",
    "validationResults",
    "ticketClassification",
    "smartSuggestions",
  ];
  hiddenIds.forEach((id) =>
    document.getElementById(id)?.classList.add("hidden"),
  );

  const clearHtml = [
    "classificationIntent",
    "classificationCategory",
    "classificationSentiment",
    "suggestionsMeta",
    "suggestedPriority",
    "suggestedLabels",
    "suggestedAssignee",
    "draftMeta",
  ];
  clearHtml.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });

  const clearVal = ["validationResults"];
  clearVal.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value !== undefined ? (el.value = "") : (el.innerHTML = "");
  });

  const banner = document.getElementById("successBanner");
  if (banner) {
    banner.innerHTML = "";
    banner.classList.add("hidden");
  }

  updateApplyAllButtonState(false);
  updateExportButtonState(false, false);
}

// ── SUGGESTION ACTIONS ────────────────────────────────────────────────────────
function handleSuggestionActionClick(event) {
  const trigger = event.target.closest("[data-apply-target]");
  if (!trigger) return;
  applySuggestionTarget(trigger.dataset.applyTarget);
}

function applySuggestionTarget(target) {
  if (!latestSuggestions) {
    showError("Run validation first to generate smart suggestions.");
    return;
  }
  const draftMeta = document.getElementById("draftMeta");

  if (target === "priority" || target === "all") {
    const priority =
      normalizePriorityName(latestSuggestions.priority.value) || "Medium";
    document.getElementById("draftPriority").value = priority;
  }
  if (target === "labels" || target === "all") {
    document.getElementById("draftLabels").value = latestSuggestions.labels
      .values.length
      ? latestSuggestions.labels.values.join(", ")
      : "needs-triage";
  }
  if (target === "assignee" || target === "all") {
    const el = document.getElementById("draftAssignee");
    el.value = latestSuggestions.assignee.value;
    el.dataset.accountId = latestSuggestions.assignee.accountId || "";
  }

  draftMeta.innerText =
    target === "all"
      ? "All smart suggestions applied to draft fields."
      : `${capitalize(target)} suggestion applied to draft.`;
}

// ── DRAFT HELPERS ─────────────────────────────────────────────────────────────
function prefillDraftFromSupportText(supportText) {
  const firstLine =
    String(supportText)
      .split(/\r?\n/)
      .find((l) => l.trim()) || "";
  document.getElementById("draftSummary").value = firstLine
    .trim()
    .slice(0, 120);
  document.getElementById("draftDescription").value = supportText;
  document.getElementById("draftMeta").innerText =
    "Draft summary and description updated from support text.";
}

function resetDraftComposer() {
  document.getElementById("draftSummary").value = "";
  document.getElementById("draftDescription").value = "";
  document.getElementById("draftPriority").value = "Medium";
  document.getElementById("draftLabels").value = "";
  const assigneeEl = document.getElementById("draftAssignee");
  assigneeEl.value = "";
  assigneeEl.dataset.accountId = "";
  document.getElementById("draftTargetIssueKey").value = "";
  document.getElementById("draftMeta").innerText = "Draft reset.";
}

async function getSelectedWorkspaceId() {
  const { selectedWorkspaceId } = await chrome.storage.local.get(
    "selectedWorkspaceId",
  );
  return (
    (availableWorkspaces.some((w) => w.id === selectedWorkspaceId)
      ? selectedWorkspaceId
      : availableWorkspaces[0]?.id) || ""
  );
}

function resetStateAfterCreate(createdKey, siteUrl) {
  document.getElementById("supportTicketInput").value = "";
  resetDraftComposer();
  hideValidationResults();
  clearError();
  const banner = document.getElementById("successBanner");
  banner.innerHTML =
    `<span class="success-check">&#10003; Ticket created successfully!</span> ` +
    `<a href="${siteUrl}/browse/${createdKey}" target="_blank">View ${createdKey} in Jira &rarr;</a>`;
  banner.classList.remove("hidden");
  appendUiLog("info", `Jira issue created: ${createdKey}`);
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function toAdfDocument(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    version: 1,
    type: "doc",
    content: lines.length
      ? lines.map((line) => ({
          type: "paragraph",
          content: [{ type: "text", text: line }],
        }))
      : [
          {
            type: "paragraph",
            content: [{ type: "text", text: "No description provided." }],
          },
        ],
  };
}

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

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function updateApplyAllButtonState(isEnabled) {
  document.getElementById("applyAllSuggestionsBtn").disabled = !isEnabled;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : "Suggestion";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function switchTab(tab) {
  const isLogs = tab === "logs";
  document.getElementById("analyzeTab").classList.toggle("hidden", isLogs);
  document.getElementById("logsTab").classList.toggle("hidden", !isLogs);
  document
    .getElementById("tabAnalyzeBtn")
    .classList.toggle("tab-btn-active", !isLogs);
  document
    .getElementById("tabLogsBtn")
    .classList.toggle("tab-btn-active", isLogs);
}

function appendUiLog(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${String(level || "info").toUpperCase()}] ${String(message || "")}`;
  uiLogLines.push(line);
  if (uiLogLines.length > MAX_UI_LOG_LINES) {
    uiLogLines = uiLogLines.slice(uiLogLines.length - MAX_UI_LOG_LINES);
  }
  const logsOutput = document.getElementById("logsOutput");
  if (!logsOutput) return;
  logsOutput.textContent = uiLogLines.join("\n");
  logsOutput.scrollTop = logsOutput.scrollHeight;
}

function setupConsoleLogMirroring() {
  if (_consolePatched) return;
  _consolePatched = true;
  ["log", "info", "warn", "error"].forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      try {
        const message = args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(" ");
        appendUiLog(method, message);
      } catch {
        // ignore logging reflection failures
      }
      original(...args);
    };
  });
}

function bindGlobalErrorLogging() {
  window.addEventListener("error", (event) => {
    appendUiLog("error", event.message || "Unhandled runtime error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    appendUiLog(
      "error",
      `Unhandled promise rejection: ${event.reason?.message || String(event.reason || "unknown")}`,
    );
  });
}

function clearLogs() {
  uiLogLines = [];
  const logsOutput = document.getElementById("logsOutput");
  if (logsOutput) logsOutput.textContent = "No logs yet.";
  appendUiLog("info", "Logs cleared");
}

async function copyLogs() {
  const content = uiLogLines.length ? uiLogLines.join("\n") : "No logs yet.";
  try {
    await navigator.clipboard.writeText(content);
    appendUiLog("info", "Logs copied to clipboard");
  } catch {
    appendUiLog("error", "Failed to copy logs to clipboard");
    showError("Could not copy logs to clipboard.");
  }
}

function showError(msg) {
  document.getElementById("error").innerText = msg;
  appendUiLog("error", msg);
}
function clearError() {
  document.getElementById("error").innerText = "";
}
