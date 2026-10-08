---
name: plugin-ready
description: Gets a Claude Code plugin ready for Anthropic's plugin directory. Runs a local readiness check (manifest, license, README disclosures, icon, bundle size, MCP launchers, credential reads, mod hooks that can refuse or rewrite calls), then fixes each finding until it is clear. Use before submitting a plugin at claude.ai/directory/manage, before pushing a new version of a listed plugin, or when the portal's Validate step reports a Block, a policy hold, a Warning or a Note.
---

# Plugin ready

Goal: the portal's Validate step reports no Blocks, and every policy hold is either removed or disclosed in the README. A local script does the deterministic checks; you fix what it finds and re-run it.

The directory reads only the plugin folder (the "Plugin path" given at submission). Everything a reviewer needs, the README and LICENSE included, must be inside that folder.

## Checklist

Copy it into your reply and tick each item.

```
- [ ] 1. Locate the plugin folder (the one holding .claude-plugin/plugin.json) and the repo root
- [ ] 2. Run the readiness check; save the output
- [ ] 3. Fix every BLOCK (references/findings.md says how)
- [ ] 4. For every HOLD: remove the cause, or keep it and disclose it in the README
- [ ] 5. Write or update the README disclosure section (references/readme-template.md)
- [ ] 6. Clear WARNs; read NOTEs
- [ ] 7. Re-run the check until VERDICT is READY, or HELD only for holds you chose to keep
- [ ] 8. Run claude plugin validate --strict (plugin folder and repo root) and the plugin's own tests
- [ ] 9. Bump version in plugin.json
- [ ] 10. Grep the diff for private data, then report to the user; push only with their approval
```

## 2. Run the check

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/plugin-ready/scripts/check.mjs" <plugin-folder> --repo <repo-root>
```

Each line is `SEV id where msg -> fix`. The last line is `VERDICT: READY`, `VERDICT: HELD (n)` or `VERDICT: BLOCKED (n)`; exit code 1 means blocked. The script reads files only. It does not run code, use the network or touch git.

Severity means the same as in the portal:
- **BLOCK**: the portal refuses the submission. Fix it.
- **HOLD**: submittable, but a reviewer must clear that version before it goes live. Remove the cause if it is not essential; otherwise disclose it.
- **WARN**: listed but does not stop anything. Fix it; it is usually one line.
- **NOTE**: information. Usually a README line.

The script is a heuristic. A clean run does not guarantee a clean portal result, and the portal's scan can find things the script cannot (undisclosed data sending, hidden code).

## 3–4. Fix findings

Look up each `id` in [references/findings.md](references/findings.md): what triggers it, how to clear it, and an example from a real plugin. Rules that matter most:

- Prefer removing the cause over explaining it. If code reads environment variables, the home folder or `~/.claude` and is not essential, delete it.
- A hook that can refuse or rewrite a call the user made (agent launches, tool calls, permission events) is held. Make it off by default behind a setting, and say so in the README.
- Never hard-code a secret. Put it in `userConfig` with `sensitive: true`.
- Pin every `npx`/`uvx` package to an exact version.

## 5. README

Use [references/readme-template.md](references/readme-template.md). The README needs at least 40 words outside code blocks, and it must say what the plugin runs, sends, fetches, stores and hooks. Name every hook event the plugin registers, and say what it changes.

## 8. Local commands

```bash
claude plugin validate <plugin-folder> --strict
claude plugin validate <repo-root> --strict
claude plugin test <plugin-folder>
claude --plugin-dir <plugin-folder>
```

- `validate`: checks the manifest and component schema. With `--strict`, warnings fail too. It does not check the README, license or name availability; the readiness script does.
- `test`: runs `*.test.ts` mod tests. Only for plugins with a mod.
- `--plugin-dir`: loads the plugin for one session as a smoke test.
- `claude plugin eval <target>`: runs eval suites, if the plugin has them.

## 10. Release and submit

1. Bump `version` in plugin.json. Each release needs a new version.
2. Check the diff: `git diff --cached | grep -nE '/Users/|/home/|@gmail|BEGIN .*PRIVATE KEY'` must print nothing.
3. Push only with the user's approval. Each push to the submitted branch is scanned again.
4. Ask the user to submit, or to press Re-validate, at https://claude.ai/directory/manage. New submissions use Submit new, then Plugin bundle, and the plugin folder's path in Plugin path. Submitting, the data-handling answers and the compliance step are the user's to do.

## Report

Report to the user in plain terms: findings fixed, findings kept and why, the check's VERDICT line, the validate result, and what has not been verified. Name any hold you kept.
