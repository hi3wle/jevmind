# Changelog

## 0.1.0 (first release)

Jevmind, formerly Jodex: Jev decides the workflow and risk; Claude Code and Codex do the work.

- Install and update with `npx jevmind@latest setup`. It asks which agents you use (Claude Code, Codex or both) and offers to store a TypeSafe key for Jev.
- `jevmind init` enables a project. A project still on `.jodex/` is migrated to `.jevmind/` in one confirmed step.
- Model routing per step and risk: medium effort by default, high only for the planner. `jevmind models` limits which models and efforts each step may use.
- Approval dialog in Claude Code: critical runs ask Accept, Reject or Review the diff first; Codex keeps `jevmind accept`.
- Cross-provider review when both agents are in use; a same-host reviewer otherwise.
