const query = new URLSearchParams(window.location.search);

const state = {
  cases: [],
  selectedCaseId: query.get("caseId"),
  selectedArtifactId: query.get("artifactId"),
  summary: null,
};

const elements = {
  flash: document.getElementById("flash-message"),
  queueSummary: document.getElementById("queue-summary"),
  queueList: document.getElementById("queue-list"),
  caseDetail: document.getElementById("case-detail"),
  reportPreview: document.getElementById("report-preview"),
  viewerLaunch: document.getElementById("viewer-launch"),
  operationsSummary: document.getElementById("operations-summary"),
  selectedCaseChip: document.getElementById("selected-case-chip"),
  reviewForm: document.getElementById("review-form"),
  finalizeForm: document.getElementById("finalize-form"),
  refreshButton: document.getElementById("refresh-button"),
  retryButton: document.getElementById("retry-submit"),
  draftButton: document.getElementById("draft-submit"),
};

function setFlash(message, isError = false) {
  elements.flash.textContent = message;
  elements.flash.style.color = isError ? "#8f2200" : "#006b72";
}

async function fetchJson(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }

  return body;
}

function updateQuery(caseId, panel, artifactId = null) {
  const next = new URLSearchParams(window.location.search);
  if (caseId) {
    next.set("caseId", caseId);
  }
  if (panel) {
    next.set("panel", panel);
  }
  if (artifactId) {
    next.set("artifactId", artifactId);
  } else {
    next.delete("artifactId");
  }
  window.history.replaceState({}, "", `${window.location.pathname}?${next.toString()}`);
}

async function loadCases() {
  const result = await fetchJson("/api/cases");
  state.cases = result.cases;
  if (!state.selectedCaseId && state.cases.length > 0) {
    state.selectedCaseId = state.cases[0].caseId;
  }
}

async function loadSummary() {
  const result = await fetchJson("/api/operations/summary");
  state.summary = result.summary;
}

function renderQueue() {
  const summary = state.summary;
  elements.queueSummary.innerHTML = summary
    ? [
        ["Cases", summary.totals.totalCases],
        ["Review Required", summary.totals.reviewRequiredCount],
        ["Delivery Failures", summary.totals.deliveryFailures],
      ]
        .map(([label, value]) => `<div class="summary-card"><strong>${value}</strong><span>${label}</span></div>`)
        .join("")
    : "";

  elements.queueList.innerHTML = state.cases.length
    ? state.cases
        .map(
          (entry) => `
            <button class="case-card ${entry.caseId === state.selectedCaseId ? "is-selected" : ""}" data-case-id="${entry.caseId}">
              <strong>${entry.patientAlias}</strong>
              <span>${entry.status}</span>
              <span>${entry.sequenceInventory.join(", ")}</span>
              <span>Review: ${entry.reviewStatus}</span>
            </button>
          `,
        )
        .join("")
    : '<div class="empty-state">No cases yet. Use one of the synthetic demo controls above.</div>';

  for (const button of elements.queueList.querySelectorAll("[data-case-id]")) {
    button.addEventListener("click", () => {
      state.selectedCaseId = button.getAttribute("data-case-id");
      state.selectedArtifactId = null;
      updateQuery(state.selectedCaseId, "detail", null);
      refresh();
    });
  }
}

function renderCaseDetail(detail) {
  if (!detail) {
    elements.selectedCaseChip.textContent = "No case selected";
    elements.caseDetail.innerHTML = "Select or seed a case to inspect study context, plan summary, QC, and history.";
    return;
  }

  elements.selectedCaseChip.textContent = `${detail.caseId} · ${detail.status}`;
  elements.caseDetail.innerHTML = `
    <div class="detail-card">
      <strong>Study Context</strong>
      <ul class="metadata-list">
        <li>Study UID: ${detail.studyUid}</li>
        <li>Workflow: ${detail.workflowFamily}</li>
        <li>QC: ${detail.qcSummary.disposition}</li>
        <li>Series count: ${detail.planSummary.seriesCount}</li>
      </ul>
    </div>
    <div class="detail-card">
      <strong>Plan Summary</strong>
      <ul class="metadata-list">
        <li>Selected package: ${detail.planSummary.selectedPackage ?? "none"}</li>
        <li>Blocked packages: ${detail.planSummary.blockedPackages.join(", ") || "none"}</li>
        <li>Required artifacts: ${detail.planSummary.requiredArtifacts.join(", ") || "none"}</li>
      </ul>
    </div>
    <div class="detail-card">
      <strong>Evidence Cards</strong>
      <ul class="metadata-list">
        ${detail.evidenceCards.map((card) => `<li>${card.headline} · ${card.status}</li>`).join("") || "<li>No evidence cards yet</li>"}
      </ul>
    </div>
    <div class="detail-card">
      <strong>History</strong>
      <ul class="history-list">
        ${detail.history.map((entry) => `<li>${entry.at}: ${entry.from ?? "START"} → ${entry.to} (${entry.reason})</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderReport(report) {
  if (!report) {
    elements.reportPreview.innerHTML = "Report preview appears here after inference finishes.";
    elements.viewerLaunch.innerHTML = "Viewer path appears here when a case contains archive-linked viewer-ready artifacts.";
    return;
  }

  const viewerReadyArtifacts = report.artifacts.filter((artifact) => artifact.viewerPath);

  elements.reportPreview.innerHTML = `
    <div class="report-card">
      <strong>Processing Summary</strong>
      <p>${report.processingSummary}</p>
      <p><strong>Review status:</strong> ${report.reviewStatus}</p>
      <p><strong>Final impression:</strong> ${report.finalImpression ?? "not set"}</p>
    </div>
    <div class="report-card">
      <strong>Findings</strong>
      <ul class="metadata-list">
        ${report.findings.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
    <div class="report-card">
      <strong>Artifacts</strong>
      <ul class="artifact-list">
        ${report.artifacts
          .map(
            (artifact) => `<li>
              <span>${artifact.artifactType} · viewerReady=${artifact.viewerReady} · ${artifact.storageUri}</span>
              ${artifact.viewerPath ? `<a class="hero-link" href="${artifact.viewerPath}">Open viewer path</a>` : "<span>Viewer unavailable</span>"}
            </li>`,
          )
          .join("")}
      </ul>
    </div>
  `;

  if (viewerReadyArtifacts.length === 0) {
    elements.viewerLaunch.innerHTML = "Viewer path appears here when a case contains archive-linked viewer-ready artifacts.";
    return;
  }

  let selectedArtifact = viewerReadyArtifacts.find((artifact) => artifact.artifactId === state.selectedArtifactId) ?? null;
  if (!selectedArtifact) {
    selectedArtifact = viewerReadyArtifacts[0];
    state.selectedArtifactId = selectedArtifact?.artifactId ?? null;
    updateQuery(state.selectedCaseId, "viewer", state.selectedArtifactId);
  }

  elements.viewerLaunch.innerHTML = `
    <div class="report-card">
      <strong>${selectedArtifact.label}</strong>
      <p><strong>Viewer mode:</strong> ${selectedArtifact.viewerDescriptor?.viewerMode ?? "unavailable"}</p>
      <p><strong>Study UID:</strong> ${selectedArtifact.archiveLocator.studyInstanceUid}</p>
      <p><strong>Primary series:</strong> ${selectedArtifact.viewerDescriptor?.primarySeriesInstanceUid ?? "not required"}</p>
      <p><strong>Archive:</strong> ${selectedArtifact.archiveLocator.sourceArchive ?? "unbound"}</p>
      ${selectedArtifact.archiveStudyUrl ? `<p><a class="hero-link" href="${selectedArtifact.archiveStudyUrl}" target="_blank" rel="noreferrer">Open archive study</a></p>` : "<p>No archive study URL is available.</p>"}
    </div>
  `;
}

function renderOperations() {
  if (!state.summary) {
    elements.operationsSummary.innerHTML = "Operations totals and retry history appear here.";
    return;
  }

  const summary = state.summary;
  elements.operationsSummary.innerHTML = `
    <div class="operations-card">
      <strong>By Status</strong>
      <ul class="status-list">
        ${Object.entries(summary.byStatus)
          .map(([status, value]) => `<li>${status}: ${value}</li>`)
          .join("")}
      </ul>
    </div>
    <div class="operations-card">
      <strong>Retry History</strong>
      <ul class="status-list">
        ${summary.retryHistory.map((entry) => `<li>${entry.at}: ${entry.caseId} · ${entry.operationType}</li>`).join("") || "<li>No retries yet</li>"}
      </ul>
    </div>
  `;
}

async function loadSelectedDetail() {
  if (!state.selectedCaseId) {
    renderCaseDetail(null);
    renderReport(null);
    return;
  }

  const detailResult = await fetchJson(`/api/cases/${state.selectedCaseId}`);
  renderCaseDetail(detailResult.case);

  try {
    const reportResult = await fetchJson(`/api/cases/${state.selectedCaseId}/report`);
    renderReport(reportResult.report);
  } catch (_error) {
    renderReport(null);
  }
}

async function refresh() {
  await Promise.all([loadCases(), loadSummary()]);
  renderQueue();
  renderOperations();
  await loadSelectedDetail();
}

function demoStudyUid(stage) {
  return `2.25.demo.${stage}`;
}

async function createDemoCase(stage) {
  const created = await fetchJson("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      patientAlias: `synthetic-${stage}`,
      studyUid: demoStudyUid(stage),
      sequenceInventory: ["T1w", "FLAIR"],
      indication: "synthetic demo walkthrough",
      studyContext: {
        studyInstanceUid: demoStudyUid(stage),
        sourceArchive: "demo-archive",
        dicomWebBaseUrl: `https://dicom.example.test/studies/${demoStudyUid(stage)}`,
        metadataSummary: ["Synthetic demo case", "MRI-safe example"],
        series: [
          {
            seriesInstanceUid: `${demoStudyUid(stage)}.1`,
            seriesDescription: "Sag T1",
            modality: "MR",
            sequenceLabel: "T1w",
            instanceCount: 176,
          },
          {
            seriesInstanceUid: `${demoStudyUid(stage)}.2`,
            seriesDescription: "Ax FLAIR",
            modality: "MR",
            sequenceLabel: "FLAIR",
            instanceCount: 42,
          },
        ],
      },
    }),
  });

  return created.case.caseId;
}

async function ensureDraft(caseId, stage) {
  await fetchJson("/api/internal/inference-callback", {
    method: "POST",
    body: JSON.stringify({
      caseId,
      qcDisposition: "warn",
      findings: ["Synthetic review draft prepared for operator validation."],
      measurements: [{ label: "hippocampal_z_score", value: -1.2 }],
      artifacts: ["artifact://overlay-preview", "artifact://qc-summary"],
      issues: ["Synthetic demo warning only."],
      generatedSummary: `Synthetic draft generated for ${stage}.`,
      qcSummary: {
        summary: "Synthetic demo QC summary.",
        checks: [{ checkId: "motion", status: "warn", detail: "Demo-only motion warning." }],
        metrics: [{ name: "snr", value: 19.3, unit: "ratio" }],
      },
    }),
  });
}

async function ensureReviewed(caseId) {
  await fetchJson(`/api/cases/${caseId}/review`, {
    method: "POST",
    body: JSON.stringify({
      reviewerId: "clinician-demo",
      reviewerRole: "neuroradiologist",
      comments: "Synthetic demo review completed.",
      finalImpression: "No acute intracranial abnormality. Mild chronic volume loss only.",
    }),
  });
}

async function ensureFinalized(caseId, deliveryOutcome) {
  await fetchJson(`/api/cases/${caseId}/finalize`, {
    method: "POST",
    body: JSON.stringify({
      finalSummary: "Clinician-reviewed summary locked and queued for delivery.",
      deliveryOutcome,
    }),
  });
}

async function seedDemo(stage) {
  const caseId = await createDemoCase(stage);
  if (stage !== "submitted") {
    await ensureDraft(caseId, stage);
  }
  if (stage === "delivery-failed" || stage === "delivery-pending") {
    await ensureReviewed(caseId);
    await ensureFinalized(caseId, "failed");
  }
  if (stage === "delivery-pending") {
    await fetchJson(`/api/delivery/${caseId}/retry`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  state.selectedCaseId = caseId;
  updateQuery(caseId, query.get("panel") ?? "detail");
  await refresh();
  setFlash(`Synthetic demo case ready: ${stage}`);
}

async function submitReview(event) {
  event.preventDefault();
  if (!state.selectedCaseId) {
    setFlash("Select a case before submitting a review.", true);
    return;
  }
  const payload = Object.fromEntries(new FormData(elements.reviewForm).entries());
  await fetchJson(`/api/cases/${state.selectedCaseId}/review`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await refresh();
  setFlash("Review submitted.");
}

async function submitFinalize(event) {
  event.preventDefault();
  if (!state.selectedCaseId) {
    setFlash("Select a case before finalizing.", true);
    return;
  }
  const payload = Object.fromEntries(new FormData(elements.finalizeForm).entries());
  await fetchJson(`/api/cases/${state.selectedCaseId}/finalize`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await refresh();
  setFlash("Case finalized.");
}

async function generateDraft() {
  if (!state.selectedCaseId) {
    setFlash("Select a case before generating a synthetic draft.", true);
    return;
  }
  await ensureDraft(state.selectedCaseId, "manual-draft");
  await refresh();
  setFlash("Synthetic draft generated.");
}

async function retryDelivery() {
  if (!state.selectedCaseId) {
    setFlash("Select a case before retrying delivery.", true);
    return;
  }
  await fetchJson(`/api/delivery/${state.selectedCaseId}/retry`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  await refresh();
  setFlash("Delivery retry requested.");
}

elements.refreshButton.addEventListener("click", () => {
  refresh().catch((error) => setFlash(error.message, true));
});
elements.reviewForm.addEventListener("submit", (event) => {
  submitReview(event).catch((error) => setFlash(error.message, true));
});
elements.finalizeForm.addEventListener("submit", (event) => {
  submitFinalize(event).catch((error) => setFlash(error.message, true));
});
elements.retryButton.addEventListener("click", () => {
  retryDelivery().catch((error) => setFlash(error.message, true));
});
elements.draftButton.addEventListener("click", () => {
  generateDraft().catch((error) => setFlash(error.message, true));
});

for (const button of document.querySelectorAll("[data-demo-stage]")) {
  button.addEventListener("click", () => {
    seedDemo(button.getAttribute("data-demo-stage")).catch((error) => setFlash(error.message, true));
  });
}

const autoDemoStage = query.get("demoStage");
refresh()
  .then(async () => {
    if (autoDemoStage) {
      await seedDemo(autoDemoStage);
    }
  })
  .catch((error) => setFlash(error.message, true));