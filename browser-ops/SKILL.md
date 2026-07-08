---
name: browser-ops
description: Use when operating browser pages via chrome-devtools-proxy MCP. Routes to the right target, marks AI-operated tabs by calling the proxy's local MCP tool, and releases the tab after work.
---

# browser-ops

Browser operation protocol for `chrome-devtools-proxy`.

## Config

- MCP server: `chrome-devtools-proxy`
- Proxy package: `chrome-devtools-proxy/`
- Targets config: bundled `chrome-devtools-proxy/targets.json` or the user-provided `--config` path
- Tab group extension: `chrome-ai-tab-group/`, loaded manually with Chrome **Load unpacked**
- Marking entry point: local MCP tool `mark_ai_tab_group`

Do not call the Chrome extension directly and do not depend on a hard-coded extension ID. The agent calls MCP; the proxy calls upstream `evaluate_script`; the page bridge wakes the content script; the content script asks the extension background worker to add or remove the current tab from `AI Processing`.

## Operation protocol

Every browser operation MUST follow this sequence when it is multi-step, long-running, or changes page state.

### 1. Confirm page state

Call the MCP page-listing tool first and confirm which page is selected. Never assume the previously selected page is still active.

### 2. Route to the correct target

Read the configured targets before routing calls.

Decision rules:

- If only one target is configured, omit `target` and use `defaultTarget`.
- If the user explicitly names a target, use that target.
- For `localhost` / `127.0.0.1`, match the configured `browserUrl`, WebSocket endpoint, or port.
- For remote browser instances, use the matching configured target if present.

This is the proxy's main enhancement over upstream `chrome-devtools-mcp`: one MCP server can quickly jump between multiple Chrome ports or profiles by changing the `target` argument.

### 3. Check conflict risk

If the page is visibly already in an `AI Processing` tab group, warn: `该页面可能正在被其他会话操作`.

If tab-group state is not available through the current MCP view, proceed to the mark step. `add` is idempotent for the current AI group.

### 4. Mark page through MCP

Call the proxy's local MCP tool:

```json
{
  "name": "mark_ai_tab_group",
  "arguments": {
    "action": "add"
  }
}
```

When multiple targets are configured, include the target:

```json
{
  "name": "mark_ai_tab_group",
  "arguments": {
    "action": "add",
    "target": "host"
  }
}
```

Expected internal flow:

```text
agent -> chrome-devtools-proxy MCP -> upstream evaluate_script -> window.postMessage -> content.js -> background.js -> chrome.tabs/chrome.tabGroups
```

### 5. Operate

Perform the requested Chrome DevTools MCP operations against the selected page and target.

### 6. Release page through MCP

When done, call:

```json
{
  "name": "mark_ai_tab_group",
  "arguments": {
    "action": "remove"
  }
}
```

Include `target` when the operation used a non-default target.

## When to skip marking

Skip tab grouping for read-only, one-shot inspections:

- listing pages,
- taking a quick snapshot,
- checking a title or URL,
- reading a single value.

## When to mark

Mark the tab for:

- multi-step page interactions,
- form fills,
- navigation flows,
- performance traces,
- operations that modify page state,
- long-running browser tasks.

## MCP lifecycle decisions

Suggest closing the MCP server when browser work is complete or the user switches back to pure code work:

```text
浏览器操作已完成，如需释放资源可以关闭 chrome-devtools-proxy MCP
```

## Error recovery

- `Target not connected`: the configured Chrome instance is not running or the target config is wrong. Tell the user which target failed.
- `AI Tab Group extension did not respond`: load `chrome-ai-tab-group/` into the controlled Chrome profile and retry. The tool is unavailable on Chrome internal pages that cannot run content scripts.
- `Page closed`: call the MCP page-listing tool again and choose a live page.
