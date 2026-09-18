import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("chrome-devtools-mcp/package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
const bin = resolve(dirname(packagePath), packageJson.bin["chrome-devtools-mcp"]);
test("chrome-devtools-mcp 1.9.0 is installed", () => {
  assert.equal(packageJson.version, "1.9.0");
});

test("chrome-devtools-mcp help exposes pageIdRouting", async () => {
  const child = spawn(process.execPath, [bin, "--help"], {
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolveExit) => {
    child.on("close", resolveExit);
  });
  const output = `${stdout}\n${stderr}`;
  assert.equal(code, 0, output);
  assert.match(output, /--pageIdRouting/);
  assert.match(output, /--autoConnect/);
});

test("evaluate_script requires pageId by default", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "--no-usage-statistics"],
    env: {
      ...getDefaultEnvironment(),
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
    },
  });
  const client = new Client({ name: "proxy-catalog-smoke", version: "1.1.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const evaluateScript = tools.find((tool) => tool.name === "evaluate_script");
    assert.ok(evaluateScript, "evaluate_script is registered");
    assert.equal(evaluateScript.inputSchema.properties.pageId.type, "number");
    assert.ok(evaluateScript.inputSchema.required.includes("pageId"));
    assert.ok(evaluateScript.inputSchema.properties.waitForStableDom);
  } finally {
    await client.close();
  }
});
