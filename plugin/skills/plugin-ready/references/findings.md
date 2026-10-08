# Findings: trigger and fix

Titles in quotes are the portal's wording. `check.mjs` ids are in brackets. Sources: claude.com/docs/plugins/pre-submission-checklist and claude.com/docs/plugins/submit.

## Blocks (the portal refuses the submission)

| Portal title | Trigger | Fix |
|---|---|---|
| "README missing", "README too short" [readme] | No README.md in the plugin folder, or fewer than 40 words outside code blocks | Write one from readme-template.md |
| "License missing" [license] | No LICENSE file in the plugin folder and no `license` in plugin.json | Add `"license": "MIT"` (an SPDX id) or a LICENSE file |
| "Name is taken", "Non-ASCII identifier" [manifest-name] | Name already listed, or not lowercase ASCII | Name: lowercase letters, digits and hyphens, at most 64 characters. Not `claude`, `anthropic`, `official`, `plugin`, `mcp` or `test` alone, and not starting with `claude-` or `anthropic-` |
| "Secret in MCP headers" [mcp-secret] | A literal token in `.mcp.json` headers | `userConfig` option with `sensitive: true`, referenced as `${user_config.NAME}` |
| "Unpinned npx launcher", "Unpinned uvx launcher" [unpinned-launcher] | `npx pkg` or `uvx pkg` with no version | `npx pkg@1.2.3`, `uvx pkg==1.2.3` |
| "hooks.json is invalid", ".mcp.json can't be parsed" [json, manifest, marketplace] | Bad JSON | Fix the JSON; `claude plugin validate` shows where |
| "MCP server URL is not https" [mcp-url] | `http://` server URL | Use https |
| "This is a macOS or Windows system file" [system-file] | .DS_Store, Thumbs.db, desktop.ini, __MACOSX | Delete them and add them to .gitignore |
| "Repository too large to validate" [size] | Archive >50 MiB, unpacked >256 MiB, 10,000+ files, or a file >5 MiB | Move assets out of the plugin folder |
| "Couldn't validate that repository" | Wrong Plugin path or wrong case, odd names, `.gitattributes` export-ignore or filters | Check the path and .gitattributes |

## Policy holds (submittable; a reviewer must clear the version)

| Portal title | Trigger | Fix |
|---|---|---|
| "Uses a credential from the user's machine" [credential] | Code that reads environment variables, the home folder, `~/.claude`, `~/.aws`, `~/.ssh`, the keychain or `.netrc`, especially if a value could leave the machine | Delete the read if it is not essential. Otherwise disclose what is read and that it is never sent |
| "Mod takes, or can take, a permission decision out of the user's hands" [permission-decision] | A mod hook that refuses or rewrites a user's call (`agent.spawn`, `tool.call`, permission events) | Only passing the event on unchanged (`return next(e)`) clears it: the scan reads code, not settings, so a default-off setting does not. If the rewrite is the plugin's purpose, keep it: ship it off by default, say in the README what it changes and that it never changes the permission mode, and expect a reviewer to clear each version |
| "Mod can read the conversation or other data and can also submit a prompt that can carry text out" [prompt-submit] | A mod that reads session data and calls `$.prompt.submit` | Remove the submit, or say in the README the exact text of the prompt and that it carries no conversation or file content |
| "Files or downloads the validator couldn't inspect" [size, binary] | A file of 256 KiB or more, more than 512 files, or non-image binaries | Keep large or binary assets outside the plugin folder |
| "Scripts the validator couldn't follow" | Generated, minified or dynamically built code | Ship readable source |
| "MCP server command wasn't read", "Bundled MCP server not inspected" | An MCP command the scanner cannot open, or a .mcpb/.dxt bundle | Ship source, or disclose |
| "Install may use a custom registry or package source" [custom-registry] | .npmrc, pip.conf, `--registry`, `--index-url` | Use the default registry |
| "Runs a pinned npx or uvx package", "Dependencies install from a lockfile" [mcp-pinned, lockfile] | Any pinned launcher or lockfile | Always held. Keep it if needed and disclose |
| "Name may be confused with an existing listing", "Name matches a known brand", "Fork uses the upstream project's name" | Name close to a listed plugin or a brand | Rename |

## Warnings and notes

| Finding | Fix |
|---|---|
| Missing description, author or version in plugin.json [manifest-field] | Add them |
| "No marketplace description" [marketplace] | `"metadata": { "description": "..." }` in .claude-plugin/marketplace.json |
| hooks.json listed in plugin.json `hooks` [manifest-hooks] | Remove the field; hooks/hooks.json loads by default |
| Field from another tool's manifest: `icon` | No action: Claude Code ignores `icon`; the directory reads it |
| A mod hooks an event other calls pass through, or an event that is also a call name [shared-event, hook-readme] | One README line naming the event and what the hook does to it |

## Reading a hold

Click the chevron on a hold row: it expands to the exact files and fragments the scan matched, and a finding code. Fix what it names before guessing. The scan matches names, not meaning: identifiers like `key`, `token` or `secret` can read as credentials, and `{n,m}` inside a regex or template can read as text built at run time.

Finding codes seen so far:

| Code | Portal title |
|---|---|
| `MOD_ANSWERS_PERMISSION` | Mod takes, or can take, a permission decision out of the user's hands |
| `MOD_DATA_LEAVES_BY_PROMPT` | Mod can read the conversation or other data and can also submit a prompt that can carry text out (any `$.fs.read` plus `$.prompt.submit`) |
| `MCP_FORWARDS_CREDENTIAL_ENV` | Uses a credential from the user's machine (a "reads the key" part and a "sends data" part, read together across files) |
| `UNKNOWN_KEY_CROSS_TOOL` | Field from another tool's manifest (`icon`; no action) |

A regex quantifier like `{1,6}` is shown in findings as `$` (for example `^#{1,6}\s` appears as `^#$\s`): the scan treats braces as a run-time value. Use `+` or spell the alternatives out.

## Checker-only findings

| id | Meaning | Fix |
|---|---|---|
| readme-topic | Plugin has hooks, MCP or bin/ but README never mentions network, credentials or storage | Add the "changes and touches" section from readme-template.md |
| skill | SKILL.md frontmatter missing, name or description invalid, or body over 500 lines | Fix frontmatter; move detail into references/ |
| node-modules | node_modules inside the bundle | Remove it from the plugin folder |
| icon (NOTE) | No icon set | Optional: `"icon": "./.claude-plugin/icon.png"` |

## Worked example: HaiKrew 0.3.0 → 0.4.0

| Finding | Cause | What was done |
|---|---|---|
| Hold: permission decision, at `hooks/register.ts` | `agent.spawn` hook set subagent models and refused Opus | Gate made off by default (`gate.enabled: false`). README says it does nothing until turned on, and never changes the permission mode |
| Hold: credential, on plugin.json | A `stats` CLI read `~/.claude/projects`, an environment-variable path override, and a home-folder lookup for the log folder | All removed (logs moved to the system temp folder in 0.5.2). README states that no environment variables, keychain or `~/.claude` files are read |
| Hold: credential, still present in 0.5.2 | The expanded finding (click the row's chevron; the code is `MCP_FORWARDS_CREDENTIAL_ENV`) named two false triggers it read together: a settings loop variable named `key` in `src/mod/config.ts` (read as "the installer's key"), and a regex `^#{1,6}\s` in `src/mod/guards.ts` (read as "a command assembled at run time") | Renamed the variable to `field`; rewrote the regex as `^#+\s` (0.5.3) |
| Hold: permission decision, still present in 0.5.x | Default-off did not clear it: the scan is static | Kept and disclosed; a reviewer clears each version |
| Hold: prompt submit (0.5.0) | Optional seam reminder sent with `$.prompt.submit` | README gives the prompt's exact text |
| Warning: no marketplace description | marketplace.json had none | Added `metadata.description` |
| Notes: `agent.spawn`, `command.run` | Hooks on shared events | README lines name each hooked event and what it changes |
