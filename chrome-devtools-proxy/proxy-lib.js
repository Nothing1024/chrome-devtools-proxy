import { readFileSync } from "fs";
import os from "os";
import path from "path";

export const TOOL_CATALOG_FLAGS = new Map([
  ["slim", { canonical: "slim", defaultValue: false }],
  ["pageidrouting", { canonical: "pageIdRouting", defaultValue: true }],
  ["experimentalpageidrouting", { canonical: "pageIdRouting", defaultValue: true }],
  ["experimentaldevtools", { canonical: "experimentalDevtools", defaultValue: false }],
  ["experimentalvision", { canonical: "experimentalVision", defaultValue: false }],
  ["memorydebugging", { canonical: "memoryDebugging", defaultValue: false }],
  ["experimentalmemory", { canonical: "memoryDebugging", defaultValue: false }],
  ["experimentalinteroptools", { canonical: "experimentalInteropTools", defaultValue: false }],
  ["experimentalscreencast", { canonical: "experimentalScreencast", defaultValue: false }],
  ["experimentalffmpegpath", { canonical: "experimentalScreencast", defaultValue: false, implies: true }],
  ["experimentalscreencastfps", { canonical: "experimentalScreencast", defaultValue: false, implies: true }],
  ["categoryexperimentalwebmcp", { canonical: "categoryExperimentalWebmcp", defaultValue: false }],
  ["categoryexperimentalthirdparty", { canonical: "categoryExperimentalThirdParty", defaultValue: false }],
  ["categoryextensions", { canonical: "categoryExtensions", defaultValue: false }],
  ["categorypwa", { canonical: "categoryPwa", defaultValue: false }],
  ["categoryemulation", { canonical: "categoryEmulation", defaultValue: true }],
  ["categoryperformance", { canonical: "categoryPerformance", defaultValue: true }],
  ["categorynetwork", { canonical: "categoryNetwork", defaultValue: true }],
  ["categoryinput", { canonical: "categoryInput", defaultValue: true }],
  ["categorynavigation", { canonical: "categoryNavigation", defaultValue: true }],
  ["categorydebugging", { canonical: "categoryDebugging", defaultValue: true }],
  ["categorymemory", { canonical: "categoryMemory", defaultValue: true }],
  ["javascriptevaluation", { canonical: "javascriptEvaluation", defaultValue: true }],
  ["experimentalincludeallpages", { canonical: "experimentalIncludeAllPages", defaultValue: false }],
]);

const DEPRECATED_FLAG_REWRITES = new Map([
  ["experimentalpageidrouting", "pageIdRouting"],
  ["experimental-page-id-routing", "pageIdRouting"],
]);

export function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

export function isValidPort(port) {
  if (typeof port === "number") {
    return Number.isInteger(port) && port > 0 && port <= 65535;
  }
  if (typeof port !== "string" || !/^[1-9]\d{0,4}$/.test(port)) {
    return false;
  }
  const value = Number(port);
  return value <= 65535;
}

export function normalizeFlagKey(name) {
  return name.replace(/^-+/, "").replace(/^no-/, "").replace(/[-_]/g, "").toLowerCase();
}

export function parseFlagValue(value) {
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

function splitArg(arg) {
  const equalsIndex = arg.indexOf("=");
  const rawName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
  const rawValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
  return { rawName, rawValue };
}

function takeMaybeBooleanValue(args, index, rawValue) {
  if (rawValue !== undefined) return { value: rawValue, consumedNext: false };
  if (args[index + 1] && !args[index + 1].startsWith("-") && isBooleanLiteral(args[index + 1])) {
    return { value: args[index + 1], consumedNext: true };
  }
  return { value: undefined, consumedNext: false };
}

function takeMaybeStringValue(args, index, rawValue) {
  if (rawValue !== undefined) return { value: rawValue, consumedNext: false };
  if (args[index + 1] && !args[index + 1].startsWith("-")) {
    return { value: args[index + 1], consumedNext: true };
  }
  return { value: undefined, consumedNext: false };
}

export function getToolCatalogSignature(args) {
  const signature = new Map();
  for (const definition of TOOL_CATALOG_FLAGS.values()) {
    if (!signature.has(definition.canonical)) {
      signature.set(definition.canonical, definition.defaultValue);
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const { rawName, rawValue } = splitArg(arg);
    const taken = takeMaybeBooleanValue(args, i, rawValue);
    const negated = rawName.startsWith("--no-");
    const key = normalizeFlagKey(negated ? `--${rawName.slice("--no-".length)}` : rawName);
    const definition = TOOL_CATALOG_FLAGS.get(key);
    if (!definition) continue;

    signature.set(definition.canonical, negated ? false : definition.implies ? true : parseFlagValue(taken.value));
  }

  return JSON.stringify([...signature.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function validateToolCatalogArgs(targets, targetNames, defaultTarget, sourcePath) {
  const defaultSignature = getToolCatalogSignature(targets[defaultTarget].args || []);
  for (const name of targetNames) {
    const signature = getToolCatalogSignature(targets[name].args || []);
    if (signature !== defaultSignature) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}" changes chrome-devtools-mcp tool catalog flags; all targets must use the same tool-shaping flags as defaultTarget "${defaultTarget}"`);
    }
  }
}

const CONNECTION_FLAG_KEYS = new Set(["autoconnect", "browserurl", "wsendpoint"]);
const CONNECTION_SHORT_FLAGS = new Set(["-u", "-w"]);
const PINNED_CDP_CONFLICT_KEYS = new Set(["channel", "userdatadir", "executablepath"]);
const PINNED_CDP_CONFLICT_SHORT_FLAGS = new Set(["-e"]);

function isNamedFlag(arg, keys, shorts) {
  if (!arg.startsWith("-")) return false;
  const { rawName } = splitArg(arg);
  if (shorts.has(rawName)) return true;
  const negated = rawName.startsWith("--no-");
  const key = normalizeFlagKey(negated ? `--${rawName.slice("--no-".length)}` : rawName);
  return keys.has(key);
}

function stripFlags(args, keys, shorts) {
  const stripped = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!isNamedFlag(arg, keys, shorts)) {
      stripped.push(arg);
      continue;
    }
    if (!arg.includes("=") && args[i + 1] && !args[i + 1].startsWith("-")) {
      i += 1;
    }
  }
  return stripped;
}

function stripConnectionArgs(args) {
  return stripFlags(args, CONNECTION_FLAG_KEYS, CONNECTION_SHORT_FLAGS);
}

function stripPinnedCdpConflictArgs(args) {
  return stripFlags(args, PINNED_CDP_CONFLICT_KEYS, PINNED_CDP_CONFLICT_SHORT_FLAGS);
}

export function connectionArgsForIdentity(identity) {
  if (identity.kind === "launch") return [];
  if (identity.kind === "pending-autoConnect") return ["--autoConnect"];
  if (identity.browserWSEndpoint) return [`--wsEndpoint=${identity.browserWSEndpoint}`];
  return [`--browserUrl=${identity.browserURL}`];
}

export function buildChromeDevToolsArgv(bin, target, identity) {
  let targetArgs = rewriteDeprecatedChromeDevToolsArgs(target.args || []);
  targetArgs = stripConnectionArgs(targetArgs);
  if (identity.kind === "cdp") {
    targetArgs = stripPinnedCdpConflictArgs(targetArgs);
  }
  return [bin, "--no-usage-statistics", ...targetArgs, ...connectionArgsForIdentity(identity)];
}

export function rewriteDeprecatedChromeDevToolsArgs(args) {
  const rewritten = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      rewritten.push(arg);
      continue;
    }

    const { rawName, rawValue } = splitArg(arg);
    const negated = rawName.startsWith("--no-");
    const flagName = negated ? rawName.slice("--no-".length) : rawName.slice(2);
    const key = normalizeFlagKey(flagName);
    const canonical = DEPRECATED_FLAG_REWRITES.get(key);
    if (!canonical) {
      rewritten.push(arg);
      continue;
    }

    const prefix = negated ? "--no-" : "--";
    rewritten.push(rawValue === undefined ? `${prefix}${canonical}` : `${prefix}${canonical}=${rawValue}`);
  }
  return rewritten;
}

export function parseTargetConnectionFlags(args) {
  const flags = {
    autoConnect: false,
    browserUrl: null,
    wsEndpoint: null,
    channel: null,
    userDataDir: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    const { rawName, rawValue } = splitArg(arg);
    const negated = rawName.startsWith("--no-");
    const key = normalizeFlagKey(negated ? `--${rawName.slice("--no-".length)}` : rawName);

    if (key === "autoconnect") {
      flags.autoConnect = negated ? false : parseFlagValue(takeMaybeBooleanValue(args, i, rawValue).value) !== false;
      continue;
    }

    if (key === "browserurl" || rawName === "-u") {
      const taken = takeMaybeStringValue(args, i, rawValue);
      flags.browserUrl = taken.value ?? null;
      if (taken.consumedNext) i += 1;
      continue;
    }

    if (key === "wsendpoint" || rawName === "-w") {
      const taken = takeMaybeStringValue(args, i, rawValue);
      flags.wsEndpoint = taken.value ?? null;
      if (taken.consumedNext) i += 1;
      continue;
    }

    if (key === "channel") {
      const taken = takeMaybeStringValue(args, i, rawValue);
      flags.channel = taken.value ?? null;
      if (taken.consumedNext) i += 1;
      continue;
    }

    if (key === "userdatadir") {
      const taken = takeMaybeStringValue(args, i, rawValue);
      flags.userDataDir = taken.value ?? null;
      if (taken.consumedNext) i += 1;
    }
  }

  return flags;
}

export function normalizeLoopbackHost(hostname) {
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return "127.0.0.1";
  }
  return hostname;
}

export function parseDevToolsActivePort(content) {
  const [rawPort, rawPath] = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!rawPort || !rawPath) {
    throw new Error(`Invalid DevToolsActivePort '${content}' found`);
  }
  const port = parseInt(rawPort, 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port '${rawPort}' found`);
  }
  if (!rawPath.startsWith("/")) {
    throw new Error(`Invalid DevToolsActivePort path '${rawPath}' found`);
  }
  return {
    port,
    browserWSEndpoint: `ws://127.0.0.1:${port}${rawPath}`,
  };
}

export function getDefaultChromeUserDataDir(channel = "stable", runtime = {
  homedir: os.homedir,
  platform: process.platform,
  env: process.env,
}) {
  const home = runtime.homedir();
  const platform = runtime.platform;
  const env = runtime.env;
  const resolvedChannel = channel || "stable";

  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support", "Google");
    if (resolvedChannel === "beta") return path.join(base, "Chrome Beta");
    if (resolvedChannel === "dev") return path.join(base, "Chrome Dev");
    if (resolvedChannel === "canary") return path.join(base, "Chrome Canary");
    return path.join(base, "Chrome");
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    if (resolvedChannel === "beta") return path.join(localAppData, "Google", "Chrome Beta", "User Data");
    if (resolvedChannel === "dev") return path.join(localAppData, "Google", "Chrome Dev", "User Data");
    if (resolvedChannel === "canary") return path.join(localAppData, "Google", "Chrome SxS", "User Data");
    return path.join(localAppData, "Google", "Chrome", "User Data");
  }

  const configHome = env.CHROME_CONFIG_HOME || env.XDG_CONFIG_HOME || path.join(home, ".config");
  if (resolvedChannel === "beta") return path.join(configHome, "google-chrome-beta");
  if (resolvedChannel === "canary") return path.join(configHome, "google-chrome-canary");
  if (resolvedChannel === "dev") return path.join(configHome, "google-chrome-unstable");
  return path.join(configHome, "google-chrome");
}

function identityFromHttpUrl(url) {
  const parsed = new URL(url);
  const host = normalizeLoopbackHost(parsed.hostname);
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  return {
    kind: "cdp",
    source: "browserUrl",
    host,
    port,
    browserURL: `${parsed.protocol}//${host}:${port}`,
  };
}

function identityFromWsUrl(url) {
  const parsed = new URL(url);
  const host = normalizeLoopbackHost(parsed.hostname);
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "wss:" ? 443 : 80);
  return {
    kind: "cdp",
    source: "wsEndpoint",
    host,
    port,
    browserWSEndpoint: url,
  };
}

function readAutoConnectIdentity(userDataDir, readFile, channel) {
  const portPath = path.join(userDataDir, "DevToolsActivePort");
  let content;
  try {
    content = readFile(portPath, "utf-8");
  } catch {
    return {
      kind: "pending-autoConnect",
      source: "autoConnect",
      channel: channel || "stable",
      userDataDir,
      portFile: portPath,
    };
  }
  const parsed = parseDevToolsActivePort(content);
  return {
    kind: "cdp",
    source: "autoConnect",
    host: "127.0.0.1",
    port: parsed.port,
    browserWSEndpoint: parsed.browserWSEndpoint,
    userDataDir,
    portFile: portPath,
  };
}

export function resolveTargetIdentity(target, runtime = {
  readFileSync,
  homedir: os.homedir,
  platform: process.platform,
  env: process.env,
}) {
  const args = target.args || [];
  const flags = parseTargetConnectionFlags(args);
  assertCompatibleConnectionFlags(flags, target);

  if (flags.wsEndpoint) {
    return identityFromWsUrl(flags.wsEndpoint);
  }
  if (flags.browserUrl) {
    return identityFromHttpUrl(flags.browserUrl);
  }
  if (target.port !== undefined) {
    const port = Number(target.port);
    return {
      kind: "cdp",
      source: "port",
      host: "127.0.0.1",
      port,
      browserURL: `http://127.0.0.1:${port}`,
    };
  }
  if (flags.autoConnect) {
    const userDataDir = flags.userDataDir || getDefaultChromeUserDataDir(flags.channel || "stable", runtime);
    return readAutoConnectIdentity(userDataDir, runtime.readFileSync, flags.channel || "stable");
  }

  return {
    kind: "launch",
    source: "launch",
    channel: flags.channel || "stable",
    userDataDir: flags.userDataDir || null,
  };
}

export function connectionKey(identity) {
  if (identity.kind === "launch") {
    return `launch:${identity.userDataDir || identity.channel || "default"}`;
  }
  if (identity.kind === "pending-autoConnect") {
    return `pending-autoConnect:${identity.userDataDir}`;
  }
  return `cdp:${identity.host}:${identity.port}`;
}

export function formatIdentity(identity) {
  if (identity.kind === "launch") {
    return `launch channel=${identity.channel}${identity.userDataDir ? ` userDataDir=${identity.userDataDir}` : ""}`;
  }
  if (identity.kind === "pending-autoConnect") {
    return `autoConnect pending ${identity.userDataDir}`;
  }
  if (identity.browserWSEndpoint) {
    return `${identity.source} ${identity.browserWSEndpoint}`;
  }
  return `${identity.source} ${identity.browserURL}`;
}

export function maybePinIdentity(identity, target, runtime) {
  if (identity.kind !== "pending-autoConnect") return identity;
  return resolveTargetIdentity(target, runtime);
}

export function findConnectedIdentityCollision(identities, name, identity) {
  const key = connectionKey(identity);
  for (const [otherName, otherIdentity] of identities) {
    if (otherName === name) continue;
    if (connectionKey(otherIdentity) === key) return otherName;
  }
  return null;
}

export function assertCompatibleConnectionFlags(flags, target = {}) {
  if (flags.autoConnect && (flags.browserUrl || flags.wsEndpoint || target.port !== undefined)) {
    throw new Error("auto-connect cannot be combined with browserUrl, wsEndpoint, or port");
  }
  if (flags.browserUrl && flags.wsEndpoint) {
    throw new Error("browserUrl and wsEndpoint cannot be combined");
  }
}

export function validateTargetConnections(targets, sourcePath) {
  for (const name of Object.keys(targets)) {
    const target = targets[name];
    try {
      assertCompatibleConnectionFlags(parseTargetConnectionFlags(target.args || []), target);
    } catch (error) {
      throw new Error(`Invalid config in ${sourcePath}: target "${name}" ${error.message}`);
    }
  }

  const collisions = findExplicitCdpCollisions(targets);
  if (collisions.length > 0) {
    const details = collisions.map((collision) => `${collision.names.join(" and ")} share ${collision.key}`).join("; ");
    throw new Error(`Invalid config in ${sourcePath}: ${details}`);
  }
}

export function findExplicitCdpCollisions(targets) {
  const seen = new Map();
  const collisions = [];

  for (const name of Object.keys(targets)) {
    const target = targets[name];
    const args = target.args || [];
    const flags = parseTargetConnectionFlags(args);
    if (flags.autoConnect) continue;

    let identity = null;
    try {
      if (flags.wsEndpoint || flags.browserUrl || target.port !== undefined) {
        identity = resolveTargetIdentity(target);
      }
    } catch {
      continue;
    }
    if (!identity || identity.kind !== "cdp") continue;

    const key = connectionKey(identity);
    if (seen.has(key)) {
      collisions.push({ key, names: [seen.get(key), name] });
    } else {
      seen.set(key, name);
    }
  }

  return collisions;
}

export function parseSelectedPageId(result) {
  const structuredPages = result?.structuredContent?.pages;
  if (Array.isArray(structuredPages)) {
    const selected = structuredPages.find((page) => page && page.selected === true);
    if (selected && typeof selected.id === "number") return selected.id;
  }

  const text = Array.isArray(result?.content)
    ? result.content.filter((item) => item && item.type === "text").map((item) => item.text).join("\n")
    : "";
  const match = text.match(/^(\d+): .* \[selected\]/m);
  if (match) return Number(match[1]);
  return null;
}
