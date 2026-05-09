var currentKbId = "default";
var selectedNode = "";
var currentRows = [];
var currentGraphData = { nodes: [], links: [] };
var kgGraph = null;
var activeLinkKey = "";
var graphFrozen = false;
var particlesEnabled = false;
var showLabels = true;
var labelDegreeThreshold = 3;
var labelVisibleIds = new Set();
var hoverNode = "";

var NODE_PALETTE = ["#49d7ff", "#7cffa6", "#ffd166", "#ff8fab", "#b8a5ff", "#66f2d6", "#f6c177", "#8bd3ff"];
var RELATION_PALETTE = {
  includes: "#49d7ff",
  uses: "#7cffa6",
  belongs_to: "#ffd166",
  describes: "#b8a5ff",
  requires: "#f6c177",
  affects: "#ff8fab",
  causes: "#ff6b6b",
  submits: "#66f2d6",
  reviews: "#c084fc",
  recommends: "#7cffa6",
  related_to: "#8bd3ff",
  co_occurrence: "#ff944d",
  semantic_related: "#c084fc",
};
var LINKER_RELATIONS = { co_occurrence: true, semantic_related: true };

function byId(id) { return document.getElementById(id); }

function parseSearch() {
  var p = new URLSearchParams(window.location.search);
  return { kb: p.get("kb") || "", entity: p.get("entity") || "", limit: p.get("limit") || "" };
}

function updateSearch(kbId, entity, limit) {
  var p = new URLSearchParams(window.location.search);
  p.set("kb", kbId);
  entity ? p.set("entity", entity) : p.delete("entity");
  p.set("limit", String(limit));
  history.replaceState(null, "", window.location.pathname + "?" + p.toString());
}

function hashText(text) {
  var h = 0;
  for (var i = 0; i < String(text).length; i += 1) { h = (h * 31 + String(text).charCodeAt(i)) >>> 0; }
  return h;
}

function colorForNode(id) { return NODE_PALETTE[hashText(id) % NODE_PALETTE.length]; }

function colorForRelation(rel) { return RELATION_PALETTE[rel] || NODE_PALETTE[hashText(rel) % NODE_PALETTE.length]; }

function relationLabel(rel) {
  var key = "rel." + rel;
  var translated = t(key);
  return translated === key ? rel : translated;
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function normalizeRows(rows) {
  return (rows || []).map(function (row, i) {
    var h = row.head || "", r = row.relation || "", t = row.tail || "";
    return { head: h, relation: r, tail: t, evidence: row.evidence || "", key: h + "__" + r + "__" + t + "__" + i };
  });
}

function computeMetrics(rows) {
  var es = new Set(), rs = new Set(), adj = new Map();
  rows.forEach(function (r) {
    es.add(r.head); es.add(r.tail); rs.add(r.relation);
    if (!adj.has(r.head)) adj.set(r.head, new Set());
    if (!adj.has(r.tail)) adj.set(r.tail, new Set());
    adj.get(r.head).add(r.tail); adj.get(r.tail).add(r.head);
  });
  var maxC = 0, visited = new Set();
  es.forEach(function (n) {
    if (visited.has(n)) return;
    var stack = [n], count = 0; visited.add(n);
    while (stack.length) {
      var cur = stack.pop(); count += 1;
      (adj.get(cur) || new Set()).forEach(function (nx) { if (!visited.has(nx)) { visited.add(nx); stack.push(nx); } });
    }
    maxC = Math.max(maxC, count);
  });
  return { tripleCount: rows.length, entityCount: es.size, relationCount: rs.size, connectivity: es.size ? maxC / es.size : 0 };
}

function renderMetrics(rows) {
  var m = computeMetrics(rows);
  byId("tripleCount").textContent = String(m.tripleCount);
  byId("entityCount").textContent = String(m.entityCount);
  byId("relationCount").textContent = String(m.relationCount);
  byId("connectivityValue").textContent = m.connectivity.toFixed(2);
}

function buildGraphData(rows) {
  var nm = new Map(), links = [];
  rows.forEach(function (r) {
    [r.head, r.tail].forEach(function (id) {
      if (!nm.has(id)) nm.set(id, { id: id, degree: 0, inDegree: 0, outDegree: 0, color: colorForNode(id) });
    });
    nm.get(r.head).degree += 1; nm.get(r.head).outDegree += 1;
    nm.get(r.tail).degree += 1; nm.get(r.tail).inDegree += 1;
    links.push({ key: r.key, source: r.head, target: r.tail, relation: r.relation, evidence: r.evidence, head: r.head, tail: r.tail, color: colorForRelation(r.relation) });
  });
  return { nodes: Array.from(nm.values()).sort(function (a, b) { return b.degree - a.degree || a.id.localeCompare(b.id); }), links: links };
}

function setGraphStatus(msg, vis) {
  var s = byId("graphStatus");
  if (!s) return;
  s.textContent = msg || "";
  s.classList.toggle("visible", Boolean(vis !== false && msg));
}

function destroyGraph() {
  destroyLabelOverlay();
  if (kgGraph) { try { byId("kgGraph").innerHTML = ""; } catch (e) {} kgGraph = null; }
}

function updateEmptyState(rows) {
  var e = byId("graphEmpty");
  if (!e) return;
  e.classList.toggle("visible", !rows.length);
  e.textContent = selectedNode ? 'No triples found around "' + selectedNode + '".' : t("kg.graph.empty");
}

function getConnectedLinkCount(nid) {
  return currentGraphData.links.filter(function (l) { return l.source === nid || l.target === nid; }).length;
}

function updateNodePanel(nid) {
  nid = nid || selectedNode;
  var p = byId("nodePanel"), ti = byId("nodePanelTitle"), me = byId("nodePanelMeta");
  if (!p || !ti || !me) return;
  if (!nid) { p.classList.remove("visible"); ti.textContent = "-"; me.textContent = ""; return; }
  p.classList.add("visible");
  ti.textContent = nid;
  me.textContent = t("kg.panel.links", { count: getConnectedLinkCount(nid) });
}

function updateGraphControls() {
  var fb = byId("fullscreenGraphBtn"), frb = byId("freezeGraphBtn"), pb = byId("particlesBtn"), lb = byId("labelsBtn");
  if (fb) { var fs = isGraphFullscreen(); fb.textContent = fs ? t("kg.btn.exit_fullscreen") : t("kg.btn.fullscreen"); fb.classList.toggle("active", fs); }
  if (frb) { frb.textContent = graphFrozen ? t("kg.btn.unfreeze") : t("kg.btn.freeze"); frb.classList.toggle("active", graphFrozen); }
  if (pb) { pb.textContent = particlesEnabled ? t("kg.btn.particles_on") : t("kg.btn.particles_off"); pb.classList.toggle("active", particlesEnabled); }
  if (lb) { lb.textContent = showLabels ? t("kg.btn.labels_on") : t("kg.btn.labels_off"); lb.classList.toggle("active", showLabels); }
}

function edgeById(id) { return currentGraphData.links.find(function (l) { return l.key === id; }) || null; }

function connectedNodeIds(nid) {
  var ids = new Set();
  currentGraphData.links.forEach(function (l) {
    var s = linkSrcId(l), t = linkTgtId(l);
    if (s === nid) ids.add(t);
    if (t === nid) ids.add(s);
  });
  return ids;
}

// --- Custom node rendering (circles on canvas, labels as HTML overlay) ---

var labelOverlay = null;
var labelElems = {};

function nodeLabel(node) { return String(node.id || ""); }

function nodeRadius(node) {
  var deg = Math.max(1, node.degree || 1);
  return Math.max(3.6, Math.min(11.2, Math.sqrt(deg) * 1.8 + 3.1));
}

function nodeDisplayColor(node) {
  var id = node.id;
  if (activeLinkKey) {
    var edge = edgeById(activeLinkKey);
    if (edge && (linkSrcId(edge) === id || linkTgtId(edge) === id)) {
      return id === selectedNode ? "#ffd166" : node.color;
    }
    return "rgba(255,255,255,0.12)";
  }
  if (id === selectedNode) return "#ffd166";
  return node.color;
}

function drawNodeCanvas(node, ctx, globalScale) {
  var displayColor = nodeDisplayColor(node);
  var isSelected = node.id === selectedNode;
  var gs = globalScale || 1;
  var r = nodeRadius(node);

  node.__r = r;

  // Circle fill
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
  ctx.fillStyle = displayColor;
  ctx.fill();

  // Circle border
  ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = (isSelected ? 2.2 : 0.7) / gs;
  ctx.stroke();

  // Glow ring for selected
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 3.5, 0, 2 * Math.PI, false);
    ctx.strokeStyle = "rgba(255,209,102,0.5)";
    ctx.lineWidth = 2.4 / gs;
    ctx.stroke();
  }
}

function drawNodePointerArea(node, color, ctx) {
  var r = nodeRadius(node) + 3;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
  ctx.fillStyle = color;
  ctx.fill();
}

function destroyLabelOverlay() {
  labelElems = {};
  if (labelOverlay && labelOverlay.parentNode) {
    labelOverlay.parentNode.removeChild(labelOverlay);
  }
  labelOverlay = null;
}

function ensureLabelOverlay() {
  if (labelOverlay && labelOverlay.parentNode) return;
  var container = byId("kgGraph");
  if (!container) return;
  // Remove any stale overlay
  var old = document.getElementById("kgLabelOverlay");
  if (old) old.parentNode.removeChild(old);
  labelOverlay = document.createElement("div");
  labelOverlay.id = "kgLabelOverlay";
  labelOverlay.style.cssText = "position:absolute;inset:0;z-index:3;pointer-events:none;";
  container.appendChild(labelOverlay);
}

function syncLabels() {
  if (!kgGraph) return;
  if (!showLabels) { destroyLabelOverlay(); return; }
  ensureLabelOverlay();
  if (!labelOverlay) return;

  var visibleIds = {};
  var neighbors = selectedNode ? connectedNodeIds(selectedNode) : new Set();

  currentGraphData.nodes.forEach(function(node) {
    var nid = node.id;
    var deg = node.degree || 1;
    var isSelected = nid === selectedNode;
    var dimmed = false;
    if (activeLinkKey) {
      var activeEdge = edgeById(activeLinkKey);
      dimmed = !(activeEdge && (linkSrcId(activeEdge) === nid || linkTgtId(activeEdge) === nid));
    }

    var shouldLabel = labelVisibleIds.has(nid) || nid === hoverNode || isSelected || neighbors.has(nid) ||
      (activeLinkKey && (function() {
        var e = edgeById(activeLinkKey);
        return e && (linkSrcId(e) === nid || linkTgtId(e) === nid);
      })());

    if (!shouldLabel || dimmed) return;

    visibleIds[nid] = true;

    // Ensure node has valid coordinates
    if (typeof node.x !== "number" || typeof node.y !== "number" || isNaN(node.x) || isNaN(node.y)) return;

    var r = nodeRadius(node);
    var screenPos = kgGraph.graph2ScreenCoords(node.x, node.y + r + 2);
    if (!screenPos || typeof screenPos.x !== "number" || typeof screenPos.y !== "number" || isNaN(screenPos.x) || isNaN(screenPos.y)) return;

    var el = labelElems[nid];
    if (!el) {
      el = document.createElement("div");
      el.className = "kg-node-label";
      el.textContent = nodeLabel(node);
      el.style.cssText = "position:absolute;transform:translate(-50%,0);padding:2px 8px;border-radius:999px;" +
        "font-size:12px;font-weight:700;line-height:1.5;white-space:nowrap;" +
        "background:rgba(0,0,20,0.82);color:" + (isSelected ? "#ffd166" : "#e0e0e0") + ";" +
        "border:1px solid " + (isSelected ? "rgba(255,209,102,0.5)" : "rgba(255,255,255,0.15)") + ";" +
        "font-family:'Segoe UI','Microsoft YaHei',sans-serif;";
      labelOverlay.appendChild(el);
      labelElems[nid] = el;
    }

    el.style.left = screenPos.x + "px";
    el.style.top = screenPos.y + "px";

    // Update color for selection changes
    if (isSelected) {
      el.style.color = "#ffd166";
      el.style.borderColor = "rgba(255,209,102,0.5)";
    } else {
      el.style.color = "#e0e0e0";
      el.style.borderColor = "rgba(255,255,255,0.15)";
    }
  });

  // Remove labels for nodes no longer visible
  Object.keys(labelElems).forEach(function(id) {
    if (!visibleIds[id]) {
      if (labelElems[id] && labelElems[id].parentNode) {
        labelElems[id].parentNode.removeChild(labelElems[id]);
      }
      delete labelElems[id];
    }
  });
}

// --- Link styling ---

function linkSrcId(link) { return typeof link.source === "object" ? link.source.id : link.source; }
function linkTgtId(link) { return typeof link.target === "object" ? link.target.id : link.target; }

function hexToRgba(hex, alpha) {
  return "rgba(" + parseInt(hex.slice(1,3), 16) + "," + parseInt(hex.slice(3,5), 16) + "," + parseInt(hex.slice(5,7), 16) + "," + alpha + ")";
}

function linkDrawColor(link) {
  if (activeLinkKey && link.key === activeLinkKey) return "rgba(255,209,102,0.98)";
  if (activeLinkKey) return "rgba(255,255,255,0.08)";
  if (selectedNode) return hexToRgba(link.color, 0.72);
  if (!selectedNode && !activeLinkKey) {
    var linkerAlpha = LINKER_RELATIONS[link.relation] ? 0.16 : 0.30;
    return hexToRgba(link.color, linkerAlpha);
  }
  var s = linkSrcId(link), t = linkTgtId(link);
  if (s === selectedNode || t === selectedNode) return hexToRgba(link.color, 0.88);
  return "rgba(255,255,255,0.12)";
}

function linkDrawWidth(link) {
  if (activeLinkKey && link.key === activeLinkKey) return 2.2;
  if (activeLinkKey) return 0.32;
  var s = linkSrcId(link), t = linkTgtId(link);
  if (selectedNode && !activeLinkKey) return LINKER_RELATIONS[link.relation] ? 0.72 : 1.1;
  if (selectedNode && (s === selectedNode || t === selectedNode)) return 1.45;
  return LINKER_RELATIONS[link.relation] ? 0.44 : 0.72;
}

function linkParticleCount(link) {
  if (!particlesEnabled) return 0;
  if (activeLinkKey && link.key === activeLinkKey) return 4;
  if (activeLinkKey) return 0;
  var s = linkSrcId(link), t = linkTgtId(link);
  if (selectedNode && (s === selectedNode || t === selectedNode)) return 1;
  return 0;
}

function applyGraphStates() {
  if (!kgGraph) return;
  kgGraph
    .nodeColor(function (n) { return nodeDisplayColor(n); })
    .linkColor(function (l) { return linkDrawColor(l); })
    .linkWidth(function (l) { return linkDrawWidth(l); })
    .linkDirectionalParticles(function (l) { return linkParticleCount(l); });
  syncLabels();
}

function computeLabelSet(nodes) {
  var count = nodes.length;
  var budget = count > 500 ? 42 : count > 260 ? 56 : 72;
  var degreeCut = count > 500 ? 5 : count > 260 ? 4 : 3;
  var ids = new Set();
  nodes
    .slice()
    .sort(function (a, b) { return b.degree - a.degree || a.id.localeCompare(b.id); })
    .forEach(function (node) {
      if (ids.size < budget && node.degree >= degreeCut) {
        ids.add(node.id);
      }
    });
  return ids;
}

// --- Main graph draw ---

function drawGraph(rows, options) {
  if (!options) options = {};
  updateEmptyState(rows);
  updateNodePanel();
  updateGraphControls();

  currentGraphData = buildGraphData(rows);
  if (!rows.length) { destroyGraph(); setGraphStatus("", false); return; }

  var container = byId("kgGraph");
  if (!container) return;
  if (typeof ForceGraph === "undefined") { setGraphStatus("force-graph failed to load."); return; }

  setGraphStatus("Layout running...");
  destroyGraph();

  // Compute label threshold: top ~60% of nodes by degree, at least 3
  var degrees = currentGraphData.nodes.map(function(n) { return n.degree; }).sort(function(a,b) { return b-a; });
  var avgDeg = degrees.reduce(function(s,d) { return s+d; }, 0) / Math.max(1, degrees.length);
  labelDegreeThreshold = Math.max(5, Math.round(avgDeg * 1.6));
  labelVisibleIds = computeLabelSet(currentGraphData.nodes);
  hoverNode = "";

  try {
    kgGraph = new ForceGraph(container)
      .width(container.clientWidth || 900)
      .height(container.clientHeight || 620)
      .graphData(currentGraphData)
      .backgroundColor("#000011")
      .nodeLabel("id")
      .nodeVal("degree")
      .nodeRelSize(6)
      .nodeCanvasObjectMode("replace")
      .nodeCanvasObject(drawNodeCanvas)
      .nodePointerAreaPaint(drawNodePointerArea)
      .linkLabel("relation")
      .linkWidth(function (l) { return linkDrawWidth(l); })
      .linkLineDash(function (l) { return LINKER_RELATIONS[l.relation] ? [4, 3] : null; })
      .linkCurvature(0.08)
      .linkDirectionalParticles(function (l) { return linkParticleCount(l); })
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleWidth(2.5)
      .linkDirectionalArrowLength(5)
      .linkDirectionalArrowRelPos(0.84)
      .warmupTicks(35)
      .onNodeClick(function (node) {
        var nid = node.id || node;
        if (nid) focusNode(nid, true).catch(function (e) { alert(parseError(e)); });
      })
      .onNodeHover(function (node) {
        hoverNode = node && node.id ? node.id : "";
        container.style.cursor = hoverNode ? "pointer" : "grab";
        syncLabels();
      })
      .onLinkClick(function (link) {
        var edge = currentGraphData.links.find(function (l) { return l.key === link.key; });
        if (!edge) return;
        var focus = selectedNode || edge.head;
        activeLinkKey = edge.key;
        selectedNode = focus;
        byId("entityInput").value = focus;
        byId("graphHint").textContent = t("kg.hint.selected_path", { head: edge.head, tail: edge.tail });
        renderTable(currentRows);
        updateNodePanel(focus);
        applyGraphStates();
      })
      .onBackgroundClick(function () {
        activeLinkKey = "";
        renderTable(currentRows);
        applyGraphStates();
      })
      .onRenderFramePost(syncLabels);

    kgGraph.d3Force("charge").strength(-145);
    kgGraph.d3Force("link")
      .distance(function (link) { return LINKER_RELATIONS[link.relation] ? 130 : 104; })
      .strength(function (link) { return LINKER_RELATIONS[link.relation] ? 0.055 : 0.2; });
    if (kgGraph.d3Force("center") && typeof kgGraph.d3Force("center").strength === "function") {
      kgGraph.d3Force("center").strength(0.08);
    }
    if (typeof kgGraph.d3VelocityDecay === "function") {
      kgGraph.d3VelocityDecay(0.34);
    }

    if (graphFrozen) kgGraph.cooldownTicks(0);
    applyGraphStates();

    if (options.fit !== false) setTimeout(function () { kgGraph.zoomToFit(400, 50); }, 350);

    var m = computeMetrics(rows);
    setGraphStatus(m.tripleCount + " triples \u00b7 " + m.entityCount + " entities \u00b7 " + m.relationCount + " relations", false);
  } catch (err) {
    destroyGraph();
    setGraphStatus("Render error: " + (err && err.message ? err.message : err));
  }
}

// --- Table ---

function renderTable(rows) {
  var body = byId("graphTableBody");
  body.innerHTML = "";
  if (!rows.length) { var tr0 = document.createElement("tr"); tr0.innerHTML = '<td colspan="4">' + escapeHtml(t("kg.table.no_result")) + '</td>'; body.appendChild(tr0); return; }
  rows.forEach(function (row) {
    var tr = document.createElement("tr");
    tr.className = row.key === activeLinkKey ? "active-row" : "";
    tr.innerHTML =
      '<td>' + escapeHtml(row.head) + '</td>' +
      '<td><span class="relation-chip" style="--rel-color:' + escapeHtml(colorForRelation(row.relation)) + '">' + escapeHtml(relationLabel(row.relation)) + '</span></td>' +
      '<td>' + escapeHtml(row.tail) + '</td>' +
      '<td>' + escapeHtml(row.evidence || "") + '</td>';
    tr.onclick = function () {
      var focus = selectedNode || row.head;
      activeLinkKey = row.key;
      selectedNode = focus;
      byId("entityInput").value = focus;
      byId("graphHint").textContent = t("kg.hint.selected_path", { head: row.head, tail: row.tail });
      renderTable(currentRows); updateNodePanel(focus); applyGraphStates();
    };
    body.appendChild(tr);
  });
}

// --- Interactions ---

async function focusNode(nid, shouldQuery) {
  selectedNode = nid; activeLinkKey = "";
  byId("entityInput").value = nid;
  byId("graphHint").textContent = t("kg.hint.selected_node", { node: nid });
  renderTable(currentRows); updateNodePanel(nid); applyGraphStates();
  if (shouldQuery) await queryGraph({ fit: true });
}

function toggleFreeze() {
  graphFrozen = !graphFrozen;
  if (kgGraph) {
    if (graphFrozen) { kgGraph.cooldownTicks(0); }
    else { kgGraph.cooldownTicks(Infinity); kgGraph.graphData(currentGraphData); applyGraphStates(); }
  }
  updateGraphControls();
}

function toggleParticles() {
  particlesEnabled = !particlesEnabled;
  if (kgGraph) applyGraphStates();
  updateGraphControls();
}

function toggleLabels() {
  showLabels = !showLabels;
  if (!showLabels) destroyLabelOverlay();
  updateGraphControls();
}

// --- Fullscreen ---

function getGraphFullscreenTarget() { return byId("kgGraphCard") || byId("kgGraph"); }
function getFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function isGraphFullscreen() {
  var t = getGraphFullscreenTarget(), fe = getFullscreenElement();
  return Boolean(graphExpandedFallback || (t && fe && (fe === t || t.contains(fe))));
}
var graphExpandedFallback = false;

function resizeGraph(fit) {
  if (!kgGraph) return;
  var c = byId("kgGraph"); if (!c) return;
  kgGraph.width(c.clientWidth).height(c.clientHeight);
  if (fit) setTimeout(function () { kgGraph.zoomToFit(400, 50); }, 100);
}

async function toggleGraphFullscreen() {
  var t = getGraphFullscreenTarget(); if (!t) return;
  var fs = isGraphFullscreen();
  var rf = t.requestFullscreen || t.webkitRequestFullscreen;
  var ef = document.exitFullscreen || document.webkitExitFullscreen;
  var can = document.fullscreenEnabled !== false && typeof rf === "function";
  if (can) {
    try { if (fs && typeof ef === "function") await ef.call(document); else if (!fs) await rf.call(t); }
    catch (e) { graphExpandedFallback = !fs; t.classList.toggle("is-graph-expanded", graphExpandedFallback); }
  } else { graphExpandedFallback = !graphExpandedFallback; t.classList.toggle("is-graph-expanded", graphExpandedFallback); }
  updateGraphControls();
  setTimeout(function () { resizeGraph(true); }, 180);
}

function handleGraphFullscreenChange() {
  var t = getGraphFullscreenTarget();
  if (!getFullscreenElement()) { graphExpandedFallback = false; if (t) t.classList.remove("is-graph-expanded"); }
  updateGraphControls();
  setTimeout(function () { resizeGraph(true); }, 140);
}

async function restoreGraphOverview() {
  selectedNode = ""; activeLinkKey = ""; byId("entityInput").value = "";
  byId("graphHint").textContent = t("kg.hint.no_node"); updateNodePanel("");
  await queryGraph({ fit: true });
}

function refreshViewAfterLanguageChange() {
  renderMetrics(currentRows); renderTable(currentRows); updateGraphControls();
  byId("graphHint").textContent = selectedNode ? t("kg.hint.selected_node", { node: selectedNode }) : t("kg.hint.no_node");
  updateNodePanel();
}

function setNeo4jStatus(status) {
  var pill = byId("neo4jStatusPill");
  if (!pill) return;
  if (!status) {
    pill.className = "pill neutral";
    pill.textContent = "Neo4j: unknown";
    return;
  }
  if (status.connected) {
    pill.className = "pill good";
    pill.textContent = "Neo4j: " + status.neo4j_triples + " triples";
    return;
  }
  pill.className = status.configured ? "pill bad" : "pill warn";
  pill.textContent = status.configured ? "Neo4j: disconnected" : "Neo4j: not configured";
}

async function refreshNeo4jStatus() {
  try {
    var status = await apiGet("/api/kbs/" + encodeURIComponent(currentKbId) + "/graph/neo4j/status");
    setNeo4jStatus(status);
    return status;
  } catch (e) {
    setNeo4jStatus(null);
    throw e;
  }
}

async function syncNeo4j() {
  var btn = byId("syncNeo4jBtn");
  if (btn) btn.disabled = true;
  try {
    var result = await apiPost("/api/kbs/" + encodeURIComponent(currentKbId) + "/graph/neo4j/sync", {});
    await refreshNeo4jStatus();
    alert("Neo4j synced: " + result.synced + " triples");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openNeo4jBrowser() {
  window.open("http://127.0.0.1:7474", "_blank", "noopener");
}

// --- Data query ---

async function queryGraph(options) {
  if (!options) options = {};
  var entity = byId("entityInput").value.trim();
  var limit = Math.max(1, Math.min(2000, Number(byId("limitInput").value || 500)));
  var q = entity ? "entity=" + encodeURIComponent(entity) + "&" : "";
  var data = await apiGet("/api/kbs/" + encodeURIComponent(currentKbId) + "/graph/query?" + q + "limit=" + limit);
  selectedNode = entity; activeLinkKey = "";
  currentRows = normalizeRows(data.rows || []);
  renderMetrics(currentRows); renderTable(currentRows);
  byId("graphHint").textContent = selectedNode ? t("kg.hint.selected_node", { node: selectedNode }) : t("kg.hint.no_node");
  updateSearch(currentKbId, entity, limit);
  drawGraph(currentRows, { fit: options.fit !== false });
}

async function showAll() {
  byId("entityInput").value = ""; selectedNode = ""; activeLinkKey = "";
  await queryGraph();
}

// --- Bootstrap ---

async function bootstrap() {
  var query = parseSearch();
  if (query.kb) setCurrentKb(query.kb);
  await initTopBar("kg");
  currentKbId = getCurrentKb();
  if (query.entity) byId("entityInput").value = query.entity;
  if (query.limit) byId("limitInput").value = query.limit;

  byId("queryBtn").onclick = function () { queryGraph().catch(function (e) { alert(parseError(e)); }); };
  byId("resetBtn").onclick = function () { showAll().catch(function (e) { alert(parseError(e)); }); };
  byId("fullscreenGraphBtn").onclick = function () { toggleGraphFullscreen().catch(function (e) { alert(parseError(e)); }); };
  byId("restoreGraphBtn").onclick = function () { restoreGraphOverview().catch(function (e) { alert(parseError(e)); }); };
  byId("syncNeo4jBtn").onclick = function () { syncNeo4j().catch(function (e) { alert(parseError(e)); refreshNeo4jStatus().catch(function () {}); }); };
  byId("openNeo4jBtn").onclick = openNeo4jBrowser;
  byId("freezeGraphBtn").onclick = toggleFreeze;
  byId("particlesBtn").onclick = toggleParticles;
  byId("labelsBtn").onclick = toggleLabels;

  document.addEventListener("fullscreenchange", handleGraphFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleGraphFullscreenChange);
  window.addEventListener("resize", function () { resizeGraph(false); });
  window.addEventListener("kb-changed", function (e) { currentKbId = e.detail.kbId; refreshNeo4jStatus().catch(function () {}); showAll().catch(function (err) { alert(parseError(err)); }); });
  window.addEventListener("lang-changed", refreshViewAfterLanguageChange);
  window.addEventListener("focus-graph-entity", function (e) {
    var d = e.detail;
    var edge = currentGraphData.links.find(function (l) {
      return (l.head === d.head || l.source === d.head || (typeof l.source === "object" && l.source.id === d.head))
        && (l.tail === d.tail || l.target === d.tail || (typeof l.target === "object" && l.target.id === d.tail));
    });
    if (edge) {
      activeLinkKey = edge.key;
      selectedNode = d.head;
      byId("entityInput").value = d.head;
      byId("graphHint").textContent = t("kg.hint.selected_path", { head: d.head, tail: d.tail });
      renderTable(currentRows);
      updateNodePanel(d.head);
      applyGraphStates();
    } else {
      focusNode(d.head, true).catch(function (err) { console.error(parseError(err)); });
    }
  });

  updateGraphControls();
  refreshNeo4jStatus().catch(function () {});
  await queryGraph();
}

bootstrap().catch(function (e) { alert(parseError(e)); });
