# Changelog

All notable changes to this plugin. Versions are tagged `vX.Y.Z`; the tag must match `version` in `orca-plugin.json`.

## 0.6.0 - 2026-11-09

- **Live issue**: the open issue refreshes itself every 10 seconds, only while the panel is visible, without touching a half-written comment. New setting *Refresh the open issue (seconds)*; 0 turns it off.
- The list row now also follows state-colour changes made from the issue view.
- **State colours**: states show as badges in the Orca tone nearest to the colour configured in Hilbana (grey, red, yellow, green, and cyan/blue/purple for the accent tone), in the list, the detail, and the sub-issue, related and mentioned lists. A state with no colour falls back to its category. Orca only has five tones, so the match is approximate.
- Issue detail: a **Sub-issues** section lists the issue's children with their state, and you can jump to any of them (*Back* returns to the parent).

## 0.5.0 - 2026-11-09

- Spanish and English: the panel follows Orca's UI language (`es`, `es-ES`… are Spanish, anything else English) and tells the worker, so its messages and the status bar tooltip match. The choice is remembered across restarts.
- Fixed a leftover Spanish label on the state selector of the issue detail.
- CI on GitHub Actions: typecheck, manifest validation, panel render check and tests, run with a pinned Orca CLI. Tags create a GitHub release from this file.

## 0.4.0 - 2026-11-09

- **Run in agent**: a button on every issue that types the configured prompt (by default the Hilbana plugin command) into the agent of Orca's focused workspace. It stays visible, and says why it is disabled when there is no agent or it is working.
- The Hilbana workspace and project are remembered per Orca workspace, and a name match (`acme-shop.com` → `acme-shop`) is used when nothing was remembered. Branch convention (`drapps-2139-…`) still wins and opens the issue.
- New capabilities: `agent:read`, `terminal:send`.

## 0.3.0 - 2026-11-09

- Follow Orca's workspace: selecting the project of the issue a branch names, and opening that issue.
- New capability: `workspace:read`.

## 0.2.0 - 2026-11-09

- Issue detail: description, comments (newest first, with the comment box above), related and mentioned issues you can jump to, change state, claim and release, comment.
- Search like the Hilbana web app (local id/title matching plus full-text, across every state) and filters for any state or category.

## 0.1.0 - 2026-11-09

- First version: read-only issue panel with workspace, project and state filters, and a status bar counter.
