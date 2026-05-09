const STORAGE_KEYS = {
  kb: "kgtool.current_kb",
  theme: "kgtool.theme",
  lang: "kgtool.lang",
  sidebarCollapsed: "kgtool.sidebar_collapsed",
};

const I18N = {
  zh: {
    "lang.zh": "中文",
    "lang.en": "English",
    "theme.bright": "明亮",
    "theme.night": "暗夜",
    "nav.kb": "文档构建",
    "nav.kg": "图谱浏览",
    "pill.checking": "检查中...",
    "pill.backend_ok": "后端正常",
    "pill.backend_error": "后端异常",
    "pill.model_unknown": "模型：未知",
    "pill.model_connected": "模型：已连接",
    "pill.model_fallback": "模型：启发式兜底",
    "status.uploaded": "已上传",
    "status.parsing": "解析中",
    "status.parsed": "已解析",
    "status.parsed_low_quality": "解析完成（低质量）",
    "status.failed": "失败",
    "status.running": "运行中",
    "status.completed": "已完成",
    "status.idle": "空闲",
    "label.triples": "三元组",
    "label.entities": "实体",
    "label.no_data": "暂无数据",
    "settings.open": "设置",
    "settings.title": "显示与偏好",
    "settings.label.lang": "语言",
    "settings.label.theme": "主题",
    "settings.label.kb": "默认知识库",
    "settings.close": "关闭",
    "sidebar.collapse": "收起侧栏",
    "sidebar.expand": "展开侧栏",
    "kb.subtitle": "文档构建",
    "kb.section.kbs": "知识库列表",
    "kb.input.kb_name": "知识库名称",
    "kb.input.kb_desc": "描述（可选）",
    "kb.btn.create": "创建知识库",
    "kb.section.upload_parse": "上传与解析",
    "kb.btn.upload": "上传文档",
    "kb.hint.supported": "支持格式：PDF、DOCX、TXT",
    "kb.section.documents": "文档列表",
    "kb.table.file": "文件",
    "kb.table.type": "类型",
    "kb.table.status": "状态",
    "kb.table.chunks": "分块数",
    "kb.table.error": "错误信息",
    "kb.section.start": "启动抽取",
    "kb.btn.run_doc": "按文档运行",
    "kb.btn.run_batch": "批量运行已解析文档",
    "kb.btn.run_text": "按文本运行",
    "kb.placeholder.manual_text": "或粘贴文本后运行...",
    "kb.section.latest_runs": "当前知识库最近运行",
    "kb.alert.name_required": "知识库名称不能为空",
    "kb.alert.choose_file": "请选择文件",
    "kb.alert.no_parsed_doc": "当前没有可运行的已解析文档",
    "kb.alert.input_text": "请输入文本",
    "kb.option.chunks": "分块",
    "kb.flow": "流程：上传文档 → 解析分块 → 执行抽取（single/ontology/multi）→ 写入知识图谱",
    "kb.batch.start": "开始批量提交：共 {count} 个文档，策略 {strategy}",
    "kb.batch.progress": "批量提交中：{index}/{total} - {name}",
    "kb.batch.done": "批量提交完成：成功 {success} 个文档",
    "kb.batch.partial": "批量提交完成：成功 {success}，失败 {failed}",
    "hub.subtitle": "多智能体中枢",
    "hub.section.run_control": "运行控制",
    "hub.btn.run_doc": "运行文档",
    "hub.btn.run_text": "运行文本",
    "hub.placeholder.manual_text": "或粘贴文本后运行...",
    "hub.section.runs_current": "当前知识库运行记录",
    "hub.section.workflow": "Agent 工作流",
    "hub.section.timeline": "事件时间线",
    "hub.section.inspector": "运行详情",
    "hub.tab.state": "状态",
    "hub.tab.triples": "三元组",
    "hub.tab.metrics": "指标",
    "hub.table.head": "头实体",
    "hub.table.relation": "关系",
    "hub.table.tail": "尾实体",
    "hub.table.conf": "置信度",
    "hub.hint.active_node": "当前节点：{node}",
    "hub.hint.active_node_none": "当前节点：无",
    "hub.option.no_parsed_doc": "暂无可用已解析文档",
    "hub.alert.no_parsed_doc": "当前没有可运行的已解析文档",
    "hub.alert.input_text": "请输入文本",
    "kg.subtitle": "知识图谱浏览",
    "kg.section.query": "图谱查询",
    "kg.input.kb": "知识库",
    "kg.input.entity": "实体名（可选）",
    "kg.btn.query": "查询",
    "kg.btn.show_all": "查看全部",
    "kg.btn.fullscreen": "全屏",
    "kg.btn.exit_fullscreen": "退出全屏",
    "kg.btn.restore_view": "还原大视图",
    "kg.btn.copy_cypher": "复制 Cypher",
    "kg.btn.sync_neo4j": "同步 Neo4j",
    "kg.btn.open_neo4j": "打开 Neo4j",
    "kg.btn.expand_node": "展开邻居",
    "kg.btn.fit": "适配视图",
    "kg.btn.freeze": "冻结布局",
    "kg.btn.unfreeze": "释放布局",
    "kg.btn.particles": "粒子",
    "kg.btn.particles_on": "粒子开启",
    "kg.btn.particles_off": "粒子关闭",
    "kg.btn.labels": "标签",
    "kg.btn.labels_on": "标签开启",
    "kg.btn.labels_off": "标签关闭",
    "kg.hint.click_node": "点击节点可聚焦实体并刷新邻域三元组。",
    "kg.hint.table": "点击三元组可高亮对应关系路径。",
    "kg.metric.triples": "三元组",
    "kg.metric.entities": "实体数",
    "kg.metric.relations": "关系数",
    "kg.metric.connectivity": "连通度",
    "kg.section.graph_view": "图谱视图",
    "kg.section.neo4j_view": "Neo4j 图谱视图",
    "kg.section.triples": "三元组",
    "kg.hint.neo4j": "Neo4j 风格图谱工作台：默认展示核心关系，点击节点查看邻居。",
    "kg.table.head": "头实体",
    "kg.table.relation": "关系",
    "kg.table.tail": "尾实体",
    "kg.table.evidence": "证据",
    "kg.hint.no_node": "未选中节点",
    "kg.hint.selected_node": "当前节点：{node}",
    "kg.hint.selected_path": "当前路径：{head} → {tail}",
    "kg.graph.empty": "当前知识库暂无三元组",
    "kg.panel.selected": "选中实体",
    "kg.panel.links": "{count} 条关系",
    "kg.table.no_result": "无结果",
    "nav.chat": "智能助手",
    "chat.subtitle": "知识图谱问答",
    "chat.input.placeholder": "输入问题，基于知识图谱回答...",
    "chat.btn.send": "发送",
    "chat.sources": "来源三元组",
    "chat.sources.show": "显示来源",
    "chat.sources.hide": "隐藏来源",
    "chat.empty": "基于当前知识图谱提问，系统将检索相关三元组并生成回答。",
    "chat.thinking": "思考中...",
    "chat.fallback": "（模型未连接，以下为检索到的相关三元组）",
    "chat.error": "请求失败，请检查后端服务。",
    "rel.co_occurrence": "共现关联",
    "rel.semantic_related": "语义关联",
  },
  en: {
    "lang.zh": "中文",
    "lang.en": "English",
    "theme.bright": "Bright",
    "theme.night": "Night",
    "nav.kb": "Build",
    "nav.kg": "KG Explorer",
    "pill.checking": "Checking...",
    "pill.backend_ok": "Backend OK",
    "pill.backend_error": "Backend error",
    "pill.model_unknown": "Model: unknown",
    "pill.model_connected": "Model: connected",
    "pill.model_fallback": "Model: heuristic fallback",
    "status.uploaded": "uploaded",
    "status.parsing": "parsing",
    "status.parsed": "parsed",
    "status.parsed_low_quality": "parsed_low_quality",
    "status.failed": "failed",
    "status.running": "running",
    "status.completed": "completed",
    "status.idle": "idle",
    "label.triples": "triples",
    "label.entities": "entities",
    "label.no_data": "No data",
    "settings.open": "Settings",
    "settings.title": "Display and Preferences",
    "settings.label.lang": "Language",
    "settings.label.theme": "Theme",
    "settings.label.kb": "Default Knowledge Base",
    "settings.close": "Close",
    "sidebar.collapse": "Collapse sidebar",
    "sidebar.expand": "Expand sidebar",
    "kb.subtitle": "Knowledge Base Manager",
    "kb.section.kbs": "Knowledge Bases",
    "kb.input.kb_name": "KB name",
    "kb.input.kb_desc": "Description (optional)",
    "kb.btn.create": "Create KB",
    "kb.section.upload_parse": "Upload and Parse",
    "kb.btn.upload": "Upload Document",
    "kb.hint.supported": "Supported: PDF, DOCX, TXT",
    "kb.section.documents": "Documents",
    "kb.table.file": "File",
    "kb.table.type": "Type",
    "kb.table.status": "Status",
    "kb.table.chunks": "Chunks",
    "kb.table.error": "Error",
    "kb.section.start": "Start Extraction",
    "kb.btn.run_doc": "Run on Document",
    "kb.btn.run_batch": "Batch Run Parsed Docs",
    "kb.btn.run_text": "Run on Text",
    "kb.placeholder.manual_text": "Or paste custom text...",
    "kb.section.latest_runs": "Latest Runs in Current KB",
    "kb.alert.name_required": "KB name is required",
    "kb.alert.choose_file": "Please choose a file",
    "kb.alert.no_parsed_doc": "No parsed document available",
    "kb.alert.input_text": "Please input text",
    "kb.option.chunks": "chunks",
    "kb.flow": "Flow: Upload file -> Parse into chunks -> Run extraction (single/ontology/multi) -> Write triples to graph",
    "kb.batch.start": "Batch start: {count} documents with strategy {strategy}",
    "kb.batch.progress": "Submitting: {index}/{total} - {name}",
    "kb.batch.done": "Batch submitted: {success} documents",
    "kb.batch.partial": "Batch submitted: success {success}, failed {failed}",
    "hub.subtitle": "Agent Hub",
    "hub.section.run_control": "Run Control",
    "hub.btn.run_doc": "Run Doc",
    "hub.btn.run_text": "Run Text",
    "hub.placeholder.manual_text": "Or run with pasted text...",
    "hub.section.runs_current": "Runs in Current KB",
    "hub.section.workflow": "Agent Workflow",
    "hub.section.timeline": "Event Timeline",
    "hub.section.inspector": "Run Inspector",
    "hub.tab.state": "State",
    "hub.tab.triples": "Triples",
    "hub.tab.metrics": "Metrics",
    "hub.table.head": "Head",
    "hub.table.relation": "Relation",
    "hub.table.tail": "Tail",
    "hub.table.conf": "Conf.",
    "hub.hint.active_node": "Active node: {node}",
    "hub.hint.active_node_none": "Active node: none",
    "hub.option.no_parsed_doc": "No parsed documents",
    "hub.alert.no_parsed_doc": "No parsed document available",
    "hub.alert.input_text": "Please input text",
    "kg.subtitle": "Knowledge Graph Explorer",
    "kg.section.query": "Graph Query",
    "kg.input.kb": "Knowledge Base",
    "kg.input.entity": "Entity name (optional)",
    "kg.btn.query": "Query",
    "kg.btn.show_all": "Show All",
    "kg.btn.fullscreen": "Fullscreen",
    "kg.btn.exit_fullscreen": "Exit Fullscreen",
    "kg.btn.restore_view": "Restore Overview",
    "kg.btn.copy_cypher": "Copy Cypher",
    "kg.btn.sync_neo4j": "Sync Neo4j",
    "kg.btn.open_neo4j": "Open Neo4j",
    "kg.btn.expand_node": "Expand Neighbors",
    "kg.btn.fit": "Fit View",
    "kg.btn.freeze": "Freeze",
    "kg.btn.unfreeze": "Release",
    "kg.btn.particles": "Particles",
    "kg.btn.particles_on": "Particles On",
    "kg.btn.particles_off": "Particles Off",
    "kg.btn.labels": "Labels",
    "kg.btn.labels_on": "Labels On",
    "kg.btn.labels_off": "Labels Off",
    "kg.hint.click_node": "Click a node to focus that entity and refresh neighborhood triples.",
    "kg.hint.table": "Click a triple to highlight its path.",
    "kg.metric.triples": "Triples",
    "kg.metric.entities": "Entities",
    "kg.metric.relations": "Relations",
    "kg.metric.connectivity": "Connected Ratio",
    "kg.section.graph_view": "Graph View",
    "kg.section.neo4j_view": "Neo4j Graph View",
    "kg.section.triples": "Triples",
    "kg.hint.neo4j": "Neo4j-style graph workspace: core view by default, click a node to inspect neighbors.",
    "kg.table.head": "Head",
    "kg.table.relation": "Relation",
    "kg.table.tail": "Tail",
    "kg.table.evidence": "Evidence",
    "kg.hint.no_node": "No node selected",
    "kg.hint.selected_node": "Selected node: {node}",
    "kg.hint.selected_path": "Selected path: {head} -> {tail}",
    "kg.graph.empty": "No triples in this knowledge base",
    "kg.panel.selected": "Selected Entity",
    "kg.panel.links": "{count} links",
    "kg.table.no_result": "No result",
    "nav.chat": "Chat",
    "chat.subtitle": "KG Q&A",
    "chat.input.placeholder": "Ask a question about the knowledge graph...",
    "chat.btn.send": "Send",
    "chat.sources": "Sources",
    "chat.sources.show": "Show Sources",
    "chat.sources.hide": "Hide Sources",
    "chat.empty": "Ask questions about the current knowledge base. The system will retrieve relevant triples and generate an answer.",
    "chat.thinking": "Thinking...",
    "chat.fallback": "(Model not connected. Showing retrieved triples below.)",
    "chat.error": "Request failed. Please check the backend service.",
    "rel.co_occurrence": "Co-occurrence",
    "rel.semantic_related": "Semantic Related",
  },
};

function getLanguage() {
  const saved = localStorage.getItem(STORAGE_KEYS.lang);
  if (saved === "zh" || saved === "en") {
    return saved;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function formatI18n(text, vars = {}) {
  return text.replace(/\{(\w+)\}/g, (_, key) => (vars[key] === undefined ? "" : String(vars[key])));
}

function t(key, vars = {}) {
  const lang = getLanguage();
  const table = I18N[lang] || I18N.en;
  const fallback = I18N.en[key] || key;
  return formatI18n(table[key] || fallback, vars);
}

function translateStatus(status) {
  return t(`status.${status}`);
}

function setLanguage(lang) {
  const next = lang === "zh" ? "zh" : "en";
  localStorage.setItem(STORAGE_KEYS.lang, next);
  document.documentElement.setAttribute("lang", next === "zh" ? "zh-CN" : "en");
  applyI18n();
  setSidebarCollapsed(isSidebarCollapsed());
}

function getTheme() {
  const theme = localStorage.getItem(STORAGE_KEYS.theme) || "bright";
  return theme === "night" ? "night" : "bright";
}

function setTheme(theme) {
  const next = theme === "night" ? "night" : "bright";
  localStorage.setItem(STORAGE_KEYS.theme, next);
  document.documentElement.setAttribute("data-theme", next);
  document.body.setAttribute("data-theme", next);
}

function getCurrentKb() {
  return localStorage.getItem(STORAGE_KEYS.kb) || "default";
}

function setCurrentKb(kbId) {
  localStorage.setItem(STORAGE_KEYS.kb, kbId);
}

function isSidebarCollapsed() {
  return localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "1";
}

function setSidebarCollapsed(collapsed) {
  localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, collapsed ? "1" : "0");
  document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  if (toggleBtn) {
    toggleBtn.title = collapsed ? t("sidebar.expand") : t("sidebar.collapse");
  }
}

function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key);
    }
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      el.setAttribute("placeholder", t(key));
    }
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      el.setAttribute("title", t(key));
    }
  });
}

function parseError(err) {
  return err instanceof Error ? err.message : String(err);
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiUpload(url, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

function setHealthPill(el, health) {
  if (!health || !health.ok) {
    el.className = "pill bad";
    el.textContent = t("pill.backend_error");
    return;
  }
  el.className = "pill good";
  el.textContent = t("pill.backend_ok");
}

function setModelPill(el, health) {
  if (!health) {
    el.className = "pill neutral";
    el.textContent = t("pill.model_unknown");
    return;
  }
  if (health.model_adapter_enabled) {
    el.className = "pill good";
    el.textContent = t("pill.model_connected");
    return;
  }
  el.className = "pill warn";
  el.textContent = t("pill.model_fallback");
}

function syncKbSelectValues(kbId) {
  const selects = Array.from(document.querySelectorAll("[data-kb-select]"));
  selects.forEach((select) => {
    if (select instanceof HTMLSelectElement) {
      select.value = kbId;
    }
  });
}

async function refreshKbSelects() {
  const selects = Array.from(document.querySelectorAll("[data-kb-select]"));
  const kbs = await apiGet("/api/kbs");

  let current = getCurrentKb();
  if (!kbs.some((kb) => kb.id === current) && kbs.length > 0) {
    current = kbs[0].id;
    setCurrentKb(current);
  }

  selects.forEach((select) => {
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const previous = select.value;
    select.innerHTML = "";
    kbs.forEach((kb) => {
      const opt = document.createElement("option");
      opt.value = kb.id;
      opt.textContent = `${kb.name} · ${String(kb.id).slice(0, 8)}`;
      opt.title = kb.id;
      select.appendChild(opt);
    });

    if (kbs.some((kb) => kb.id === previous)) {
      select.value = previous;
    } else if (kbs.some((kb) => kb.id === current)) {
      select.value = current;
    } else if (kbs.length > 0) {
      select.value = kbs[0].id;
    }
  });
  syncKbSelectValues(current);
  return kbs;
}

async function refreshKbSelect() {
  return refreshKbSelects();
}

function initPageTransitions() {
  requestAnimationFrame(() => {
    document.body.classList.add("page-mounted");
  });

  const links = Array.from(document.querySelectorAll(".nav a"));
  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }
      const nextUrl = new URL(href, window.location.href);
      const samePage = nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search;
      if (samePage) {
        return;
      }
      event.preventDefault();
      document.body.classList.add("page-leaving");
      setTimeout(() => {
        window.location.href = nextUrl.href;
      }, 165);
    });
  });
}

function initSidebarControl() {
  const collapseBtn = document.getElementById("sidebarToggleBtn");
  setSidebarCollapsed(isSidebarCollapsed());
  if (collapseBtn) {
    collapseBtn.onclick = () => setSidebarCollapsed(!isSidebarCollapsed());
  }
}

function openSettingsPanel() {
  document.body.classList.add("settings-open");
}

function closeSettingsPanel() {
  document.body.classList.remove("settings-open");
}

function initSettingsPanel() {
  const openBtn = document.getElementById("settingsBtn");
  const closeBtn = document.getElementById("settingsCloseBtn");
  const backdrop = document.getElementById("settingsBackdrop");

  if (openBtn) {
    openBtn.onclick = () => openSettingsPanel();
  }
  if (closeBtn) {
    closeBtn.onclick = () => closeSettingsPanel();
  }
  if (backdrop) {
    backdrop.onclick = () => closeSettingsPanel();
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (chatPopupVisible) {
        toggleChatPopup(false);
      } else {
        closeSettingsPanel();
      }
    }
  });
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

var chatPopupVisible = false;
var chatPopupThinking = false;

function createFloatingChatButton() {
  if (document.getElementById("floatChatBtn")) return;

  var btn = document.createElement("button");
  btn.id = "floatChatBtn";
  btn.setAttribute("data-tooltip", "智能助手");
  btn.setAttribute("aria-label", "智能助手");

  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="float-chat-icon">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' +
    '</svg>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="float-close-icon">' +
    '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' +
    '</svg>';

  btn.onclick = function () {
    toggleChatPopup();
  };

  document.body.appendChild(btn);
  createChatPopup();
}

function createChatPopup() {
  if (document.getElementById("chatPopup")) return;

  var popup = document.createElement("div");
  popup.id = "chatPopup";
  popup.className = "chat-popup";

  popup.innerHTML =
    '<div class="chat-popup-header">' +
    '<span class="chat-popup-title">智能助手</span>' +
    '<button class="chat-popup-close" id="chatPopupClose">&times;</button>' +
    '</div>' +
    '<div class="chat-popup-body" id="chatPopupBody">' +
    '<div class="chat-empty-state">基于当前知识图谱提问，系统将检索相关三元组并生成回答。</div>' +
    '</div>' +
    '<div class="chat-popup-input-row">' +
    '<input id="chatPopupInput" class="ctrl-input" placeholder="输入问题..." />' +
    '<button id="chatPopupSendBtn" class="btn">发送</button>' +
    '</div>';

  document.body.appendChild(popup);

  document.getElementById("chatPopupClose").onclick = function () {
    toggleChatPopup(false);
  };
  document.getElementById("chatPopupSendBtn").onclick = function () {
    sendPopupMessage();
  };
  document.getElementById("chatPopupInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPopupMessage();
    }
  });
}

function toggleChatPopup(show) {
  var popup = document.getElementById("chatPopup");
  var btn = document.getElementById("floatChatBtn");
  if (!popup || !btn) return;

  if (typeof show === "boolean") {
    chatPopupVisible = show;
  } else {
    chatPopupVisible = !chatPopupVisible;
  }

  popup.classList.toggle("visible", chatPopupVisible);
  btn.classList.toggle("chat-open", chatPopupVisible);
  if (chatPopupVisible) {
    setTimeout(function () {
      var input = document.getElementById("chatPopupInput");
      if (input) input.focus();
    }, 200);
  }
}

function addPopupMessage(role, content, sources) {
  var body = document.getElementById("chatPopupBody");
  var emptyEl = body.querySelector(".chat-empty-state");
  if (emptyEl) emptyEl.remove();

  var msg = document.createElement("div");
  msg.className = "chat-message chat-message--" + role;

  var avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.textContent = role === "user" ? "U" : "AI";

  var wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "4px";

  var text = document.createElement("div");
  text.className = "chat-text";
  text.innerHTML = escapeHtml(content).replace(/\n/g, "<br>");
  wrap.appendChild(text);

  if (sources && sources.length > 0) {
    var srcWrap = document.createElement("div");
    srcWrap.className = "popup-sources";

    var toggle = document.createElement("button");
    toggle.className = "popup-sources-toggle";
    toggle.textContent = "来源 (" + sources.length + ")";
    toggle.onclick = function () {
      var list = srcWrap.querySelector(".popup-sources-list");
      var vis = list.style.display !== "none";
      list.style.display = vis ? "none" : "";
      toggle.textContent = (vis ? "来源" : "收起") + " (" + sources.length + ")";
    };

    var list = document.createElement("div");
    list.className = "popup-sources-list";
    list.style.display = "none";
    sources.forEach(function (s) {
      var item = document.createElement("div");
      item.className = "popup-source-item";
      item.innerHTML =
        '<strong>' + escapeHtml(s.head) + '</strong>' +
        ' <span class="popup-source-rel">' + escapeHtml(s.relation) + '</span> ' +
        '<strong>' + escapeHtml(s.tail) + '</strong>' +
        (s.evidence ? ' <span style="color:#777;font-size:0.7rem;">(' + escapeHtml(s.evidence) + ')</span>' : '');
      item.onclick = function () {
        window.dispatchEvent(new CustomEvent("focus-graph-entity", {
          detail: { head: s.head, tail: s.tail, relation: s.relation }
        }));
      };
      list.appendChild(item);
    });
    srcWrap.appendChild(toggle);
    srcWrap.appendChild(list);
    wrap.appendChild(srcWrap);
  }

  msg.appendChild(avatar);
  msg.appendChild(wrap);
  body.appendChild(msg);
  body.scrollTop = body.scrollHeight;
}

function setPopupThinking(show) {
  var body = document.getElementById("chatPopupBody");
  var existing = document.getElementById("popupThinking");
  if (show) {
    if (existing) return;
    var el = document.createElement("div");
    el.id = "popupThinking";
    el.className = "chat-message chat-message--assistant";
    el.innerHTML = '<div class="chat-avatar">AI</div><div class="chat-thinking-msg">思考中...</div>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  } else {
    if (existing) existing.remove();
  }
}

async function sendPopupMessage() {
  var input = document.getElementById("chatPopupInput");
  var question = input.value.trim();
  if (!question || chatPopupThinking) return;

  addPopupMessage("user", question);
  input.value = "";
  setPopupThinking(true);
  chatPopupThinking = true;

  try {
    var data = await apiPost("/api/kbs/" + encodeURIComponent(getCurrentKb()) + "/chat", { question: question });
    setPopupThinking(false);
    chatPopupThinking = false;
    addPopupMessage("assistant", data.answer, data.sources || []);
  } catch (err) {
    setPopupThinking(false);
    chatPopupThinking = false;
    addPopupMessage("assistant", "请求失败：" + parseError(err));
  }
}

async function initTopBar(pageId) {
  setTheme(getTheme());
  setSidebarCollapsed(isSidebarCollapsed());

  initPageTransitions();
  initSidebarControl();
  initSettingsPanel();

  if (pageId !== "chat") {
    createFloatingChatButton();
  }

  const navMap = {
    kb: "nav-kb",
    kg: "nav-kg",
  };
  const activeId = navMap[pageId];
  if (activeId) {
    const active = document.getElementById(activeId);
    if (active) {
      active.classList.add("active");
    }
  }

  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener("change", () => {
      setLanguage(langSelect.value);
      window.dispatchEvent(new CustomEvent("lang-changed", { detail: { lang: getLanguage() } }));
    });
  }
  setLanguage(getLanguage());

  const themeSelect = document.getElementById("themeSelect");
  if (themeSelect) {
    themeSelect.value = getTheme();
    themeSelect.addEventListener("change", () => {
      setTheme(themeSelect.value);
      window.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme: getTheme() } }));
    });
  }

  await refreshKbSelects();
  const kbSelects = Array.from(document.querySelectorAll("[data-kb-select]"));
  kbSelects.forEach((select) => {
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    if (select.dataset.bound === "1") {
      return;
    }
    select.dataset.bound = "1";
    select.addEventListener("change", () => {
      setCurrentKb(select.value);
      syncKbSelectValues(select.value);
      window.dispatchEvent(new CustomEvent("kb-changed", { detail: { kbId: select.value } }));
    });
  });

  const healthPill = document.getElementById("healthPill");
  const modelPill = document.getElementById("modelPill");
  if (healthPill) {
    healthPill.textContent = t("pill.checking");
  }
  if (modelPill) {
    modelPill.textContent = t("pill.checking");
  }

  try {
    const health = await apiGet("/api/health");
    if (healthPill) {
      setHealthPill(healthPill, health);
    }
    if (modelPill) {
      setModelPill(modelPill, health);
    }
  } catch (_err) {
    if (healthPill) {
      setHealthPill(healthPill, null);
    }
    if (modelPill) {
      setModelPill(modelPill, null);
    }
  } finally {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("preload-ui");
    });
  }
}
