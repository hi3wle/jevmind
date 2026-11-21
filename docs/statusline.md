# Inline status

Keep using Claude Code or Codex normally. Jodex can show a compact footer in that same terminal, without a second TUI or model call:

```text
JODEX · Decision: Jev (last D1, enforced, 340ms) · Implementor: Codex (Sol)
Mode: review (Jev) · Risk: elevated · Stage: review
Waiting: reviewer/Claude (launch recorded, waiting 18s)
```

This is an example, not a live result. The actual footer uses the displayed project and session. `Decision` distinguishes observed Jev, advisory/enforced, rules with Jev off, fallback, and not yet observed. `Stage` describes the recorded workflow; `requested` and `launched` do not assert that a process is still running. An overdue role is marked with unknown liveness. Codex can additionally show native `Activity`; Claude supplies no equivalent busy signal. Closed outcomes are explicitly **last recorded**, not fresh verification of the current source. Use `jodex status` for current gates and `Next:`.

**Claude Code:** after building the checkout, run:

```sh
jodex setup --statusline
```

This explicit action only installs the footer command in `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json`; it does not install plugins or call providers. It preserves other keys and file permissions, saves a mode-600 backup beside an existing settings file, and refuses malformed or linked settings. It never replaces a configured `statusLine`, including an existing Ponytail footer. Project/managed settings may override the user setting. Reopen Claude Code if needed.

To compose with an existing footer, keep its command and have your own statusline wrapper pass the same input to both commands. For example, save this script and point Claude's `statusLine.command` at it, replacing the existing-script path with your current command:

```sh
#!/bin/sh
payload=$(cat)
printf '%s\n' "$payload" | /absolute/path/to/existing-statusline.sh
printf '\n'
printf '%s\n' "$payload" | /absolute/path/to/node /absolute/path/to/jodex.mjs statusline
```

Use absolute paths: Claude runs the statusline with a minimal `PATH`, so a bare `jodex` or `node` may not be found. `jodex setup --statusline` prints the exact command.

Jodex does not execute or replace that existing command during setup. `jodex uninstall --statusline` removes only an unchanged, Jodex-owned command; it preserves a command you subsequently edit. If you composed a wrapper yourself, remove its Jodex call yourself. Settings backups are retained for manual recovery.

**Codex:** rebuild and refresh the installed Jodex plugin with `jodex setup`, then enable **Custom status line** in `/experimental`, restart the TUI and use `/statusline` → **Choose a status line provider** → **Jodex**. This feature is experimental in the locally checked Codex 0.171.0. The plugin supplies a small local read-only MCP statusline resource; it does not expose workflow mutations or call another agent. Leave existing providers selected until you choose to switch. Restore your previous provider/built-in footer through `/statusline`. If Jodex is absent, check that the installed plugin cache contains the rebuilt manifest and bundle; a cached older plugin must be refreshed through Codex's plugin installation commands.

The Codex transport launches `jodex statusline --mcp` from `PATH`: `jodex setup` links that command before installing the plugin. Start Codex from a terminal where `command -v jodex` and `command -v node` succeed. Codex 0.171.0's legacy plugin loader leaves plugin-root placeholders literal, so this manifest deliberately uses the installed command instead. If an older cached manifest still contains `${PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_ROOT}`, refresh the Jodex plugin and restart Codex; changing the statusline picker alone cannot repair that launcher. Claude's command footer remains configured with absolute paths as described above.

The footer is blank outside an initialized project. Missing session identity is shown as unknown instead of selecting another session's run. It never scans/hashes the source or expires/mutates runs on a refresh. Native visual activation remains a separate check from local renderer/protocol tests; host trust, managed settings and disabled MCP/plugins may prevent it from loading. This footer does not implement display adapters for other agents yet.
