let currentKbId = "default";
let parsedDocs = [];
let documentPollTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function statusBadge(status) {
  return `<span class="badge ${status}">${translateStatus(status)}</span>`;
}

function renderKbList(items) {
  const list = byId("kbList");
  list.innerHTML = "";
  for (const kb of items) {
    const li = document.createElement("li");
    li.className = `list-item ${kb.id === currentKbId ? "active" : ""}`;
    li.innerHTML = `<div class="title">${kb.name}</div><div class="meta">${kb.id}</div>`;
    li.onclick = () => {
      currentKbId = kb.id;
      setCurrentKb(kb.id);
      const kbSelect = byId("kbSelect");
      if (kbSelect) {
        kbSelect.value = kb.id;
      }
      loadAll().catch((err) => alert(parseError(err)));
    };
    list.appendChild(li);
  }
}

function renderDocTable(docs) {
  const tbody = byId("docTableBody");
  tbody.innerHTML = "";

  for (const doc of docs) {
    const tr = document.createElement("tr");
    const fileCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const chunkCell = document.createElement("td");
    const errorCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const deleteBtn = document.createElement("button");

    fileCell.textContent = doc.filename;
    statusCell.innerHTML = statusBadge(doc.status);
    chunkCell.textContent = String(doc.chunk_count || 0);
    errorCell.textContent = doc.error || "";
    deleteBtn.type = "button";
    deleteBtn.className = "btn compact danger";
    deleteBtn.textContent = "删除";
    deleteBtn.disabled = doc.status === "parsing";
    deleteBtn.onclick = () => deleteDocument(doc).catch((err) => alert(parseError(err)));
    actionCell.appendChild(deleteBtn);

    tr.append(fileCell, statusCell, chunkCell, errorCell, actionCell);
    tbody.appendChild(tr);
  }

  parsedDocs = docs.filter((x) => x.status === "parsed" || x.status === "parsed_low_quality");
  renderDocumentMetrics(docs);
  renderDocumentQueue(docs);
  const docSelect = byId("docSelect");
  docSelect.innerHTML = "";
  for (const doc of parsedDocs) {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = `${doc.filename} (${doc.chunk_count} ${t("kb.option.chunks")})`;
    docSelect.appendChild(opt);
  }
}

function renderDocumentMetrics(docs) {
  const parsed = docs.filter((doc) => doc.status === "parsed" || doc.status === "parsed_low_quality").length;
  const parsing = docs.filter((doc) => doc.status === "uploaded" || doc.status === "parsing").length;
  const chunks = docs.reduce((sum, doc) => sum + Number(doc.chunk_count || 0), 0);
  const metrics = {
    docTotalMetric: docs.length,
    docParsedMetric: parsed,
    docParsingMetric: parsing,
    chunkTotalMetric: chunks,
  };
  for (const [id, value] of Object.entries(metrics)) {
    const el = byId(id);
    if (el) {
      el.textContent = String(value);
    }
  }
}

function renderDocumentQueue(docs) {
  const list = byId("docQueueList");
  if (!list) {
    return;
  }
  list.innerHTML = "";
  if (!docs.length) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>暂无文档</strong><div class="kb-queue-meta"><span>上传后会显示处理状态</span></div>`;
    list.appendChild(li);
    return;
  }
  for (const doc of docs.slice(0, 6)) {
    const li = document.createElement("li");
    li.innerHTML = `<strong title="${doc.filename}">${doc.filename}</strong>
      <div class="kb-queue-meta"><span>${translateStatus(doc.status)}</span><span>${doc.chunk_count || 0} 分块</span></div>`;
    list.appendChild(li);
  }
}

function renderPendingUploadRow(filename) {
  const tbody = byId("docTableBody");
  if (!tbody) {
    return;
  }
  const tr = document.createElement("tr");
  const fileCell = document.createElement("td");
  const statusCell = document.createElement("td");
  const chunkCell = document.createElement("td");
  const messageCell = document.createElement("td");
  fileCell.textContent = filename;
  statusCell.innerHTML = statusBadge("parsing");
  chunkCell.textContent = "-";
  messageCell.textContent = "正在上传、解析并分块，请等待当前请求完成。";
  tr.append(fileCell, statusCell, chunkCell, messageCell, document.createElement("td"));
  tbody.prepend(tr);
}

function renderRunList(runs) {
  const list = byId("runList");
  if (!list) {
    return;
  }
  list.innerHTML = "";
  for (const run of runs) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `<div class="title">${run.run_id.slice(0, 8)} | ${run.strategy}</div>
      <div class="meta">${translateStatus(run.status)} | ${t("label.triples")}: ${run.summary?.triple_count ?? "-"}</div>`;
    li.onclick = () => {
      setCurrentKb(currentKbId);
      window.location.href = `./hub.html?kb=${encodeURIComponent(currentKbId)}&run=${encodeURIComponent(run.run_id)}`;
    };
    list.appendChild(li);
  }
}

function setBatchStatus(text, tone = "") {
  const el = byId("batchRunStatus");
  if (!el) {
    return;
  }
  el.classList.remove("status-good", "status-warn", "status-bad", "status-busy");
  if (tone) {
    el.classList.add(`status-${tone}`);
  }
  el.textContent = text || "";
}

function setBatchButtonsDisabled(disabled) {
  for (const id of ["runDocBtn", "runBatchBtn"]) {
    const el = byId(id);
    if (el) {
      el.disabled = disabled;
    }
  }
}

function setUploadDisabled(disabled) {
  for (const id of ["uploadBtn", "fileInput"]) {
    const el = byId(id);
    if (el) {
      el.disabled = disabled;
    }
  }
}

function setWorkbenchDisabled(disabled) {
  for (const id of ["createKbBtn", "deleteKbBtn", "workbenchKbSelect", "uploadBtn", "fileInput", "runDocBtn", "runBatchBtn"]) {
    const el = byId(id);
    if (el) {
      el.disabled = disabled;
    }
  }
}

function updateKbActions() {
  const deleteKbBtn = byId("deleteKbBtn");
  if (deleteKbBtn) {
    deleteKbBtn.disabled = currentKbId === "default";
    deleteKbBtn.title = currentKbId === "default" ? "默认知识库不能删除" : "删除当前知识库";
  }
}

async function loadAll() {
  const kbs = await apiGet("/api/kbs");
  renderKbList(kbs);
  const docs = await apiGet(`/api/kbs/${encodeURIComponent(currentKbId)}/documents`);
  renderDocTable(docs);
  updateKbActions();
  if (byId("runList")) {
    const runs = await apiGet(`/api/kbs/${encodeURIComponent(currentKbId)}/runs`);
    renderRunList(runs.slice(0, 40));
  }
  return docs;
}

async function createKb() {
  const name = byId("kbNameInput").value.trim();
  const description = byId("kbDescInput").value.trim();
  if (!name) {
    alert(t("kb.alert.name_required"));
    return;
  }
  setWorkbenchDisabled(true);
  setBatchStatus(`正在创建知识库「${name}」...`, "busy");
  try {
    const kb = await apiPost("/api/kbs", { name, description });
    currentKbId = kb.id;
    setCurrentKb(kb.id);
    byId("kbNameInput").value = "";
    byId("kbDescInput").value = "";
    await refreshKbSelect();
    await loadAll();
    setBatchStatus(`知识库「${kb.name || name}」创建成功，已切换到该知识库。`, "good");
  } catch (err) {
    setBatchStatus(`知识库创建失败：${parseError(err)}`, "bad");
    throw err;
  } finally {
    setWorkbenchDisabled(false);
  }
}

async function uploadDoc() {
  const fileInput = byId("fileInput");
  const file = fileInput.files?.[0];
  if (!file) {
    alert(t("kb.alert.choose_file"));
    return;
  }
  setUploadDisabled(true);
  setBatchStatus(`正在上传「${file.name}」...`, "busy");
  renderPendingUploadRow(file.name);
  try {
    const doc = await apiUpload(`/api/kbs/${encodeURIComponent(currentKbId)}/documents/upload`, file);
    fileInput.value = "";
    await loadAll();
    setBatchStatus(`已上传「${doc.filename || file.name}」，后台正在 OCR/解析/分块。`, "busy");
    startDocumentPolling(currentKbId, doc.id, doc.filename || file.name);
  } catch (err) {
    setBatchStatus(`上传或解析失败：${parseError(err)}`, "bad");
    throw err;
  } finally {
    setUploadDisabled(false);
  }
}

function stopDocumentPolling() {
  if (documentPollTimer) {
    window.clearTimeout(documentPollTimer);
    documentPollTimer = null;
  }
}

function startDocumentPolling(kbId, documentId, filename) {
  stopDocumentPolling();
  const tick = async () => {
    if (kbId !== currentKbId) {
      stopDocumentPolling();
      return;
    }
    const docs = await loadAll();
    const doc = docs.find((item) => item.id === documentId);
    if (!doc) {
      setBatchStatus(`文档「${filename}」已不在当前知识库。`, "warn");
      stopDocumentPolling();
      return;
    }
    if (doc.status === "parsed" || doc.status === "parsed_low_quality") {
      const qualityHint = doc.status === "parsed_low_quality" ? "，但文本质量偏低" : "";
      setBatchStatus(`解析完成：${doc.filename}，共 ${doc.chunk_count || 0} 个分块${qualityHint}。`, doc.status === "parsed_low_quality" ? "warn" : "good");
      stopDocumentPolling();
      return;
    }
    if (doc.status === "failed") {
      setBatchStatus(`解析失败：${doc.error || doc.filename}`, "bad");
      stopDocumentPolling();
      return;
    }
    setBatchStatus(`正在解析「${doc.filename}」；大 PDF/OCR 会持续几分钟，当前已在后台运行。`, "busy");
    documentPollTimer = window.setTimeout(tick, 2500);
  };
  documentPollTimer = window.setTimeout(tick, 800);
}

async function deleteDocument(doc) {
  if (!confirm(`确定删除文档「${doc.filename}」吗？对应图谱三元组也会一起清理。`)) {
    return;
  }
  setBatchStatus(`正在删除文档「${doc.filename}」...`, "busy");
  await apiDelete(`/api/kbs/${encodeURIComponent(currentKbId)}/documents/${encodeURIComponent(doc.id)}`);
  await loadAll();
  setBatchStatus(`文档「${doc.filename}」已删除。`, "good");
}

async function deleteCurrentKb() {
  if (currentKbId === "default") {
    alert("默认知识库不能删除。");
    return;
  }
  const select = byId("workbenchKbSelect") || byId("kbSelect");
  const label = select?.selectedOptions?.[0]?.textContent || currentKbId;
  if (!confirm(`确定删除知识库「${label}」吗？其中的文档和图谱数据都会删除。`)) {
    return;
  }
  stopDocumentPolling();
  setWorkbenchDisabled(true);
  setBatchStatus(`正在删除知识库「${label}」...`, "busy");
  try {
    await apiDelete(`/api/kbs/${encodeURIComponent(currentKbId)}`);
    await refreshKbSelect();
    currentKbId = getCurrentKb();
    await loadAll();
    setBatchStatus(`知识库「${label}」已删除。`, "good");
  } catch (err) {
    setBatchStatus(`删除知识库失败：${parseError(err)}`, "bad");
    throw err;
  } finally {
    setWorkbenchDisabled(false);
    updateKbActions();
  }
}

async function runOnDocument() {
  const docId = byId("docSelect").value;
  const strategy = byId("strategySelect").value;
  if (!docId) {
    alert(t("kb.alert.no_parsed_doc"));
    return;
  }
  setBatchButtonsDisabled(true);
  setBatchStatus("正在创建多智能体运行任务，创建成功后会自动进入执行界面...", "busy");
  const run = await apiPost(`/api/kbs/${encodeURIComponent(currentKbId)}/runs/start`, {
    strategy,
    document_id: docId,
    chapter_id: "chapter-1",
  });
  setCurrentKb(currentKbId);
  setBatchStatus("运行任务已创建，正在进入多智能体执行界面...", "good");
  window.location.assign(`./agent-run/?kb=${encodeURIComponent(currentKbId)}&run=${encodeURIComponent(run.run_id)}`);
}

async function runBatchDocuments() {
  if (!parsedDocs.length) {
    alert(t("kb.alert.no_parsed_doc"));
    return;
  }
  const strategy = byId("strategySelect").value;
  setBatchButtonsDisabled(true);
  setBatchStatus(t("kb.batch.start", { count: parsedDocs.length, strategy }), "busy");

  let successCount = 0;
  const runIds = [];
  const failed = [];
  for (let i = 0; i < parsedDocs.length; i += 1) {
    const doc = parsedDocs[i];
    setBatchStatus(t("kb.batch.progress", { index: i + 1, total: parsedDocs.length, name: doc.filename }), "busy");
    try {
      const run = await apiPost(`/api/kbs/${encodeURIComponent(currentKbId)}/runs/start`, {
        strategy,
        document_id: doc.id,
        chapter_id: "chapter-1",
      });
      runIds.push(run.run_id);
      successCount += 1;
    } catch (err) {
      failed.push(`${doc.filename}: ${parseError(err)}`);
    }
  }

  await loadAll();
  setBatchButtonsDisabled(false);

  if (!failed.length) {
    setBatchStatus(t("kb.batch.done", { success: successCount }), "good");
    if (runIds.length) {
      setCurrentKb(currentKbId);
      window.location.href = `./agent-run/?kb=${encodeURIComponent(currentKbId)}&runs=${encodeURIComponent(runIds.join(","))}`;
    }
    return;
  }
  setBatchStatus(t("kb.batch.partial", { success: successCount, failed: failed.length }), "warn");
  alert(failed.join("\n"));
  if (runIds.length) {
    setCurrentKb(currentKbId);
    window.location.href = `./agent-run/?kb=${encodeURIComponent(currentKbId)}&runs=${encodeURIComponent(runIds.join(","))}`;
  }
}

async function bootstrap() {
  await initTopBar("kb");
  currentKbId = getCurrentKb();

  byId("createKbBtn").onclick = () => createKb().catch((e) => alert(parseError(e)));
  byId("deleteKbBtn").onclick = () => deleteCurrentKb().catch((e) => alert(parseError(e)));
  byId("uploadBtn").onclick = () => uploadDoc().catch((e) => alert(parseError(e)));
  byId("runDocBtn").onclick = () => runOnDocument().catch((e) => {
    setBatchButtonsDisabled(false);
    setBatchStatus(`启动失败：${parseError(e)}`, "bad");
    alert(parseError(e));
  });
  byId("runBatchBtn").onclick = () => runBatchDocuments().catch((e) => {
    setBatchButtonsDisabled(false);
    setBatchStatus(`批量构建失败：${parseError(e)}`, "bad");
    alert(parseError(e));
  });

  window.addEventListener("kb-changed", (e) => {
    stopDocumentPolling();
    currentKbId = e.detail.kbId;
    loadAll().catch((err) => alert(parseError(err)));
  });
  byId("evalRunBtn").onclick = () => runEval().catch((e) => alert(parseError(e)));

  window.addEventListener("lang-changed", () => {
    loadAll().catch((err) => alert(parseError(err)));
  });

  await loadAll();
}

async function runEval() {
  var btn = byId("evalRunBtn");
  var status = byId("evalStatus");
  var wrap = byId("evalTableWrap");
  var body = byId("evalTableBody");

  btn.disabled = true;
  btn.textContent = "评测运行中...";
  status.hidden = false;
  status.textContent = "正在对三种策略逐一评测，请稍候...";
  status.className = "eval-status eval-status--running";
  wrap.hidden = true;

  try {
    var data = await apiPost("/api/kbs/" + encodeURIComponent(currentKbId) + "/evaluation/run", {});
    status.hidden = true;
    wrap.hidden = false;
    body.innerHTML = "";

    (data.results || []).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><strong>" + escapeHtml(r.strategy) + "</strong></td>" +
        "<td>" + (r.precision * 100).toFixed(1) + "%</td>" +
        "<td>" + (r.recall * 100).toFixed(1) + "%</td>" +
        "<td>" + (r.f1 * 100).toFixed(1) + "%</td>" +
        "<td>" + r.tp + "</td>" +
        "<td>" + r.fp + "</td>" +
        "<td>" + r.fn + "</td>";
      body.appendChild(tr);
    });

    btn.textContent = "运行评测";
    btn.disabled = false;
  } catch (err) {
    status.textContent = "评测失败：" + parseError(err);
    status.className = "eval-status eval-status--bad";
    btn.textContent = "运行评测";
    btn.disabled = false;
  }
}

bootstrap().catch((err) => alert(parseError(err)));
