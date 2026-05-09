const SVG_NS = "http://www.w3.org/2000/svg";

const NODE_LABELS = {
  zh: {
    ingest: "输入处理",
    planner: "规划器",
    single_extract: "单体抽取",
    entity_extract: "实体抽取",
    relation_extract: "关系抽取",
    fusion: "融合校验",
    write_graph: "写入图谱",
    evaluate: "评测",
  },
  en: {
    ingest: "Ingest",
    planner: "Planner",
    single_extract: "Single Extract",
    entity_extract: "Entity Extract",
    relation_extract: "Relation Extract",
    fusion: "Fusion",
    write_graph: "Write Graph",
    evaluate: "Evaluate",
  },
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

let currentKbId = "default";
let currentRunId = null;
let preferredRunId = null;
let source = null;
let graphRuntime = {
  strategy: "multi",
  nodeStatus: {},
  activeNode: null,
};

function byId(id) {
  return document.getElementById(id);
}

function nodeLabel(node) {
  const lang = getLanguage();
  const table = NODE_LABELS[lang] || NODE_LABELS.en;
  return table[node] || node;
}

function parseSearch() {
  const params = new URLSearchParams(window.location.search);
  return {
    kb: params.get("kb") || "",
    run: params.get("run") || "",
  };
}

function updateSearch(kbId, runId) {
  const params = new URLSearchParams(window.location.search);
  params.set("kb", kbId);
  if (runId) {
    params.set("run", runId);
  } else {
    params.delete("run");
  }
  history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

function defaultNodeStatus(strategy) {
  const def = STRATEGY_DEF[strategy] || STRATEGY_DEF.multi;
  const status = {};
  def.nodes.forEach((node) => {
    status[node] = "idle";
  });
  return status;
}

function setActiveNodeHint(node) {
  const hint = byId("activeNodeHint");
  if (!hint) {
    return;
  }
  if (!node) {
    hint.textContent = t("hub.hint.active_node_none");
    return;
  }
  hint.textContent = t("hub.hint.active_node", { node: nodeLabel(node) });
}

function setGraphStrategy(strategy) {
  graphRuntime.strategy = STRATEGY_DEF[strategy] ? strategy : "multi";
  graphRuntime.nodeStatus = defaultNodeStatus(graphRuntime.strategy);
  graphRuntime.activeNode = null;
  const strategySelect = byId("strategySelect");
  if (strategySelect) {
    strategySelect.value = graphRuntime.strategy;
  }
  setActiveNodeHint(null);
  renderGraph();
}

function setNodeStatus(node, status) {
  if (!(node in graphRuntime.nodeStatus)) {
    return;
  }
  graphRuntime.nodeStatus[node] = status;
}

function markNodeStarted(node) {
  if (!(node in graphRuntime.nodeStatus)) {
    return;
  }
  if (
    graphRuntime.activeNode &&
    graphRuntime.activeNode !== node &&
    graphRuntime.nodeStatus[graphRuntime.activeNode] === "active"
  ) {
    graphRuntime.nodeStatus[graphRuntime.activeNode] = "done";
  }
  setNodeStatus(node, "active");
  graphRuntime.activeNode = node;
  setActiveNodeHint(node);
}

function markNodeFinished(node) {
  if (!(node in graphRuntime.nodeStatus)) {
    return;
  }
  setNodeStatus(node, "done");
  if (graphRuntime.activeNode === node) {
    graphRuntime.activeNode = null;
    setActiveNodeHint(null);
  }
}

function markRunFailed() {
  if (graphRuntime.activeNode) {
    setNodeStatus(graphRuntime.activeNode, "error");
    graphRuntime.activeNode = null;
  }
  setActiveNodeHint(null);
}

function edgeStatus(from, to) {
  const fromStatus = graphRuntime.nodeStatus[from] || "idle";
  const toStatus = graphRuntime.nodeStatus[to] || "idle";
  if (fromStatus === "error" || toStatus === "error") {
    return "error";
  }
  if (toStatus === "active") {
    return "active";
  }
  if (fromStatus === "done" && toStatus === "done") {
    return "done";
  }
  return "idle";
}

function renderGraph() {
  const svg = byId("agentGraph");
  if (!svg) {
    return;
  }
  const def = STRATEGY_DEF[graphRuntime.strategy] || STRATEGY_DEF.multi;
  svg.innerHTML = "";

  const width = Math.max(760, svg.clientWidth || 980);
  const height = 300;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const y = height / 2;
  const left = 54;
  const right = 54;
  const nodeWidth = 138;
  const nodeHeight = 56;
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
    svg.appendChild(line);
  });

  def.nodes.forEach((node) => {
    const status = graphRuntime.nodeStatus[node] || "idle";
    const group = createSvgElement("g", { class: "graph-node" });
    const rect = createSvgElement("rect", {
      x: pos[node].x - nodeWidth / 2,
      y: pos[node].y - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      rx: 10,
      class: `graph-node-box ${status}`,
    });
    const text = createSvgElement("text", {
      x: pos[node].x,
      y: pos[node].y + 4,
      "text-anchor": "middle",
      class: "graph-node-text",
    });
    text.textContent = nodeLabel(node);
    group.appendChild(rect);
    group.appendChild(text);
    svg.appendChild(group);
  });
}

function runStatusTag(status) {
  if (!status) {
    return "idle";
  }
  if (status === "completed") {
    return "parsed";
  }
  if (status === "failed") {
    return "failed";
  }
  return "parsing";
}

function renderRuns(runs) {
  const runList = byId("runList");
  if (!runList) {
    return;
  }
  runList.innerHTML = "";
  for (const run of runs) {
    const summary = run.summary || {};
    const li = document.createElement("li");
    li.className = `list-item ${run.run_id === currentRunId ? "active" : ""}`;
    li.innerHTML = `
      <div class="title">${run.run_id.slice(0, 8)} | ${run.strategy}</div>
      <div class="meta">
        <span class="badge ${runStatusTag(run.status)}">${translateStatus(run.status)}</span>
        ${t("label.triples")}: ${summary.triple_count ?? "-"} | ${t("label.entities")}: ${summary.entity_count ?? "-"}
      </div>
    `;
    li.onclick = () => {
      selectRun(run.run_id).catch((err) => alert(parseError(err)));
    };
    runList.appendChild(li);
  }
}

function renderRunState(run) {
  const state = run?.last_state || {};
  const summary = run?.summary || {};

  const stateView = byId("stateView");
  const metricsView = byId("metricsView");
  if (stateView) {
    stateView.textContent = JSON.stringify(state, null, 2);
  }
  if (metricsView) {
    metricsView.textContent = JSON.stringify(summary, null, 2);
  }

  const tbody = document.querySelector("#tripleTable tbody");
  if (tbody) {
    tbody.innerHTML = "";
    const triples = state.triples || [];
    for (const triple of triples.slice(0, 300)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${triple.head || ""}</td>
        <td>${triple.relation || ""}</td>
        <td>${triple.tail || ""}</td>
        <td>${(triple.confidence ?? "").toString()}</td>
      `;
      tbody.appendChild(tr);
    }
  }
}

function shortenPayload(payload) {
  const text = JSON.stringify(payload || {});
  if (text.length <= 420) {
    return text;
  }
  return `${text.slice(0, 420)} ...`;
}

function appendEvent(event) {
  const eventLog = byId("eventLog");
  if (!eventLog) {
    return;
  }
  const row = document.createElement("div");
  row.className = "event";
  row.innerHTML = `
    <div class="head">${new Date(event.timestamp).toLocaleTimeString()} <span class="kind">${event.event_type}</span></div>
    <div class="payload">${shortenPayload(event.payload)}</div>
  `;
  eventLog.prepend(row);
  while (eventLog.children.length > 180) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

function applyEventToGraph(event) {
  if (event.event_type === "run_started") {
    setGraphStrategy(event.payload?.strategy || "multi");
    return;
  }
  if (event.event_type === "chunk_started") {
    const chunkId = Number(event.payload?.chunk_id || 1);
    if (chunkId > 1) {
      graphRuntime.nodeStatus = defaultNodeStatus(graphRuntime.strategy);
      graphRuntime.activeNode = null;
      setActiveNodeHint(null);
    }
    renderGraph();
    return;
  }
  if (event.event_type === "node_started") {
    markNodeStarted(event.payload?.node);
    renderGraph();
    return;
  }
  if (event.event_type === "node_finished") {
    markNodeFinished(event.payload?.node);
    renderGraph();
    return;
  }
  if (event.event_type === "run_failed") {
    markRunFailed();
    renderGraph();
    return;
  }
  if (event.event_type === "run_finished") {
    if (graphRuntime.activeNode) {
      markNodeFinished(graphRuntime.activeNode);
    }
    renderGraph();
  }
}

async function fetchRuns() {
  const runs = await apiGet(`/api/kbs/${encodeURIComponent(currentKbId)}/runs`);
  renderRuns(runs.slice(0, 40));
  return runs;
}

async function fetchRunDetail(runId) {
  return apiGet(`/api/kbs/${encodeURIComponent(currentKbId)}/runs/${encodeURIComponent(runId)}`);
}

async function loadDocChoices() {
  const select = byId("docSelect");
  if (!select) {
    return;
  }
  const docs = await apiGet(`/api/kbs/${encodeURIComponent(currentKbId)}/documents`);
  const parsed = docs.filter((x) => x.status === "parsed" || x.status === "parsed_low_quality");
  select.innerHTML = "";
  if (!parsed.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("hub.option.no_parsed_doc");
    select.appendChild(opt);
    return;
  }
  for (const doc of parsed) {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = `${doc.filename} (${doc.chunk_count} ${t("kb.option.chunks")})`;
    select.appendChild(opt);
  }
}

function closeEventSource() {
  if (source) {
    source.close();
    source = null;
  }
}

function clearRunView() {
  currentRunId = null;
  updateSearch(currentKbId, "");
  closeEventSource();
  byId("eventLog").innerHTML = "";
  byId("stateView").textContent = "{}";
  byId("metricsView").textContent = "{}";
  const tbody = document.querySelector("#tripleTable tbody");
  if (tbody) {
    tbody.innerHTML = "";
  }
  setGraphStrategy(byId("strategySelect")?.value || "multi");
}

function subscribeRunEvents(runId) {
  closeEventSource();
  const url = `/api/kbs/${encodeURIComponent(currentKbId)}/runs/${encodeURIComponent(runId)}/events`;
  source = new EventSource(url);
  source.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    appendEvent(event);
    applyEventToGraph(event);
    if (["node_finished", "chunk_finished", "run_finished", "run_failed"].includes(event.event_type)) {
      try {
        const run = await fetchRunDetail(runId);
        renderRunState(run);
        await fetchRuns();
      } catch (_err) {
        // Ignore transient refresh errors while run state is being updated.
      }
    }
  };
  source.onerror = () => {
    // Keep UI responsive when the stream closes after terminal run state.
  };
}

async function selectRun(runId) {
  currentRunId = runId;
  updateSearch(currentKbId, runId);
  byId("eventLog").innerHTML = "";
  const run = await fetchRunDetail(runId);
  setGraphStrategy(run.strategy || "multi");
  renderRunState(run);
  await fetchRuns();
  subscribeRunEvents(runId);
}

async function startRunWithDocument() {
  const strategy = byId("strategySelect").value;
  const docId = byId("docSelect").value;
  if (!docId) {
    alert(t("hub.alert.no_parsed_doc"));
    return;
  }
  const created = await apiPost(`/api/kbs/${encodeURIComponent(currentKbId)}/runs/start`, {
    strategy,
    document_id: docId,
    chapter_id: "chapter-1",
  });
  await selectRun(created.run_id);
}

function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".panel"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      tabs.forEach((x) => x.classList.toggle("active", x === tab));
      panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === key));
    });
  });
}

async function loadCurrentKb() {
  await loadDocChoices();
  const runs = await fetchRuns();
  if (!runs.length) {
    clearRunView();
    return;
  }

  let target = preferredRunId;
  preferredRunId = null;
  if (!target || !runs.some((x) => x.run_id === target)) {
    target = runs[0].run_id;
  }
  await selectRun(target);
}

async function refreshLanguageView() {
  setActiveNodeHint(graphRuntime.activeNode);
  renderGraph();
  await loadDocChoices();
  await fetchRuns();
  if (currentRunId) {
    const run = await fetchRunDetail(currentRunId);
    renderRunState(run);
  }
}

async function bootstrap() {
  const query = parseSearch();
  if (query.kb) {
    setCurrentKb(query.kb);
  }
  preferredRunId = query.run || null;

  await initTopBar("hub");
  currentKbId = getCurrentKb();
  setGraphStrategy(byId("strategySelect").value || "multi");
  initTabs();

  byId("runDocBtn").onclick = () => startRunWithDocument().catch((err) => alert(parseError(err)));
  byId("strategySelect").onchange = () => setGraphStrategy(byId("strategySelect").value);
  window.addEventListener("resize", renderGraph);

  window.addEventListener("kb-changed", (event) => {
    currentKbId = event.detail.kbId;
    preferredRunId = null;
    loadCurrentKb().catch((err) => alert(parseError(err)));
  });
  window.addEventListener("lang-changed", () => {
    refreshLanguageView().catch((err) => alert(parseError(err)));
  });

  await loadCurrentKb();
}

bootstrap().catch((err) => alert(parseError(err)));
