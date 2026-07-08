const GROUP_NAME = "AI Processing";
const GROUP_COLOR = "blue";

let groupOperation = Promise.resolve();

async function withGroupLock(operation) {
  const previous = groupOperation;
  const run = previous.catch(() => {}).then(operation);
  groupOperation = run.catch(() => {});
  return await run;
}

async function addTabToGroup(tabId) {
  return await withGroupLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    const groups = await chrome.tabGroups.query({ title: GROUP_NAME, windowId: tab.windowId });
    if (groups.length > 0) {
      await chrome.tabGroups.update(groups[0].id, { color: GROUP_COLOR, collapsed: false });
      await chrome.tabs.group({ tabIds: [tabId], groupId: groups[0].id });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, { title: GROUP_NAME, color: GROUP_COLOR, collapsed: false });
    }
  });
}

async function removeTabFromGroup(tabId) {
  return await withGroupLock(async () => {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId === -1) return;

    const group = await chrome.tabGroups.get(tab.groupId);
    if (group.title !== GROUP_NAME) return;

    await chrome.tabs.ungroup(tabId);
  });
}

async function handleMessage(message, tabId) {
  if (message.action === "add") {
    await addTabToGroup(tabId);
    return { ok: true, action: "add" };
  }
  if (message.action === "remove") {
    await removeTabFromGroup(tabId);
    return { ok: true, action: "remove" };
  }
  return { ok: false, error: `unknown action: ${message.action}` };
}

function handleMessageForTab(message, tabId, sendResponse) {
  handleMessage(message, tabId)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "AI_TAB_GROUP" || !sender.tab) return false;
  return handleMessageForTab(message, sender.tab.id, sendResponse);
});
