window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const message = event.data;
  if (message?.type !== "AI_TAB_GROUP") return;
  if (typeof message.requestId !== "string" || !message.requestId.startsWith("mcp-")) return;
  if (message.action !== "add" && message.action !== "remove") return;

  const targetOrigin = window.location.protocol === "file:" || !event.origin || event.origin === "null" ? "*" : event.origin;
  chrome.runtime.sendMessage({
    type: "AI_TAB_GROUP",
    action: message.action,
  }, (response) => {
    window.postMessage({
      type: "AI_TAB_GROUP_RESPONSE",
      requestId: message.requestId,
      response,
      error: chrome.runtime.lastError?.message,
    }, targetOrigin);
  });
});
