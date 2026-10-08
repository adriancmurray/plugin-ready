import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../plugin/skills/plugin-ready/scripts/check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const README_60 = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
const GOOD = {
  ".claude-plugin/plugin.json": JSON.stringify({
    name: "demo-tool",
    version: "0.1.0",
    description: "Demo plugin",
    author: { name: "Adrian" },
    license: "MIT",
  }),
  "README.md": README_60,
  "skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo skill.\n---\n\nBody.\n",
};

function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-ready-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

const severe = (findings) => findings.filter((f) => f.sev === "BLOCK" || f.sev === "HOLD");

test("minimal good plugin has no BLOCK or HOLD", () => {
  assert.deepEqual(severe(check(fixture(GOOD))), []);
});

test("bad plugin reports each blocking problem", () => {
  const dir = fixture({
    ".claude-plugin/plugin.json": JSON.stringify({ name: "Claude-Thing", version: "0.1.0", description: "x", author: { name: "A" }, license: "MIT" }),
    ".DS_Store": "",
    ".mcp.json": JSON.stringify({
      mcpServers: {
        remote: { type: "http", url: "http://example.com/mcp", headers: { Authorization: "Bearer abc" } },
        local: { command: "npx", args: ["some-pkg"] },
      },
    }),
  });
  const blocks = new Set(check(dir).filter((f) => f.sev === "BLOCK").map((f) => f.id));
  for (const id of ["manifest-name", "readme", "system-file", "mcp-url", "unpinned-launcher", "mcp-secret"]) {
    assert.ok(blocks.has(id), `expected BLOCK ${id}`);
  }
});

test("hook and local credential lookup are held", () => {
  const dir = fixture({
    ...GOOD,
    "hooks/register.ts": `export function register(on) {\n  on("agent.spawn", () => {});\n  const t = ${"process" + ".env.X"};\n}\n`,
  });
  const held = new Set(check(dir).filter((f) => f.sev === "HOLD").map((f) => f.id));
  assert.ok(held.has("permission-decision"));
  assert.ok(held.has("credential"));
});

test("the plugin-ready plugin passes its own check", () => {
  const findings = check(path.join(here, "..", "plugin"));
  assert.deepEqual(findings.filter((f) => f.sev === "BLOCK"), []);
  assert.equal(findings.filter((f) => f.sev === "HOLD" && f.id === "credential").length, 0);
});
