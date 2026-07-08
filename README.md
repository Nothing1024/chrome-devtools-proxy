# Chrome DevTools Proxy MCP

This repository contains two separate components:

- `chrome-devtools-proxy/`: an npm package that runs an MCP proxy for Chrome DevTools targets.
- `chrome-ai-tab-group/`: a Chrome extension that users load manually from this checkout.

The npm package does not bundle, download, or load the Chrome extension. The extension remains a separate manual install.

## Install the Chrome extension

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository's `chrome-ai-tab-group/` directory.

The extension groups tabs marked by the MCP proxy into an `AI Processing` Chrome tab group.

## Run the MCP proxy

After the package is published to npm, use a pinned version in your MCP client configuration:

```json
{
  "mcpServers": {
    "chrome-devtools-proxy": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-proxy@1.0.0"
      ]
    }
  }
}
```

For a custom target config, pass `--config`:

```json
{
  "mcpServers": {
    "chrome-devtools-proxy": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-proxy@1.0.0",
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

Before publishing the npm package, validate its contents from `chrome-devtools-proxy/`:

```sh
npm run check
npm pack --dry-run --json
```

The tarball should contain only:

- `index.js`
- `package.json`
- `targets.json`

It must not contain `chrome-ai-tab-group/` or any other extension files.

## Browser operation protocol

See `browser-ops/SKILL.md` for the MCP browser-operation protocol used with this proxy.

## Known limitations

- The tab-group bridge uses page `window.postMessage`; a page can request grouping or ungrouping for its own tab. The impact is limited to the `AI Processing` tab group.
- Removing a tab only ungroups it when its current group is `AI Processing`; it does not restore a previous user-created tab group.
