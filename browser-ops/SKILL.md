---
name: browser-ops
description: Use when operating browser pages through chrome-devtools-proxy MCP. Provides target-routing, tab-group marking, conflict-awareness, and lifecycle guidance.
---

# browser-ops

Browser operation protocol for `chrome-devtools-proxy`.

## Components

- Proxy package: `chrome-devtools-proxy/`
- Targets config: `chrome-devtools-proxy/targets.json` or a user-provided `--config` path
- Tab group extension: `chrome-ai-tab-group/`, loaded manually with Chrome **Load unpacked**
- Local MCP tool: `mark_ai_tab_group`

Do not depend on a hard-coded Chrome extension ID. Use the proxy's `mark_ai_tab_group` tool so the installed extension is reached through the page bridge.

## Operation protocol

### 1. Confirm page state

Before acting, list available pages and confirm which page is selected. Do not assume the previously selected page is still active.

### 2. Check for conflict risk

If the page is already in an `AI Processing` tab group, warn that another session may be operating it. Otherwise proceed.

### 3. Mark the page

For multi-step or state-changing browser operations, call:

```json
{
  "name": "mark_ai_tab_group",
  "arguments": {
    "action": "add"
  }
}
```

When multiple browser targets are configured, add the target name:

```json
{
  "name": "mark_ai_tab_group",
  "arguments": {
    "action": "add",
    "target": "host"
  }
}
```

### 4. Operate

Run the requested Chrome DevTools MCP operation against the selected target.

### 5. Release the page

After the operation completes, call:

```json
{
  "name": "mark_ai_tab_group",
  "arguments": {
    "action": "remove"
  }
}
```

## Target routing

Read the configured targets before routing calls.

Decision rules:

- If only one target is configured, omit `target` and use `defaultTarget`.
- If the user explicitly names a target, use that target.
- For local URLs, use the target whose `browserUrl`, WebSocket endpoint, or configured port matches the browser instance.
- For remote browser instances, use the matching configured target if present.

## When to skip marking

Skip tab grouping for read-only, one-shot inspections such as listing pages, checking a title, or taking a quick snapshot.

## When to mark

Mark the tab for:

- multi-step page interactions,
- form fills,
- navigation flows,
- performance traces,
- operations that modify page state,
- long-running browser tasks.

## Error recovery

- `Target not connected`: start the configured Chrome instance or correct the target config.
- `AI Tab Group extension did not respond`: load `chrome-ai-tab-group/` into the controlled Chrome profile and retry.
- `Page closed`: list pages again and choose a live page.
