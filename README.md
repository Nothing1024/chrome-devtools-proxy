# Chrome DevTools Proxy

This repository contains two separate components:

- `chrome-devtools-proxy/`: an npm package that runs an MCP proxy for Chrome DevTools targets.
- `chrome-ai-tab-group/`: a Chrome extension that users load manually from this checkout.

The npm package does not bundle, download, or load the Chrome extension. The extension remains a separate manual install.

## Advantages

- Enhances upstream `chrome-devtools-mcp` instead of replacing it: existing Chrome DevTools MCP tools are forwarded, with target routing added by the proxy.
- Supports multiple Chrome targets in one MCP server, so agents can quickly switch between browser ports or profiles with a `target` argument instead of restarting MCP.
- Keeps runtime behavior stable by using pinned package dependencies and the locally installed upstream binary, avoiding nested `npx` or `latest` drift.
- Adds `mark_ai_tab_group` so long-running browser work can mark the active tab as `AI Processing` when the separately loaded extension is installed.
- Keeps the install package clean: GitHub `npx` and npm package installs run only the proxy; the Chrome extension is loaded manually from the GitHub checkout.

## Install the Chrome extension

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository's `chrome-ai-tab-group/` directory.

The extension groups tabs marked by the MCP proxy into an `AI Processing` Chrome tab group.

## Run the MCP proxy from GitHub

Use the GitHub repository directly with `npx`. A pinned tag is recommended for stable MCP behavior:

```json
{
  "mcpServers": {
    "chrome-devtools-proxy": {
      "command": "npx",
      "args": [
        "-y",
        "github:Nothing1024/chrome-devtools-proxy#v1.0.0"
      ]
    }
  }
}
```

For testing the current default branch instead of a pinned tag:

```sh
npx -y github:Nothing1024/chrome-devtools-proxy
```

For a custom target config, pass `--config`:

```json
{
  "mcpServers": {
    "chrome-devtools-proxy": {
      "command": "npx",
      "args": [
        "-y",
        "github:Nothing1024/chrome-devtools-proxy#v1.0.0",
        "--config",
        "/path/to/targets.json"
      ]
    }
  }
}
```

Use your own absolute config path; do not rely on paths from this repository checkout.

## Target configuration

Default `chrome-devtools-proxy/targets.json`:

```json
{
  "targets": {
    "host": {
      "label": "Local Chrome",
      "args": ["--auto-connect"]
    }
  },
  "defaultTarget": "host"
}
```

A fixed local debugging port can be configured like this:

```json
{
  "targets": {
    "host": {
      "label": "Local Chrome 9222",
      "args": ["--browserUrl=http://127.0.0.1:9222"]
    }
  },
  "defaultTarget": "host"
}
```

Multiple ports can be configured as separate targets for fast switching:

```json
{
  "targets": {
    "app": {
      "label": "App Chrome 9222",
      "args": ["--browserUrl=http://127.0.0.1:9222"]
    },
    "admin": {
      "label": "Admin Chrome 9223",
      "args": ["--browserUrl=http://127.0.0.1:9223"]
    }
  },
  "defaultTarget": "app"
}
```

Tool calls can then pass `"target": "admin"` to route one request to port `9223` without changing the MCP server process.

Start Chrome with a dedicated profile before using that config:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-ai-mcp"
```

## Local tab-group tool

The proxy exposes `mark_ai_tab_group` in addition to upstream Chrome DevTools MCP tools.

Arguments:

```json
{
  "action": "add",
  "target": "host"
}
```

`action` is either `add` or `remove`. The `target` field is optional when using `defaultTarget`.

The tool requires the separate `chrome-ai-tab-group/` extension to be loaded in the Chrome profile being controlled.

## Package boundary

The repository root has a small `package.json` only so GitHub `npx` can run this repository directly. Validate the GitHub install package from the repository root:

```sh
npm run check
npm pack --dry-run --json
```

The GitHub `npx` package must not contain `chrome-ai-tab-group/` or extension files. It should contain only:

- `README.md`
- root `package.json`
- `chrome-devtools-proxy/index.js`
- `chrome-devtools-proxy/package.json`
- `chrome-devtools-proxy/targets.json`

If publishing to the npm registry later, publish from `chrome-devtools-proxy/` and validate that subpackage separately:

```sh
cd chrome-devtools-proxy
npm run check
npm pack --dry-run --json
```

## Browser operation protocol

See `browser-ops/SKILL.md` for the MCP browser-operation protocol used with this proxy.

## Known limitations

- The tab-group bridge uses page `window.postMessage`; a page can request grouping or ungrouping for its own tab. The impact is limited to the `AI Processing` tab group.
- Removing a tab only ungroups it when its current group is `AI Processing`; it does not restore a previous user-created tab group.
