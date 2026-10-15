# Changelog

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
