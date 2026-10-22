# Changelog

## 0.1.14 — 2026-10-22

- Select reasoning effort by clicking its dot, with a smooth transition between levels. Clicking empty track space or dragging no longer changes the selection; keyboard controls and reset remain available.
- Animate particles at every reasoning level when Fast is enabled, and blend blue-purple light with particles for Ultra even when Fast is off.
- Smooth the selector opening, label updates, and effect transitions without recreating the popup when toggling Fast.
- Remove the outer blue focus outline from the effort track and reveal selectable dots on hover or focus.
- Respect reduced motion, pause rendering in hidden documents, and dispose animation frames and listeners when the selector closes.
- Add regression coverage for dot clicks, ignored drags, cancellation, scaled hit targets, keyboard transitions, particle states, and cleanup.

## 0.1.13 — 2026-10-15

- Attach only `main.js`, `manifest.json`, and `styles.css` to GitHub releases to address the community review's unsupported-extra-files recommendation; retain ZIPs and checksums as local packaging outputs.
- Update English and Chinese manual installation instructions for the three-file release and clarify that website publication alone does not verify in-app search availability.
- Document the remaining behavior findings and their connection to existing features. Plugin runtime source and styles are unchanged.

## 0.1.12 — 2026-10-15

- Type the consumed Codex protocol fields, account responses, saved-data boundary, and transcription claims; handle invalid JSON message envelopes without leaving requests pending.
- Bind view and microphone timers to their owning window; use explicit Node timers for process-level requests, persistence, and serialized rendering.
- Preserve approval decisions, secret question inputs, Markdown replacement, accessible labels, and cancellation behavior with additional regression coverage.
- Include the actual vault configuration directory in assistant instructions instead of assuming the default folder.
- Replace static CSS overrides, relational selectors, and clipping with scoped styles while preserving hidden controls, focus indication, and reduced motion.
- Add GitHub build provenance attestations for the three plugin assets and link the published community listing in both READMEs.

## 0.1.11 — 2026-10-15

- Move the chat input's automatic height and the permission menu's fixed alignment into CSS classes to resolve the community scanner's blocking style rule while preserving dynamic sizing and positioning.

## 0.1.10 — 2026-10-14

- Add ten interface languages, automatic Obsidian-language selection, and English fallback for missing translations.
- Add grouped, searchable native settings for language, send shortcut, panel placement, auto-scroll, custom assistant preferences, and response detail.
- Refresh connection status immediately when reopening cached native settings on Obsidian 1.13.7.
- Preserve drafts, attachments, and history when changing language or moving the panel; pause automatic scrolling when reading above the bottom.
- Apply assistant instructions and native response verbosity to both new and resumed chats, including changing or clearing preferences.
- Add translation, migration, shortcut, backend configuration, and isolated DOM interaction regression coverage.
- Rename the plugin to **Vault Codex**, with the community plugin ID `vault-codex`.
- Use the manifest as the source for the connection client name and version displayed to Codex.
- Support Obsidian desktop **1.13.7+**, build against the 1.13.1 public API definitions, and verify settings and data migration on macOS with 1.13.7.
- Add the MIT license, English and Simplified Chinese documentation, and explicit account, payment, network, microphone, storage, and external-file disclosures.
- Document manual migration from the development ID `codex-for-obsidian` so existing conversation data can be preserved.
- Add release metadata validation, version mapping, clean installation/source archives, SHA-256 checksums, and GitHub Actions for checks and draft releases.

Earlier versions were local development builds under a different plugin ID; they are not included in the new ID's compatibility map.
