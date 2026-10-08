#!/usr/bin/env node
// Pre-publish gate for a Claude plugin directory. Reads files only; never runs,
// fetches or installs anything. BLOCK stops publishing, HOLD needs a human
// decision, WARN and NOTE are advisory.
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = path.resolve(fileURLToPath(import.meta.url));
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED = ["claude", "anthropic", "official", "plugin", "mcp", "test"];
const SYSTEM_NAMES = [".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
const SCAN_EXT = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".sh", ".json"];
const HOOK_EXT = [".js", ".mjs", ".cjs", ".ts", ".tsx"];
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "uv.lock", "poetry.lock"];
const REGISTRY_RE = /registry\s*=|--index-url|--registry/;
const HOOK_ON_RE = /\bon\(\s*["'`]([\w.]+)["'`]/g;
const PKG_RE = /^(@[^/@]+\/)?[^@]+@[^@]+$/;
const SKILL_RE = /^skills\/[^/]+\/SKILL\.md$/;
const MB = 1024 * 1024;
const SEV_ORDER = ["BLOCK", "HOLD", "WARN", "NOTE"];
const TOPICS = [["network"], ["credential"], ["writes", "storage", "store"]];
// Patterns that are split by concatenation so this file does not match its own scan.
const CRED_PATTERNS = [
  new RegExp("process" + "\\.env"),
  new RegExp("os\\." + "environ"),
  /Deno\.env/,
  new RegExp("home" + "dir\\("),
  /os\.path\.expanduser/,
  /~\/\./, // a home dotfile; plain ~/ paths in help text are not credentials
  /\.claude\//,
  /\.aws\//,
  /\.ssh\//,
  /\.config\/gh/,
  /\.netrc/,
  new RegExp("\\." + "credentials"),
  new RegExp("key" + "chain"),
  /security find-/,
];

const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
const lineAt = (text, idx) => text.slice(0, Math.max(0, idx)).split("\n").length;
const lineOf = (text, needle) => {
  const i = text.indexOf(needle);
  return i < 0 ? 1 : lineAt(text, i);
};

function readHead(p) {
  const fd = openSync(p, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

function walk(root) {
  const files = [];
  const nodeModules = [];
  const visit = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.name === ".git") continue;
      if (ent.isDirectory()) {
        if (ent.name === "node_modules") nodeModules.push(rel(root, p));
        else visit(p);
      } else if (ent.isFile()) {
        files.push(rel(root, p));
      }
    }
  };
  visit(root);
  return { files, nodeModules };
}

function makeCtx(root, files, repoRoot) {
  const ctx = {
    root,
    files,
    repoRoot,
    findings: [],
    add: (sev, id, where, msg, fix) => ctx.findings.push({ sev, id, where, msg, fix }),
    read: (f) => readFileSync(path.join(root, f), "utf8"),
  };
  ctx.text = files.filter((f) => {
    const abs = path.join(root, f);
    return statSync(abs).size <= 5 * MB && !readHead(abs).includes(0);
  });
  return ctx;
}

const isSelf = (ctx, f) => path.resolve(ctx.root, f) === SELF;

function defaultRepo(root) {
  const parent = path.dirname(root);
  return existsSync(path.join(parent, ".claude-plugin", "marketplace.json")) ? parent : undefined;
}

function checkName(ctx, m, text, where) {
  const name = String(m.name ?? "");
  const line = `${where}:${lineOf(text, '"name"')}`;
  const invalid = !NAME_RE.test(name) || name.length > 64;
  const reserved = name.startsWith("claude-") || name.startsWith("anthropic-") || RESERVED.includes(name);
  if (invalid || reserved) {
    ctx.add("BLOCK", "manifest-name", line, `plugin name "${name}" is invalid or reserved`,
      "use lowercase letters, digits and hyphens, max 64 chars, no claude- or anthropic- prefix");
  }
}

function checkManifest(ctx) {
  const where = ".claude-plugin/plugin.json";
  if (!ctx.files.includes(where)) {
    ctx.add("BLOCK", "manifest", "-", "plugin.json is missing", "add .claude-plugin/plugin.json");
    return null;
  }
  const text = ctx.read(where);
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    ctx.add("BLOCK", "manifest", `${where}:1`, "plugin.json is not valid JSON", "fix the JSON syntax");
    return null;
  }
  checkName(ctx, m, text, where);
  const required = [["version", m.version], ["description", m.description], ["author", m.author?.name]];
  for (const [key, val] of required) {
    if (!val) {
      ctx.add("WARN", "manifest-field", `${where}:${lineOf(text, `"${key}"`)}`,
        `plugin.json has no ${key === "author" ? "author.name" : key}`, `add a ${key} field`);
    }
  }
  if (m.hooks !== undefined && JSON.stringify(m.hooks).includes("hooks.json")) {
    ctx.add("WARN", "manifest-hooks", `${where}:${lineOf(text, '"hooks"')}`,
      "hooks field points at hooks/hooks.json, which already loads automatically",
      "remove the hooks field so the file is not loaded twice");
  }
  return m;
}

function checkLicense(ctx, m) {
  const hasFile = ctx.files.some((f) => !f.includes("/") && path.basename(f).startsWith("LICENSE"));
  if (!m?.license && !hasFile) {
    ctx.add("BLOCK", "license", "-", "no license in plugin.json and no LICENSE file in the plugin",
      "add a license field or a LICENSE file");
  }
}

function checkIcon(ctx, m, text) {
  if (!m?.icon) {
    ctx.add("NOTE", "icon", "-", "no icon set", "optional: set icon to a ./ image path");
    return;
  }
  const where = `.claude-plugin/plugin.json:${lineOf(text, '"icon"')}`;
  const icon = String(m.icon);
  const abs = path.resolve(ctx.root, icon);
  const inside = abs.startsWith(ctx.root + path.sep);
  const ok = icon.startsWith("./") && inside && existsSync(abs) && statSync(abs).isFile()
    && IMAGE_EXT.includes(path.extname(abs).toLowerCase());
  if (!ok) {
    ctx.add("BLOCK", "icon", where, `icon "${icon}" is not an image inside the plugin`,
      "use a ./ path to an existing png, jpg, jpeg, gif, webp or svg inside the plugin");
  }
}

function checkReadme(ctx) {
  if (!ctx.files.includes("README.md")) {
    ctx.add("BLOCK", "readme", "-", "README.md is missing", "add README.md describing the plugin");
    return "";
  }
  const text = ctx.read("README.md");
  const words = text.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter(Boolean).length;
  if (words < 40) {
    ctx.add("BLOCK", "readme", "README.md:1", `README has ${words} words outside code blocks, need 40`,
      "expand the README");
  }
  return text;
}

function checkTopics(ctx, text) {
  const touches = ctx.files.some((f) => f.startsWith("hooks/") || f.startsWith("bin/") || f === ".mcp.json");
  if (!touches) return;
  const lower = text.toLowerCase();
  for (const alts of TOPICS) {
    if (!alts.some((a) => lower.includes(a))) {
      ctx.add("WARN", "readme-topic", "README.md:1", `README does not mention ${alts.join(" or ")}`,
        "add a 'What this plugin changes and touches' section");
    }
  }
}

function checkSystemFiles(ctx) {
  for (const f of ctx.files) {
    if (f.split("/").some((seg) => SYSTEM_NAMES.includes(seg))) {
      ctx.add("BLOCK", "system-file", `${f}:1`, "OS metadata file in the bundle", "delete it and add it to .gitignore");
    }
  }
}

function checkSize(ctx) {
  const n = ctx.files.length;
  if (n >= 10000) ctx.add("BLOCK", "size", "-", `${n} files in the bundle`, "ship fewer files");
  else if (n > 512) ctx.add("HOLD", "size", "-", `${n} files in the bundle`, "confirm every file is needed");
  for (const f of ctx.files) {
    const size = statSync(path.join(ctx.root, f)).size;
    if (size > 5 * MB) {
      ctx.add("BLOCK", "size", `${f}:1`, `${f} is over 5 MiB`, "remove or shrink the file");
    } else if (size >= 256 * 1024) {
      ctx.add("HOLD", "size", `${f}:1`, `${f} is 256 KiB or larger`, "confirm the file must ship");
    }
  }
}

function checkBinary(ctx) {
  for (const f of ctx.files) {
    if (IMAGE_EXT.includes(path.extname(f).toLowerCase())) continue;
    if (readHead(path.join(ctx.root, f)).includes(0)) {
      ctx.add("HOLD", "binary", `${f}:1`, "binary file that is not an image", "remove it or document why it ships");
    }
  }
}

function checkJson(ctx) {
  let mcp = null;
  for (const f of ["hooks/hooks.json", ".mcp.json"]) {
    if (!ctx.files.includes(f)) continue;
    try {
      const data = JSON.parse(ctx.read(f));
      if (f === ".mcp.json") mcp = data;
    } catch {
      ctx.add("BLOCK", "json", `${f}:1`, `${f} is not valid JSON`, "fix the JSON syntax");
    }
  }
  return mcp;
}

function checkLauncher(ctx, text, name, s) {
  const args = Array.isArray(s.args) ? s.args : [];
  const pkg = args.find((a) => typeof a === "string" && !a.startsWith("-"));
  const where = `.mcp.json:${lineOf(text, JSON.stringify(s.command))}`;
  const pinned = pkg !== undefined && (PKG_RE.test(pkg) || (s.command === "uvx" && pkg.includes("==")));
  if (pinned) {
    ctx.add("HOLD", "mcp-pinned", where, `Runs a pinned npx or uvx package (MCP server "${name}")`,
      "confirm the package and version are trusted");
  } else {
    ctx.add("BLOCK", "unpinned-launcher", where, `Unpinned launcher (MCP server "${name}")`,
      "pin the package to an exact version");
  }
}

function checkHeaders(ctx, text, name, headers) {
  const h = headers && typeof headers === "object" ? headers : {};
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === "string" && !v.includes("${")) {
      ctx.add("BLOCK", "mcp-secret", `.mcp.json:${lineOf(text, JSON.stringify(k))}`,
        `Secret in MCP headers (server "${name}", header "${k}")`,
        "read the value from userConfig with sensitive: true");
    }
  }
}

function checkMcp(ctx, mcp) {
  if (!mcp) return;
  const text = ctx.read(".mcp.json");
  const servers = mcp.mcpServers && typeof mcp.mcpServers === "object" ? mcp.mcpServers : {};
  for (const [name, s] of Object.entries(servers)) {
    if (!s || typeof s !== "object") continue;
    if (typeof s.url === "string" && !s.url.startsWith("https://")) {
      ctx.add("BLOCK", "mcp-url", `.mcp.json:${lineOf(text, JSON.stringify(s.url))}`,
        `MCP server "${name}" url is not https`, "use an https:// endpoint");
    }
    if (s.command === "npx" || s.command === "uvx") checkLauncher(ctx, text, name, s);
    checkHeaders(ctx, text, name, s.headers);
  }
}

function checkSupplyChain(ctx) {
  for (const f of ctx.files) {
    const base = path.basename(f);
    if (LOCKFILES.includes(base)) {
      ctx.add("HOLD", "lockfile", `${f}:1`, `${base} pins dependencies`, "confirm the lockfile is reviewed and intended");
    }
    if (base === ".npmrc" || base === "pip.conf") {
      ctx.add("HOLD", "custom-registry", `${f}:1`, "custom registry", "confirm the registry is trusted");
    }
  }
  for (const f of ctx.text) {
    if (isSelf(ctx, f) || f.endsWith(".md")) continue; // docs may name registry flags
    const idx = ctx.read(f).split("\n").findIndex((line) => REGISTRY_RE.test(line));
    if (idx >= 0) {
      ctx.add("HOLD", "custom-registry", `${f}:${idx + 1}`, "custom registry", "confirm the registry is trusted");
    }
  }
}

function checkCredentials(ctx) {
  for (const f of ctx.text) {
    if (!SCAN_EXT.includes(path.extname(f).toLowerCase()) || isSelf(ctx, f)) continue;
    ctx.read(f).split("\n").forEach((line, i) => {
      if (CRED_PATTERNS.some((re) => re.test(line))) {
        ctx.add("HOLD", "credential", `${f}:${i + 1}`, "Uses a credential from the user's machine",
          "remove the local lookup or route the secret through userConfig");
      }
    });
  }
}

function checkHooks(ctx, readme) {
  const events = new Map();
  for (const f of ctx.text) {
    if (!HOOK_EXT.includes(path.extname(f)) || isSelf(ctx, f)) continue;
    const text = ctx.read(f);
    if (!f.startsWith("hooks/") && !text.includes("export function register")) continue;
    for (const m of text.matchAll(HOOK_ON_RE)) {
      if (!events.has(m[1])) events.set(m[1], `${f}:${lineAt(text, m.index)}`);
    }
  }
  for (const f of ctx.text) {
    if (!HOOK_EXT.includes(path.extname(f)) || isSelf(ctx, f)) continue;
    const idx = ctx.read(f).split("\n").findIndex((line) => line.includes("$.prompt" + ".submit"));
    if (idx >= 0) {
      ctx.add("HOLD", "prompt-submit", `${f}:${idx + 1}`, "mod can submit a prompt that may carry text out",
        "say in README exactly what text the submitted prompt contains");
    }
  }
  for (const [ev, where] of events) {
    // HaiKrew 0.3.0: the portal held the agent.spawn rewrite, but only noted tool.call refusals.
    if (ev === "agent.spawn" || ev.startsWith("permission")) {
      ctx.add("HOLD", "permission-decision", where, `can rewrite or refuse ${ev}`,
        "only `return next(e)` clears it; otherwise keep it, disclose it in README, and expect a reviewer");
    } else if (ev === "tool.call") {
      ctx.add("NOTE", "shared-event", where, "hooks tool.call, which every tool call passes through",
        "say in README what the hook changes or refuses");
    }
    if (!readme.includes(ev)) {
      ctx.add("NOTE", "hook-readme", where, `README does not name hook ${ev}`, "name the hook in README");
    }
  }
}

function checkSkill(ctx, f) {
  const text = ctx.read(f).replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) {
    ctx.add("WARN", "skill", `${f}:1`, "SKILL.md has no frontmatter", "add --- delimited frontmatter with name and description");
    return;
  }
  const field = (key) => (fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "")
    .trim().replace(/^["']|["']$/g, "");
  const name = field("name");
  const desc = field("description");
  if (!NAME_RE.test(name) || name.length > 64) {
    ctx.add("WARN", "skill", `${f}:1`, `skill name "${name}" is invalid`, "use the plugin name rules, max 64 chars");
  }
  if (!desc || desc.length > 1024) {
    ctx.add("WARN", "skill", `${f}:1`, "skill description is missing or over 1024 chars", "write a one-line description under 1024 chars");
  }
  if (text.slice(fm[0].length).split("\n").length > 500) {
    ctx.add("WARN", "skill", `${f}:1`, "SKILL.md body is over 500 lines", "move detail into referenced files");
  }
}

function checkMarketplace(ctx) {
  if (!ctx.repoRoot) return;
  const mp = path.join(ctx.repoRoot, ".claude-plugin", "marketplace.json");
  if (!existsSync(mp)) return;
  let m;
  try {
    m = JSON.parse(readFileSync(mp, "utf8"));
  } catch {
    ctx.add("BLOCK", "marketplace", "-", "marketplace.json is not valid JSON", "fix the JSON syntax");
    return;
  }
  if (!m.description && !m.metadata?.description) {
    ctx.add("WARN", "marketplace", "-", "marketplace has no description", "add description or metadata.description");
  }
  for (const p of Array.isArray(m.plugins) ? m.plugins : []) {
    if (typeof p?.source !== "string") continue;
    if (!p.source.startsWith("./") || !existsSync(path.join(ctx.repoRoot, p.source))) {
      ctx.add("BLOCK", "marketplace", "-", `plugin source "${p.source}" must start ./ and exist under the repo`,
        "fix the source path");
    }
  }
}

/**
 * Runs every publish check against a plugin directory.
 * @param {string} pluginDir Plugin root containing .claude-plugin/plugin.json.
 * @param {string} [repoRoot] Marketplace repo root; defaults to the parent of pluginDir when it has a marketplace.json.
 * @returns {{sev: string, id: string, where: string, msg: string, fix: string}[]} Findings in discovery order.
 */
export function check(pluginDir, repoRoot) {
  const root = path.resolve(pluginDir);
  const { files, nodeModules } = walk(root);
  const ctx = makeCtx(root, files, repoRoot ? path.resolve(repoRoot) : defaultRepo(root));
  for (const nm of nodeModules) {
    ctx.add("WARN", "node-modules", `${nm}:1`, "node_modules in bundle", "remove node_modules from the plugin");
  }
  checkSize(ctx);
  checkBinary(ctx);
  checkSystemFiles(ctx);
  const m = checkManifest(ctx);
  checkLicense(ctx, m);
  checkIcon(ctx, m, m ? ctx.read(".claude-plugin/plugin.json") : "");
  const readme = checkReadme(ctx);
  checkTopics(ctx, readme);
  checkMcp(ctx, checkJson(ctx));
  checkSupplyChain(ctx);
  checkCredentials(ctx);
  checkHooks(ctx, readme);
  for (const f of files.filter((x) => SKILL_RE.test(x))) checkSkill(ctx, f);
  checkMarketplace(ctx);
  return ctx.findings;
}

function readVersion(pluginDir) {
  try {
    return JSON.parse(readFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")).version ?? "-";
  } catch {
    return "-";
  }
}

function main(args) {
  const repoIdx = args.indexOf("--repo");
  const repoRoot = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
  const valueIdx = repoIdx >= 0 ? repoIdx + 1 : -1;
  const pluginDir = args.find((a, i) => !a.startsWith("--") && i !== valueIdx);
  if (!pluginDir) {
    console.error("usage: node check.mjs <pluginDir> [--repo <repoRoot>]");
    process.exitCode = 2;
    return;
  }
  const findings = check(pluginDir, repoRoot);
  findings.sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
  for (const f of findings) console.log(`${f.sev}  ${f.id}  ${f.where}  ${f.msg}  -> ${f.fix}`);
  console.log(`version: ${readVersion(path.resolve(pluginDir))}`);
  const count = (sev) => findings.filter((f) => f.sev === sev).length;
  const blocks = count("BLOCK");
  const holds = count("HOLD");
  if (blocks) console.log(`VERDICT: BLOCKED (${blocks})`);
  else if (holds) console.log(`VERDICT: HELD (${holds})`);
  else console.log("VERDICT: READY");
  process.exitCode = blocks ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
