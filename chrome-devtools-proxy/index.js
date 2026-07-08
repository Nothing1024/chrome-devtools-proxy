#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PACKAGE_JSON = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const VERSION = PACKAGE_JSON.version;
const DEFAULT_CONFIG_PATH = resolve(__dirname, "targets.json");
const CHROME_DEVTOOLS_MCP_BIN = resolvePackageBin("chrome-devtools-mcp", "chrome-devtools-mcp");
const MARK_TAB_TOOL = "mark_ai_tab_group";
const TOOL_CATALOG_FLAGS = new Map([
  ["slim", { canonical: "slim", defaultValue: false }],
  ["experimentalpageidrouting", { canonical: "experimentalPageIdRouting", defaultValue: false }],
  ["experimentaldevtools", { canonical: "experimentalDevtools", defaultValue: false }],
  ["experimentalvision", { canonical: "experimentalVision", defaultValue: false }],
  ["memorydebugging", { canonical: "memoryDebugging", defaultValue: false }],
  ["experimentalmemory", { canonical: "memoryDebugging", defaultValue: false }],
  ["experimentalnavigationallowlist", { canonical: "experimentalNavigationAllowlist", defaultValue: false }],
  ["experimentalinteroptools", { canonical: "experimentalInteropTools", defaultValue: false }],
  ["experimentalscreencast", { canonical: "experimentalScreencast", defaultValue: false }],
  ["experimentalffmpegpath", { canonical: "experimentalScreencast", defaultValue: false, implies: true }],
  ["categoryexperimentalwebmcp", { canonical: "categoryExperimentalWebmcp", defaultValue: false }],
  ["categoryexperimentalthirdparty", { canonical: "categoryExperimentalThirdParty", defaultValue: false }],
  ["categoryextensions", { canonical: "categoryExtensions", defaultValue: false }],
  ["categoryemulation", { canonical: "categoryEmulation", defaultValue: true }],
  ["categoryperformance", { canonical: "categoryPerformance", defaultValue: true }],
  ["categorynetwork", { canonical: "categoryNetwork", defaultValue: true }],
  ["categoryinput", { canonical: "categoryInput", defaultValue: true }],
  ["categorynavigation", { canonical: "categoryNavigation", defaultValue: true }],
  ["categorydebugging", { canonical: "categoryDebugging", defaultValue: true }],
  ["categorymemory", { canonical: "categoryMemory", defaultValue: true }],
]);

const cli = loadCli(process.argv.slice(2));

if (cli.help) {
  process.stdout.write(`chrome-devtools-proxy ${VERSION}

Usage:
  chrome-devtools-proxy [--config <path>]

Options:
  -c, --config <path>   Targets config JSON. Defaults to bundled targets.json.
  -h, --help            Show this help.
`);
  process.exit(0);
}


const configPath = cli.configPath ?? DEFAULT_CONFIG_PATH;
const config = loadConfig(configPath);

const clients = new Map();
const transports = new Map();
const connecting = new Map();
let mergedTools = [];
let shuttingDown = false;

function failStartup(error) {
  process.stderr.write(`Fatal: ${error.message}\n`);
  process.exit(1);
}

function loadCli(argv) {
  try {
    return parseCliArgs(argv);
  } catch (e) {
    failStartup(e);
  }
}

function loadConfig(path) {
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, "utf-8")), path);
  } catch (e) {
    failStartup(e);
  }
}

function resolvePackageBin(packageName, binName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName];
  if (!bin) throw new Error(`Package "${packageName}" does not define bin "${binName}"`);
  return resolve(dirname(packagePath), bin);
}

function parseCliArgs(argv) {
  const parsed = { configPath: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
    } else if (arg === "-c" || arg === "--config") {
      parsed.configPath = argv[++i];
      if (!parsed.configPath || parsed.configPath.startsWith("-")) throw new Error(`${arg} requires a path`);
    } else if (arg.startsWith("--config=")) {
      parsed.configPath = arg.slice("--config=".length);
    } else if (!parsed.configPath && !arg.startsWith("-")) {
      parsed.configPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.configPath !== null && parsed.configPath.trim().length === 0) {
    throw new Error("Config path must not be empty");
  }

  return parsed;
}

function isValidPort(port) {
  if (typeof port === "number") {
    return Number.isInteger(port) && port > 0 && port <= 65535;
  }
  if (typeof port !== "string" || !/^[1-9]\d{0,4}$/.test(port)) {
    return false;
  }
  const value = Number(port);
  return value <= 65535;
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function normalizeFlagKey(name) {
  return name.replace(/^-+/, "").replace(/^no-/, "").replace(/[-_]/g, "").toLowerCase();
}

function parseFlagValue(value) {
  if (value === undefined) return true;
  const normalized = value.toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  return value;
}

function isBooleanLiteral(value) {
  const normalized = value.toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "no" ||
    normalized === "true" || normalized === "1" || normalized === "yes";
}

function getToolCatalogSignature(args) {
  const signature = new Map();
  for (const definition of TOOL_CATALOG_FLAGS.values()) {
    if (!signature.has(definition.canonical)) {
      signature.set(definition.canonical, definition.defaultValue);
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const equalsIndex = arg.indexOf("=");
    const rawName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    let rawValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    if (rawValue === undefined && args[i + 1] && !args[i + 1].startsWith("-") && isBooleanLiteral(args[i + 1])) {
      rawValue = args[i + 1];
    }
    const negated = rawName.startsWith("--no-");
    const key = normalizeFlagKey(negated ? `--${rawName.slice("--no-".length)}` : rawName);
    const definition = TOOL_CATALOG_FLAGS.get(key);
    if (!definition) continue;

    signature.set(definition.canonical, negated ? false : definition.implies ? true : parseFlagValue(rawValue));
  }

  return JSON.stringify([...signature.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function validateToolCatalogArgs(targets, targetNames, defaultTarget, sourcePath) {
  const defaultSignature = getToolCatalogSignature(targets[defaultTarget].args || []);
  for (const name of targetNames) {
    const signature = getToolCatalogSignature(targets[name].args || []);
    if (signature !== defaultSignature) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}" changes chrome-devtools-mcp tool catalog flags; all targets must use the same tool-shaping flags as defaultTarget "${defaultTarget}"`);
    }
  }
}

function normalizeConfig(rawConfig, sourcePath) {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error(`Invalid config in ${sourcePath}: expected an object`);
  }

  const targets = rawConfig.targets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new Error(`Invalid config in ${sourcePath}: "targets" must be an object`);
  }

  const targetNames = Object.keys(targets);
  if (targetNames.length === 0) {
    throw new Error(`Invalid config in ${sourcePath}: at least one target is required`);
  }
  if (targetNames.some((name) => name.length === 0)) {
    throw new Error(`Invalid config in ${sourcePath}: target names must not be empty`);
  }

  if (rawConfig.defaultTarget !== undefined && typeof rawConfig.defaultTarget !== "string") {
    throw new Error(`Invalid config in ${sourcePath}: "defaultTarget" must be a string`);
  }

  const defaultTarget = rawConfig.defaultTarget ?? targetNames[0];
  if (!hasOwn(targets, defaultTarget)) {
    throw new Error(`Invalid config in ${sourcePath}: defaultTarget "${defaultTarget}" is not defined`);
  }

  for (const name of targetNames) {
    const target = targets[name];
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}" must be an object`);
    }
    if (target.args !== undefined && !Array.isArray(target.args)) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}".args must be an array`);
    }
    if (target.args?.some((arg) => typeof arg !== "string" || arg.trim().length === 0)) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}".args entries must be non-empty strings`);
    }
    if (target.label !== undefined && typeof target.label !== "string") {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}".label must be a string`);
    }
    if (target.port !== undefined && !isValidPort(target.port)) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}".port must be an integer from 1 to 65535`);
    }
  }

  validateToolCatalogArgs(targets, targetNames, defaultTarget, sourcePath);

  return { ...rawConfig, defaultTarget };
}

function hasOptionValue(arg, ...names) {
  return names.some((name) => arg === name || arg.startsWith(`${name}=`));
}

function isEnabledAutoConnectArg(args, index) {
  const arg = args[index];
  const equalsIndex = arg.indexOf("=");
  const rawName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
  let rawValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
  const negated = rawName.startsWith("--no-");
  const key = normalizeFlagKey(negated ? `--${rawName.slice("--no-".length)}` : rawName);
  if (key !== "autoconnect") return false;
  if (negated) return false;
  if (rawValue === undefined && args[index + 1] && !args[index + 1].startsWith("-") && isBooleanLiteral(args[index + 1])) {
    rawValue = args[index + 1];
  }
  return parseFlagValue(rawValue) !== false;
}

function hasConnectionArg(args) {
  return args.some((arg, index) => (
    isEnabledAutoConnectArg(args, index) ||
    hasOptionValue(arg, "--browserUrl", "--browser-url", "-u") ||
    hasOptionValue(arg, "--wsEndpoint", "--ws-endpoint", "-w")
  ));
}


function createTargetProperty() {
  const targetNames = Object.keys(config.targets);
  return {
    type: "string",
    description: `Browser target: ${targetNames.map((name) => `"${name}" (${config.targets[name].label || name})`).join(", ")}. Default: "${config.defaultTarget}"`,
    enum: targetNames,
  };
}

function createLocalTools() {
  return [
    {
      name: MARK_TAB_TOOL,
      description: "Add or remove the currently selected Chrome page from the AI Processing tab group. Requires the separate chrome-ai-tab-group extension to be loaded in Chrome.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "remove"],
            description: "Whether to add the current tab to the AI Processing group or remove it.",
          },
          target: createTargetProperty(),
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  ];
}

function buildChromeDevToolsArgs(target) {
  const targetArgs = target.args || [];
  const args = [CHROME_DEVTOOLS_MCP_BIN, "--no-usage-statistics", ...targetArgs];

  if (target.port && !hasConnectionArg(targetArgs)) {
    args.push("--browserUrl=http://127.0.0.1:" + Number(target.port));
  }

  return args;
}

function unregisterTarget(name) {
  clients.delete(name);
  transports.delete(name);
}

async function connectTarget(name) {
  if (clients.has(name)) return clients.get(name);
  if (connecting.has(name)) return connecting.get(name);

  const target = hasOwn(config.targets, name) ? config.targets[name] : null;
  if (!target) return null;

  const promise = (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: buildChromeDevToolsArgs(target),
      env: {
        ...getDefaultEnvironment(),
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
      },
    });
    transports.set(name, transport);
    try {
      const client = new Client({ name: `proxy-to-${name}`, version: VERSION });
      client.onclose = () => unregisterTarget(name);
      await client.connect(transport);
      clients.set(name, client);
      process.stderr.write(`[proxy] Connected to target "${name}"\n`);
      return client;
    } catch (e) {
      unregisterTarget(name);
      await closeTransport(transport);
      throw e;
    } finally {
      connecting.delete(name);
    }
  })();

  connecting.set(name, promise);
  return promise;
}

async function closeTransport(transport) {
  try { await transport.close(); } catch {}
}

async function closeTransports() {
  await Promise.allSettled([...transports.values()].map(closeTransport));
  transports.clear();
  clients.clear();
}

function cleanup() {
  for (const [, transport] of transports) {
    void closeTransport(transport);
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeTransports();
  process.exit(0);
}

process.on("exit", cleanup);
process.stdin.on("end", () => { void shutdown(); });
process.stdin.on("close", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });

async function discoverTools(client) {
  const { tools } = await client.listTools();
  const targetProperty = createTargetProperty();

  mergedTools = [
    ...tools.map((tool) => ({
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
        properties: {
          ...(tool.inputSchema.properties || {}),
          target: targetProperty,
        },
      },
    })),
    ...createLocalTools(),
  ];
}

function createTabGroupScript(action) {
  return `async () => {
    const requestId = "mcp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const action = ${JSON.stringify(action)};
    const targetOrigin = window.location.protocol === "file:" || window.location.origin === "null" ? "*" : window.location.origin;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("AI Tab Group extension did not respond. Install and load the chrome-ai-tab-group extension from the GitHub repository, then retry. This tool is unavailable on Chrome pages that do not run content scripts."));
      }, 5000);

      function onMessage(event) {
        if (event.source !== window) return;
        if (event.data?.type !== "AI_TAB_GROUP_RESPONSE") return;
        if (event.data.requestId !== requestId) return;

        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else if (event.data.response?.ok === false) {
          reject(new Error(event.data.response.error || "AI Tab Group extension returned an error."));
        } else {
          resolve(event.data.response || { ok: true });
        }
      }

      window.addEventListener("message", onMessage);
      window.postMessage({ type: "AI_TAB_GROUP", action, requestId }, targetOrigin);
    });
  }`;
}

function normalizeToolArguments(args) {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  return args;
}

function getTargetName(args) {
  const targetName = args.target ?? config.defaultTarget;
  if (typeof targetName !== "string" || targetName.length === 0) {
    throw new Error('Tool argument "target" must be a non-empty string');
  }
  return targetName;
}

async function callLocalTool(name, args) {
  if (name !== MARK_TAB_TOOL) return null;

  if (args?.action !== "add" && args?.action !== "remove") {
    return {
      content: [{ type: "text", text: 'Invalid action. Expected "add" or "remove".' }],
      isError: true,
    };
  }

  const targetName = getTargetName(args);
  const client = await connectTarget(targetName);
  if (!client) {
    return {
      content: [{ type: "text", text: `Unknown target "${targetName}". Available: ${Object.keys(config.targets).join(", ")}` }],
      isError: true,
    };
  }

  return await client.callTool({
    name: "evaluate_script",
    arguments: { function: createTabGroupScript(args.action) },
  });
}

async function init() {
  const defaultClient = await connectTarget(config.defaultTarget);
  if (!defaultClient) {
    throw new Error(`Failed to connect to default target "${config.defaultTarget}"`);
  }
  await discoverTools(defaultClient);

  const server = new Server(
    { name: "chrome-devtools-proxy", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mergedTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    let args;
    try {
      args = normalizeToolArguments(rawArgs);
    } catch (e) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }

    try {
      const localResult = await callLocalTool(name, args);
      if (localResult) return localResult;
    } catch (e) {
      return { content: [{ type: "text", text: `Error calling local tool "${name}": ${e.message}` }], isError: true };
    }

    let targetName;
    try {
      targetName = getTargetName(args);
    } catch (e) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }

    let client;
    try {
      client = await connectTarget(targetName);
    } catch (e) {
      return { content: [{ type: "text", text: `Failed to connect to target "${targetName}": ${e.message}` }], isError: true };
    }

    if (!client) {
      return { content: [{ type: "text", text: `Unknown target "${targetName}". Available: ${Object.keys(config.targets).join(", ")}` }], isError: true };
    }

    const forwardArgs = { ...args };
    delete forwardArgs.target;

    try {
      return await client.callTool({ name, arguments: forwardArgs });
    } catch (e) {
      return { content: [{ type: "text", text: `Error calling ${name} on target "${targetName}": ${e.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

init().catch(async (e) => {
  process.stderr.write(`Fatal: ${e.message}\n`);
  await closeTransports();
  process.exit(1);
});
