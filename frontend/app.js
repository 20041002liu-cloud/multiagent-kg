const SVG_NS = "http://www.w3.org/2000/svg";

const runListEl = document.getElementById("runList");
const timelineEl = document.getElementById("timeline");
const stateViewEl = document.getElementById("stateView");
const metricsViewEl = document.getElementById("metricsView");
const tripleTableBody = document.querySelector("#tripleTable tbody");
const graphTableBody = document.getElementById("graphTableBody");
const experimentTableBody = document.querySelector("#experimentTable tbody");

const healthBadge = document.getElementById("healthBadge");
const modelBadge = document.getElementById("modelBadge");
const graphSvgEl = document.getElementById("agentGraph");
const strategyEl = document.getElementById("strategy");
const themeSelectEl = document.getElementById("themeSelect");
const activeNodeBadgeEl = document.getElementById("activeNodeBadge");
const runCountStatEl = document.getElementById("runCountStat");
const selectedRunStatEl = document.getElementById("selectedRunStat");
const strategyStatEl = document.getElementById("strategyStat");

const NODE_LABELS = {
  ingest: "Ingest",
  planner: "Planner",
  single_extract: "SingleExtract",
  entity_extract: "EntityExtract",
  relation_extract: "RelationExtract",
  fusion: "Fusion",
  write_graph: "WriteGraph",
  evaluate: "Evaluate",
};

const STRATEGY_DEF = {
  single: {
    nodes: ["ingest", "single_extract", "fusion", "write_graph", "evaluate"],
    edges: [
      ["ingest", "single_extract"],
      ["single_extract", "fusion"],
      ["fusion", "write_graph"],
      ["write_graph", "evaluate"],
    ],
  },
  ontology: {
    nodes: ["ingest", "planner", "single_extract", "fusion", "write_graph", "evaluate"],
    edges: [
      ["ingest", "planner"],
      ["planner", "single_extract"],
      ["single_extract", "fusion"],
      ["fusion", "write_graph"],
      ["write_graph", "evaluate"],
    ],
  },
  multi: {
    nodes: ["ingest", "planner", "entity_extract", "relation_extract", "fusion", "write_graph", "evaluate"],
    edges: [
      ["ingest", "planner"],
      ["planner", "entity_extract"],
      ["entity_extract", "relation_extract"],
      ["relation_extract", "fusion"],
      ["fusion", "write_graph"],
      ["write_graph", "evaluate"],
    ],
  },
};

let currentRunId = null;
let source = null;
let graphRuntime = {
  strategy: "multi",
  nodeStatus: {},
  activeNode: null,
};

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function tabInit() {
  const buttons = Array.from(document.querySelectorAll(".tab-btn"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      buttons.forEach((x) => x.classList.toggle("active", x === btn));
      panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === tab));
    });
  });
}

function buildInitialStatus(strategy) {
  const def = STRATEGY_DEF[strategy] || STRATEGY_DEF.multi;
  const status = {};
  def.nodes.forEach((node) => {
    status[node] = "idle";
  });
  return status;
}

function setGraphStrategy(strategy) {
  graphRuntime.strategy = STRATEGY_DEF[strategy] ? strategy : "multi";
  graphRuntime.nodeStatus = buildInitialStatus(graphRuntime.strategy);
  graphRuntime.activeNode = null;
  strategyStatEl.textContent = graphRuntime.strategy;
  activeNodeBadgeEl.textContent = "none";
  renderGraph();
}

function setNodeStatus(node, status) {
  if (!(node in graphRuntime.nodeStatus)) return;
  graphRuntime.nodeStatus[node] = status;
}

function markNodeStarted(node) {
  if (!(node in graphRuntime.nodeStatus)) return;
  if (graphRuntime.activeNode && graphRuntime.activeNode !== node && graphRuntime.nodeStatus[graphRuntime.activeNode] === "active") {
    setNodeStatus(graphRuntime.activeNode, "done");
  }
  setNodeStatus(node, "active");
  graphRuntime.activeNode = node;
  activeNodeBadgeEl.textContent = NODE_LABELS[node] || node;
}

function markNodeFinished(node) {
  if (!(node in graphRuntime.nodeStatus)) return;
  setNodeStatus(node, "done");
  if (graphRuntime.activeNode === node) {
    graphRuntime.activeNode = null;
    activeNodeBadgeEl.textContent = "none";
  }
}

function edgeStatus(from, to) {
  const fromStatus = graphRuntime.nodeStatus[from] || "idle";
  const toStatus = graphRuntime.nodeStatus[to] || "idle";
  if (fromStatus === "error" || toStatus === "error") return "error";
  if (toStatus === "active") return "active";
  if (fromStatus === "done" && toStatus === "done") return "done";
  return "idle";
}

function renderGraph() {
  const def = STRATEGY_DEF[graphRuntime.strategy] || STRATEGY_DEF.multi;
  graphSvgEl.innerHTML = "";
  const width = 980;
  const y = 110;
  const left = 70;
  const right = 70;
  const nodeWidth = 118;
  const nodeHeight = 44;
  const step = def.nodes.length > 1 ? (width - left - right) / (def.nodes.length - 1) : 0;
  const pos = {};

  def.nodes.forEach((node, i) => {
    pos[node] = { x: left + i * step, y };
  });

  def.edges.forEach(([from, to]) => {
    const line = createSvgElement("line", {
      x1: pos[from].x + nodeWidth / 2 - 8,
      y1: y,
      x2: pos[to].x - nodeWidth / 2 + 8,
      y2: y,
      class: `graph-edge ${edgeStatus(from, to)}`,
    });
    graphSvgEl.appendChild(line);
  });

  def.nodes.forEach((node) => {
    const status = graphRuntime.nodeStatus[node] || "idle";
    const g = createSvgElement("g", { class: "graph-node" });
    const rect = createSvgElement("rect", {
      x: pos[node].x - nodeWidth / 2,
      y: pos[node].y - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      rx: 11,
      class: `graph-node-box ${status}`,
    });
    const text = createSvgElement("text", {
      x: pos[node].x,
      y: pos[node].y + 4,
      "text-anchor": "middle",
      class: "graph-node-text",
    });
    text.textContent = NODE_LABELS[node] || node;
    g.appendChild(rect);
    g.appendChild(text);
    graphSvgEl.appendChild(g);
  });
}

function appendTimeline(event) {
  const row = document.createElement("div");
  row.className = `event-row type-${event.event_type}`;
  row.innerHTML = `<div class="event-head">
      <span class="event-time">${new Date(event.timestamp).toLocaleTimeString()}</span>
      <span class="event-type">${event.event_type}</span>
    </div>
    <div class="event-payload">${JSON.stringify(event.payload)}</div>`;
  timelineEl.prepend(row);
}

function renderTriples(state) {
  tripleTableBody.innerHTML = "";
  const triples = state?.triples || [];
  triples.slice(0, 250).forEach((triple) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${triple.head || ""}</td>
                    <td>${triple.relation || ""}</td>
                    <td>${triple.tail || ""}</td>
                    <td>${(triple.confidence ?? "").toString()}</td>`;
    tripleTableBody.appendChild(tr);
  });
}

function renderGraphRows(rows) {
  graphTableBody.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4">No rows returned</td>`;
    graphTableBody.appendChild(tr);
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.head || ""}</td><td>${row.relation || ""}</td><td>${row.tail || ""}</td><td>${row.evidence || ""}</td>`;
    graphTableBody.appendChild(tr);
  });
}

function renderExperimentRows(items) {
  experimentTableBody.innerHTML = "";
  if (!items || items.length === 0) return;
  items.forEach((item) => {
    const metrics = item.metrics || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${item.strategy}</td>
                    <td>${item.run_id.slice(0, 8)}</td>
                    <td>${metrics.triple_count ?? "-"}</td>
                    <td>${metrics.entity_count ?? "-"}</td>
                    <td>${metrics.connectivity ?? "-"}</td>`;
    experimentTableBody.appendChild(tr);
  });
}

async function refreshRunList() {
  const resp = await fetch("/api/runs");
  const runs = await resp.json();
  runCountStatEl.textContent = String(runs.length);
  runListEl.innerHTML = "";
  runs.forEach((run) => {
    const li = document.createElement("li");
    li.className = "run-item";
    const summary = run.summary || {};
    li.innerHTML = `<div class="run-main">${run.run_id.slice(0, 8)} <span class="dot">•</span> ${run.strategy}</div>
                    <div class="run-sub">${run.status} <span class="sep">|</span> triples: ${summary.triple_count ?? "-"}</div>`;
    li.onclick = () => selectRun(run.run_id);
    runListEl.appendChild(li);
  });
}

async function refreshRunDetail(runId) {
  const resp = await fetch(`/api/runs/${runId}`);
  if (!resp.ok) return null;
  const run = await resp.json();
  selectedRunStatEl.textContent = run.run_id.slice(0, 8);
  stateViewEl.textContent = JSON.stringify(run.last_state || {}, null, 2);
  metricsViewEl.textContent = JSON.stringify(run.summary || {}, null, 2);
  renderTriples(run.last_state || {});
  return run;
}

function handleGraphEvent(event) {
  if (event.event_type === "run_started") {
    const strategy = event.payload?.strategy || graphRuntime.strategy;
    setGraphStrategy(strategy);
    return;
  }
  if (event.event_type === "chunk_started" && Number(event.payload?.chunk_id || 1) > 1) {
    graphRuntime.nodeStatus = buildInitialStatus(graphRuntime.strategy);
    graphRuntime.activeNode = null;
    activeNodeBadgeEl.textContent = "none";
    renderGraph();
    return;
  }
  if (event.event_type === "node_started") {
    const node = event.payload?.node;
    markNodeStarted(node);
    renderGraph();
    return;
  }
  if (event.event_type === "node_finished") {
    const node = event.payload?.node;
    markNodeFinished(node);
    renderGraph();
    return;
  }
  if (event.event_type === "run_failed") {
    if (graphRuntime.activeNode) {
      setNodeStatus(graphRuntime.activeNode, "error");
      graphRuntime.activeNode = null;
      activeNodeBadgeEl.textContent = "error";
      renderGraph();
    }
  }
}

function subscribeRunEvents(runId) {
  if (source) source.close();
  source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (e) => {
    const event = JSON.parse(e.data);
    appendTimeline(event);
    handleGraphEvent(event);
    if (["node_finished", "chunk_finished", "run_finished", "run_failed"].includes(event.event_type)) {
      refreshRunDetail(runId);
      refreshRunList();
    }
  };
}

async function selectRun(runId) {
  currentRunId = runId;
  timelineEl.innerHTML = "";
  const run = await refreshRunDetail(runId);
  setGraphStrategy(run?.strategy || strategyEl.value || "multi");
  subscribeRunEvents(runId);
}

async function startRun() {
  const text = document.getElementById("inputText").value.trim();
  const strategy = strategyEl.value;
  if (!text) return;
  setGraphStrategy(strategy);
  const resp = await fetch("/api/runs/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      strategy,
      document_id: "doc-001",
      chapter_id: "chapter-1",
    }),
  });
  const data = await resp.json();
  selectRun(data.run_id);
  refreshRunList();
}

async function runExperiments() {
  const text = document.getElementById("inputText").value.trim();
  if (!text) return;
  const resp = await fetch("/api/experiments/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      document_id: "doc-001",
      chapter_id: "chapter-1",
    }),
  });
  const data = await resp.json();
  renderExperimentRows(data.items || []);
  const expTabBtn = document.querySelector(".tab-btn[data-tab='experiments']");
  if (expTabBtn) expTabBtn.click();
  refreshRunList();
}

async function queryGraph() {
  const entity = document.getElementById("graphEntity").value.trim();
  if (!entity) return;
  const resp = await fetch(`/api/graph/query?entity=${encodeURIComponent(entity)}&limit=20`);
  const data = await resp.json();
  renderGraphRows(data.rows || []);
}

async function checkHealth() {
  const resp = await fetch("/api/health");
  const data = await resp.json();
  if (data.ok) {
    healthBadge.className = "pill success";
    healthBadge.textContent = "Backend OK";
  } else {
    healthBadge.className = "pill danger";
    healthBadge.textContent = "Backend Error";
  }

  if (data.model_adapter_enabled) {
    modelBadge.className = "pill success";
    modelBadge.textContent = "Model: connected";
  } else {
    modelBadge.className = "pill warn";
    modelBadge.textContent = "Model: heuristic fallback";
  }
}

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
}

document.getElementById("startBtn").onclick = startRun;
document.getElementById("experimentBtn").onclick = runExperiments;
document.getElementById("graphQueryBtn").onclick = queryGraph;
strategyEl.onchange = () => setGraphStrategy(strategyEl.value);
themeSelectEl.onchange = () => applyTheme(themeSelectEl.value);

tabInit();
applyTheme(themeSelectEl.value);
setGraphStrategy(strategyEl.value || "multi");
checkHealth();
refreshRunList();
