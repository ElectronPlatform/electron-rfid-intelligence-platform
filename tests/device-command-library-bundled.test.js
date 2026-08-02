const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const rendererRoot = path.join(root, "renderer");
const registrySource = fs.readFileSync(
  path.join(rendererRoot, "devices", "deviceRegistry.js"),
  "utf8"
);

const storage = new Map();
const window = {};
const context = vm.createContext({
  window,
  console,
  CustomEvent: class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  },
  document: {
    dispatchEvent() {}
  },
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  },
  fetch: async relativePath => {
    const filePath = path.join(rendererRoot, String(relativePath));
    return {
      ok: fs.existsSync(filePath),
      async json() {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      }
    };
  },
  setTimeout,
  clearTimeout
});

vm.runInContext(registrySource, context, {
  filename: "renderer/devices/deviceRegistry.js"
});

(async () => {
  await window.DeviceRegistry.init();

  const catalog = JSON.parse(
    fs.readFileSync(
      path.join(rendererRoot, "devices", "proxmark3", "iceman-command-catalog.json"),
      "utf8"
    )
  );
  const curated = JSON.parse(
    fs.readFileSync(
      path.join(rendererRoot, "devices", "proxmark3", "commands.json"),
      "utf8"
    )
  );
  const key = item =>
    String(item?.command || item || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  const expected = new Set([
    ...catalog.entries.map(key),
    ...curated.commands.map(key)
  ]);
  const commands = window.DeviceRegistry.commands("proxmark3");

  const actual = new Set(commands.map(key));
  for (const required of expected) {
    assert.ok(
      actual.has(required),
      `The clean bundled Proxmark3 library is missing: ${required}`
    );
  }
  assert.strictEqual(
    actual.size,
    commands.length,
    "The clean bundled Proxmark3 library must not contain duplicate command rows."
  );
  assert.ok(commands.length > 900, "The clean bundled library should contain the complete command catalogue.");
  assert.ok(
    commands.some(item => item.command === "analyse lrc"),
    "Top-level catalogue command families must be included."
  );
  assert.ok(
    commands.some(item => item.command === "nfc help"),
    "Newer NFC catalogue commands must be included."
  );

  const curatedVersion = window.DeviceRegistry.commandByText("hw version", "proxmark3");
  assert.strictEqual(curatedVersion.title, "Read device information");
  assert.strictEqual(
    curatedVersion.safetyLevel,
    "read-only",
    "Curated Electron definitions must override matching catalogue entries."
  );

  const sourceBacked = window.DeviceRegistry.commandByText("analyse lrc", "proxmark3");
  assert.match(sourceBacked.documentationSource, /proxmark3/i);
  assert.strictEqual(storage.has("electron.deviceCommandLibraries.custom.v1"), false);

  console.log(`Bundled Device Command Library verification passed (${commands.length} commands).`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
