var currentKbId = "default";

function byId(id) { return document.getElementById(id); }

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function addMessage(role, content, sources) {
  var container = byId("chatMessages");
  var emptyEl = container.querySelector(".chat-empty-state");
  if (emptyEl) emptyEl.remove();

  var msg = document.createElement("div");
  msg.className = "chat-message chat-message--" + role;

  var avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.textContent = role === "user" ? "U" : "AI";

  var body = document.createElement("div");
  body.className = "chat-body";

  var text = document.createElement("div");
  text.className = "chat-text";
  text.innerHTML = escapeHtml(content).replace(/\n/g, "<br>");
  body.appendChild(text);

  if (sources && sources.length > 0) {
    var srcWrap = document.createElement("div");
    srcWrap.className = "chat-sources";

    var srcToggle = document.createElement("button");
    srcToggle.className = "chat-sources-toggle";
    srcToggle.textContent = t("chat.sources.show") + " (" + sources.length + ")";
    srcToggle.onclick = function () {
      var list = srcWrap.querySelector(".chat-sources-list");
      var vis = list.style.display !== "none";
      list.style.display = vis ? "none" : "";
      srcToggle.textContent = (vis ? t("chat.sources.show") : t("chat.sources.hide")) + " (" + sources.length + ")";
    };

    var srcList = document.createElement("div");
    srcList.className = "chat-sources-list";
    srcList.style.display = "none";

    sources.forEach(function (s) {
      var item = document.createElement("div");
      item.className = "chat-source-item";
      item.innerHTML =
        '<span class="chat-source-triple">' +
        '<strong>' + escapeHtml(s.head) + '</strong>' +
        ' <span class="chat-source-rel">' + escapeHtml(s.relation) + '</span> ' +
        '<strong>' + escapeHtml(s.tail) + '</strong>' +
        '</span>' +
        (s.evidence ? ' <span class="chat-source-evidence">(' + escapeHtml(s.evidence) + ')</span>' : '');
      item.onclick = function () {
        window.open("./kg.html?kb=" + encodeURIComponent(currentKbId) + "&entity=" + encodeURIComponent(s.head), "_blank");
      };
      srcList.appendChild(item);
    });

    srcWrap.appendChild(srcToggle);
    srcWrap.appendChild(srcList);
    body.appendChild(srcWrap);
  }

  msg.appendChild(avatar);
  msg.appendChild(body);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function addThinking() {
  var container = byId("chatMessages");
  var emptyEl = container.querySelector(".chat-empty-state");
  if (emptyEl) emptyEl.remove();

  var msg = document.createElement("div");
  msg.className = "chat-message chat-message--assistant chat-thinking";
  msg.id = "thinkingMsg";

  var avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.textContent = "AI";

  var body = document.createElement("div");
  body.className = "chat-body";
  body.textContent = t("chat.thinking");

  msg.appendChild(avatar);
  msg.appendChild(body);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function removeThinking() {
  var el = byId("thinkingMsg");
  if (el) el.remove();
}

function updateKbBadge() {
  var badge = byId("chatKbBadge");
  if (badge) badge.textContent = currentKbId;
}

function clearChat() {
  var container = byId("chatMessages");
  container.innerHTML = '<div class="chat-empty-state" data-i18n="chat.empty">' + t("chat.empty") + '</div>';
}

async function sendMessage() {
  var input = byId("chatInput");
  var question = input.value.trim();
  if (!question) return;

  addMessage("user", question);
  input.value = "";
  addThinking();

  try {
    var data = await apiPost("/api/kbs/" + encodeURIComponent(currentKbId) + "/chat", { question: question });
    removeThinking();
    addMessage("assistant", data.answer, data.sources || []);
  } catch (err) {
    removeThinking();
    addMessage("assistant", t("chat.error") + "\n" + parseError(err));
  }
}

function refreshAfterLanguageChange() {
  applyI18n();
  updateChatUI();
}

function updateChatUI() {
  updateKbBadge();
}

async function bootstrap() {
  await initTopBar("chat");
  currentKbId = getCurrentKb();

  byId("sendBtn").onclick = sendMessage;
  byId("chatInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  byId("clearChatBtn").onclick = clearChat;

  window.addEventListener("kb-changed", function (e) {
    currentKbId = e.detail.kbId;
    clearChat();
    updateKbBadge();
  });
  window.addEventListener("lang-changed", refreshAfterLanguageChange);

  updateKbBadge();
}

bootstrap().catch(function (e) { console.error(parseError(e)); });
