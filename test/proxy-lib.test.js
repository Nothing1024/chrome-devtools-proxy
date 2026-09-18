import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildChromeDevToolsArgv,
  connectionKey,
  findConnectedIdentityCollision,
  findExplicitCdpCollisions,
  getDefaultChromeUserDataDir,
  getToolCatalogSignature,
  maybePinIdentity,
  parseDevToolsActivePort,
  parseSelectedPageId,
  resolveTargetIdentity,
  rewriteDeprecatedChromeDevToolsArgs,
  validateTargetConnections,
} from "../chrome-devtools-proxy/proxy-lib.js";

function darwinRuntime(portFileContent) {
  return {
    homedir: () => "/Users/test",
    platform: "darwin",
    env: {},
    readFileSync(filePath) {
      const expected = path.join("/Users/test", "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort");
      if (filePath !== expected) {
        throw new Error(`unexpected path: ${filePath}`);
      }
      return portFileContent;
    },
  };
}

test("auto-connect pins the websocket from DevToolsActivePort", () => {
  const identity = resolveTargetIdentity(
    { args: ["--auto-connect"] },
    darwinRuntime("54321\n/devtools/browser/abc\n"),
  );
  assert.equal(identity.kind, "cdp");
  assert.equal(identity.source, "autoConnect");
  assert.equal(identity.port, 54321);
  assert.equal(identity.host, "127.0.0.1");
  assert.equal(identity.browserWSEndpoint, "ws://127.0.0.1:54321/devtools/browser/abc");
});

test("auto-connect stays pending when DevToolsActivePort is missing", () => {
  const identity = resolveTargetIdentity(
    { args: ["--auto-connect"] },
    {
      homedir: () => "/Users/test",
      platform: "darwin",
      env: {},
      readFileSync() {
        throw new Error("ENOENT");
      },
    },
  );
  assert.equal(identity.kind, "pending-autoConnect");
  assert.equal(connectionKey(identity), "pending-autoConnect:/Users/test/Library/Application Support/Google/Chrome");
  assert.deepEqual(
    buildChromeDevToolsArgv("/bin/chrome-devtools-mcp", { args: ["--auto-connect"] }, identity),
    ["/bin/chrome-devtools-mcp", "--no-usage-statistics", "--autoConnect"],
  );
});

test("pending auto-connect pins after the port file appears", () => {
  let present = false;
  const runtime = {
    homedir: () => "/Users/test",
    platform: "darwin",
    env: {},
    readFileSync() {
      if (!present) throw new Error("ENOENT");
      return "9222\n/devtools/browser/later\n";
    },
  };
  const pending = resolveTargetIdentity({ args: ["--auto-connect"] }, runtime);
  present = true;
  const pinned = maybePinIdentity(pending, { args: ["--auto-connect"] }, runtime);
  assert.equal(pinned.kind, "cdp");
  assert.equal(pinned.port, 9222);
  assert.equal(pinned.browserWSEndpoint, "ws://127.0.0.1:9222/devtools/browser/later");
});

test("pending auto-connect does not collide with a fixed port until pinned", () => {
  let present = false;
  const runtime = {
    homedir: () => "/Users/test",
    platform: "darwin",
    env: {},
    readFileSync() {
      if (!present) throw new Error("ENOENT");
      return "9222\n/devtools/browser/later\n";
    },
  };
  const pending = resolveTargetIdentity({ args: ["--auto-connect"] }, runtime);
  const identities = new Map([["host", pending]]);
  const portTarget = resolveTargetIdentity({ args: ["--browserUrl=http://127.0.0.1:9222"] });
  assert.equal(findConnectedIdentityCollision(identities, "port9222", portTarget), null);
  present = true;
  identities.set("host", maybePinIdentity(pending, { args: ["--auto-connect"] }, runtime));
  assert.equal(findConnectedIdentityCollision(identities, "port9222", portTarget), "host");
});

test("two pending auto-connect targets on the same profile collide", () => {
  const runtime = {
    homedir: () => "/Users/test",
    platform: "darwin",
    env: {},
    readFileSync() {
      throw new Error("ENOENT");
    },
  };
  const host = resolveTargetIdentity({ args: ["--auto-connect"] }, runtime);
  const identities = new Map([["host", host]]);
  const other = resolveTargetIdentity({ args: ["--auto-connect"] }, runtime);
  assert.equal(findConnectedIdentityCollision(identities, "daily", other), "host");
});

test("auto-connect plus a fixed browserUrl on the same target is rejected", () => {
  assert.throws(
    () => resolveTargetIdentity({ args: ["--auto-connect", "--browserUrl=http://127.0.0.1:9222"] }),
    /auto-connect cannot be combined/,
  );
});

test("localhost browserUrl and 127.0.0.1 port share one CDP identity", () => {
  const viaUrl = resolveTargetIdentity({ args: ["--browserUrl=http://localhost:9222"] });
  const viaPort = resolveTargetIdentity({ port: 9222, args: [] });
  assert.equal(connectionKey(viaUrl), "cdp:127.0.0.1:9222");
  assert.equal(connectionKey(viaPort), connectionKey(viaUrl));
});

test("wsEndpoint and browserUrl on the same port collide at runtime", () => {
  const identities = new Map([
    ["host", resolveTargetIdentity({ args: ["--browserUrl=http://127.0.0.1:9222"] })],
  ]);
  const other = resolveTargetIdentity({
    args: ["--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/abc"],
  });
  assert.equal(findConnectedIdentityCollision(identities, "app", other), "host");
});

test("auto-connect landing on 9222 collides with a browserUrl 9222 target", () => {
  const identities = new Map([
    ["host", resolveTargetIdentity({ args: ["--auto-connect"] }, darwinRuntime("9222\n/devtools/browser/xyz\n"))],
  ]);
  const portTarget = resolveTargetIdentity({ args: ["--browserUrl=http://127.0.0.1:9222"] });
  assert.equal(findConnectedIdentityCollision(identities, "port9222", portTarget), "host");
});

test("different CDP ports do not collide", () => {
  const identities = new Map([
    ["a", resolveTargetIdentity({ args: ["--browserUrl=http://127.0.0.1:9222"] })],
  ]);
  const b = resolveTargetIdentity({ args: ["--browserUrl=http://127.0.0.1:9223"] });
  assert.equal(findConnectedIdentityCollision(identities, "b", b), null);
});

test("config load rejects two explicit targets that share a port", () => {
  const collisions = findExplicitCdpCollisions({
    app: { args: ["--browserUrl=http://127.0.0.1:9222"] },
    admin: { port: 9222, args: [] },
  });
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0].names, ["app", "admin"]);
});

test("config load rejects auto-connect mixed with browserUrl on one target", () => {
  assert.throws(
    () => validateTargetConnections({
      host: { args: ["--auto-connect", "--browserUrl=http://127.0.0.1:9222"] },
    }, "targets.json"),
    /target "host" auto-connect cannot be combined/,
  );
});

test("auto-connect and a fixed port stay allowed in config", () => {
  validateTargetConnections({
    host: { args: ["--auto-connect"] },
    port9222: { args: ["--browserUrl=http://127.0.0.1:9222"] },
  }, "targets.json");
});

test("launch argv keeps channel", () => {
  const identity = resolveTargetIdentity({ args: ["--channel=canary"] });
  assert.equal(identity.kind, "launch");
  assert.deepEqual(
    buildChromeDevToolsArgv("/bin/chrome-devtools-mcp", { args: ["--channel=canary"] }, identity),
    ["/bin/chrome-devtools-mcp", "--no-usage-statistics", "--channel=canary"],
  );
});

test("pinned auto-connect argv uses wsEndpoint and drops channel and userDataDir", () => {
  const identity = resolveTargetIdentity(
    { args: ["--auto-connect", "--channel=stable"] },
    darwinRuntime("9333\n/devtools/browser/pin\n"),
  );
  const argv = buildChromeDevToolsArgv("/bin/chrome-devtools-mcp", {
    args: ["--auto-connect", "--channel=stable", "--user-data-dir=/tmp/chrome-profile"],
  }, identity);
  assert.deepEqual(argv, [
    "/bin/chrome-devtools-mcp",
    "--no-usage-statistics",
    "--wsEndpoint=ws://127.0.0.1:9333/devtools/browser/pin",
  ]);
});

test("browserUrl argv is rewritten to the normalized loopback URL", () => {
  const identity = resolveTargetIdentity({ args: ["--browserUrl=http://localhost:9222"] });
  const argv = buildChromeDevToolsArgv("/bin/chrome-devtools-mcp", {
    args: ["--browserUrl=http://localhost:9222"],
  }, identity);
  assert.deepEqual(argv, [
    "/bin/chrome-devtools-mcp",
    "--no-usage-statistics",
    "--browserUrl=http://127.0.0.1:9222",
  ]);
});

test("pageIdRouting defaults on and experimental alias maps to the same catalog flag", () => {
  const plain = JSON.parse(getToolCatalogSignature([]));
  const experimental = JSON.parse(getToolCatalogSignature(["--experimentalPageIdRouting"]));
  const canonical = JSON.parse(getToolCatalogSignature(["--pageIdRouting"]));
  const disabled = JSON.parse(getToolCatalogSignature(["--no-page-id-routing"]));
  assert.equal(Object.fromEntries(plain).pageIdRouting, true);
  assert.deepEqual(plain, experimental);
  assert.deepEqual(plain, canonical);
  assert.equal(Object.fromEntries(disabled).pageIdRouting, false);
});

test("deprecated experimentalPageIdRouting is rewritten for upstream 1.9", () => {
  assert.deepEqual(
    rewriteDeprecatedChromeDevToolsArgs(["--experimentalPageIdRouting", "--no-experimental-page-id-routing=false"]),
    ["--pageIdRouting", "--no-pageIdRouting=false"],
  );
});

test("parseSelectedPageId reads structured pages first", () => {
  assert.equal(parseSelectedPageId({
    structuredContent: {
      pages: [
        { id: 1, selected: false },
        { id: 4, selected: true },
      ],
    },
  }), 4);
});

test("parseSelectedPageId falls back to the list_pages text marker", () => {
  assert.equal(parseSelectedPageId({
    content: [{ type: "text", text: "## Pages\n1: Example (https://example.com)\n2: Docs (https://docs.example) [selected]" }],
  }), 2);
});

test("invalid DevToolsActivePort is rejected", () => {
  assert.throws(() => parseDevToolsActivePort("not-a-port\n"), /Invalid DevToolsActivePort/);
  assert.throws(() => parseDevToolsActivePort("9222\n"), /Invalid DevToolsActivePort/);
  assert.throws(() => parseDevToolsActivePort("9222\ndevtools/browser/x\n"), /Invalid DevToolsActivePort path/);
});

test("macOS stable Chrome user data dir matches puppeteer", () => {
  assert.equal(
    getDefaultChromeUserDataDir("stable", { homedir: () => "/Users/test", platform: "darwin", env: {} }),
    path.join("/Users/test", "Library", "Application Support", "Google", "Chrome"),
  );
});
