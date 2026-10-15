# Vault Codex

Chat with local Codex from an Obsidian sidebar. Reference notes and images, review agent actions, and keep conversations alongside your vault.

[简体中文](README.zh-CN.md) · [Changelog](CHANGELOG.md) · [Release guide](RELEASING.md)

Vault Codex is an independent third-party plugin, maintained by hoho and licensed under the MIT license. It is not affiliated with or endorsed by Obsidian or OpenAI. The interface can follow Obsidian's language or use a language selected in the plugin settings.

## Requirements

- **Obsidian 1.13.7 or newer, desktop only.** Mobile is not supported because the plugin starts a local process and uses Node.js APIs.
- A separately installed **Codex executable** supporting `codex app-server --listen stdio://`. The plugin does not install or update Codex.
- A working account and provider configuration in Codex. The plugin is free; a ChatGPT subscription, API credits, or another provider's fees may be required for the services you choose. Service quotas and model availability depend on that account. Fast mode can increase usage charges.
- Network access for remote models, sign-in, and optional dictation. Model and tool traffic follows your local Codex configuration.

This release supports Obsidian desktop **1.13.7+** and builds against the **1.13.1** public API definitions to avoid newer API dependencies. Native macOS verification on **1.13.7** covers loading the plugin, rendering settings, switching languages, connecting to local Codex, and preserving existing conversations and settings during migration. Windows and Linux have not been verified on real machines. On Windows, select a native `codex.exe`; `.cmd` launchers are not supported.

## Install

### Community directory

After this plugin has been published in the Obsidian Community directory, open **Settings → Community plugins → Browse**, search for **Vault Codex**, install it, and enable it. Until then, use a manual installation.

### Manual installation

1. Download the `vault-codex-<version>.zip` installation asset from a GitHub release of this repository. The `-source.zip` asset contains development source, not an installable build.
2. Close Obsidian and extract the `vault-codex` folder into your vault's plugin directory. By default, this is `.obsidian/plugins/`; use your configured directory if you changed Obsidian's configuration folder.
3. Check the resulting structure:

   ```text
   <vault>/.obsidian/plugins/vault-codex/
     main.js
     manifest.json
     styles.css
     LICENSE
     README.md
     README.zh-CN.md
     CHANGELOG.md
     RELEASING.md
   ```

4. Open Obsidian and enable **Vault Codex** in **Settings → Community plugins**.
5. Click the robot ribbon icon, or run **Vault Codex: Open chat panel** in the command palette.
6. Click **Connect Codex**. If your local Codex is already signed in, the plugin reuses that configuration. Otherwise, open the plugin settings and click **Sign in in browser** under **Sign in to ChatGPT**.

These labels follow your selected interface language. On macOS, executable discovery checks `PATH`, common Homebrew/user installation paths, NVM, and installed Codex/ChatGPT application paths. If discovery fails, set **Codex executable** to the executable's full path and reconnect. Enter a file path, not a shell command.

## Use

- **Chat:** by default, press Enter to send; Shift+Enter adds a line. You can change the send shortcut in settings. Use the stop button to interrupt generation.
- **Reference content:** use `+` to attach the current note, another vault note, or an image. You can also select text in a note and run **Send selection to Codex**. Text notes over 250 KB must be referenced by selection or read by Codex through a file path; image input requires a supporting model.
- **Choose a model:** click the model/effort control to choose among models returned by Codex. Adjust the reasoning slider or enable Fast if the model offers it. The account still determines whether a listed model can be called.
- **Review operations:** command execution, file changes, MCP calls, and search activity appear during generation. Approval and question cards collect responses when Codex needs them.
- **Keep conversations:** create, reopen, and export conversations using the controls above the composer and the more menu. The history contains conversations created through this plugin; it does not import all chats from the desktop app.
- **Inspect context:** hover or focus the context ring to see reported token occupancy. Missing data is shown as unavailable. The ring is not a remaining subscription quota indicator.
- **Read progress:** after a turn finishes, the elapsed-time control can reveal its recorded process. The final response is rendered as Markdown and has a copy button.
- **Dictate:** click the microphone, grant microphone access if requested, and finish the recording to transcribe it into the draft. The text is sent as a chat message only when you send the draft.

## Preferences

The settings page groups general preferences, assistant behavior, connection/account controls, and advanced settings. Choose the interface language, Enter or Ctrl/Command+Enter to send, right/left sidebar or main-tab placement, and automatic scrolling. Shift+Enter always adds a line. Scrolling up pauses automatic following while you read.

Interface languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, German, French, Spanish, Russian, and Portuguese. The default follows Obsidian; unsupported languages and missing translations fall back to English. Switching languages keeps your draft, attachments, and conversation history. Moving the panel also preserves drafts for inactive conversations; finish dictation before moving it.

Custom assistant instructions and response verbosity apply to subsequent requests in this vault. They are stored with your settings and passed to Codex, so they may be included in model requests. Changing the interface language does not translate existing conversations or force the model's reply language.

Response detail offers **Default**, **Concise**, **Balanced**, and **Detailed**. Default inherits local Codex configuration; other levels require model support. When these assistant preferences change, the plugin reconnects before the next send and resumes the same conversation, so changing or clearing a preference also takes effect in existing chats.

## Permissions and file access

The vault is the Codex working directory. Permission choices are passed to the installed Codex app server; enforcement depends on that Codex version and your account/organization policies.

| Mode | Behavior |
| --- | --- |
| Ask for approval — default | Uses Codex's workspace-write sandbox, with the vault as a writable root and sandboxed command network access disabled. Operations needing additional permissions are presented for approval. Codex can also use its permitted temporary directories. |
| Approve for me | Uses the same sandbox and asks a supported Codex automatic reviewer to evaluate requests for additional permissions. This does not automatically approve every operation. |
| Full access | Uses full filesystem access with operation approvals disabled. Codex can execute commands, use the network, and access files outside the vault under your operating system account. |

Legacy read-only settings are preserved until you choose another mode. Permission and model choices cannot change during a running turn. Unsupported server interactions are rejected; the plugin does not silently switch to full access to make a connection work.

**Access outside the vault:** the plugin searches installation paths outside the vault to locate the executable. The Codex process uses its own account configuration, session storage, and temporary files outside the vault. Codex's sandbox is not a blanket restriction on reading outside the vault, and full access or separately granted permissions allow broader file operations. Configured MCP tools may have their own access. File edits made by Codex go through the filesystem and are not part of Obsidian's editor undo history.

## Privacy, accounts, and network use

Vault Codex has no plugin-operated backend and adds no client-side analytics or advertising. Its source is available in this repository. The following data flows are part of its functionality:

| Data or operation | Where it goes and why |
| --- | --- |
| Prompts, selected text, attached notes/images, and requested file content | Passed to the local Codex app server. Codex forwards content as needed to the model provider configured on your machine, such as OpenAI, and to tools used for the task. Sending a local note to a remote model is not offline processing. |
| Sign-in | A URL returned by Codex opens in your browser to complete account authentication. Credentials and provider configuration remain managed by Codex. |
| MCP/search/other tools | Use the services and permissions from your Codex configuration. Their endpoints and data handling depend on the tools you enabled; the plugin does not maintain a fixed allowlist for those services. |
| Dictation audio | Sent directly from Obsidian to `https://chatgpt.com/backend-api/transcribe` after you finish recording, using the local Codex ChatGPT authorization. |
| Conversations, custom assistant instructions, interface preferences, model choices, permissions, executable path, and session references | Stored in `<vault>/<config-dir>/plugins/vault-codex/data.json`. Codex also maintains its own local state outside the vault. Vault sync or backup software may copy that plugin data. |

The plugin does not persist API keys, authorization tokens, or audio recordings. For dictation, it obtains authorization in memory through the local app server's `getAuthStatus`, sends it only to the fixed ChatGPT transcription endpoint, and avoids including it in plugin errors or logs. Keep exported conversations and plugin data private as appropriate. Removing the plugin does not remove Codex's own local state or data already sent to a provider.

For OpenAI services, see the [OpenAI privacy policy](https://openai.com/policies/privacy-policy/). For a custom provider or MCP service, consult that service's policies and your local Codex configuration.

## Optional microphone dictation

Dictation requires a local Codex **ChatGPT sign-in** and microphone permission from Obsidian/the operating system. API-key sign-in cannot reuse this ChatGPT service. Recording starts only when you select the microphone; audio is kept in memory, with a limit of two minutes and 25 MB per recording.

Finish the recording to upload and transcribe it, or cancel to discard it. Closing the sidebar or switching conversations releases the microphone and cancels waiting for a result. Audio already uploaded cannot be recalled by cancellation. Successful text is appended to your draft for review before sending.

This integration uses a **non-public ChatGPT transcription endpoint**, not a stable public third-party transcription API. Availability can change with your account, organization policy, or Codex/service version. A successful local test does not establish that every ChatGPT OAuth token supports transcription. The plugin refreshes authorization once after HTTP 401; other failures are shown without switching to a separate paid service. You can use your operating system's dictation instead.

## Limitations and support

- Desktop only; Windows/Linux real-machine compatibility is unverified.
- Codex protocol versions can differ. Model/effort options and automatic review require server support.
- This sidebar does not expose every Codex desktop feature, scheduled task, cloud task, plugin manager, or real-time voice interaction.
- The plugin manages its own conversation list. It does not synchronize all conversations with the Codex desktop app.

Report reproducible problems through this repository's **Issues** page. Include the plugin, Obsidian, operating system, and Codex versions, plus the steps to reproduce. Remove private note content, account identifiers, and credentials from reports.

## Development

Use a supported Node.js LTS release (Node.js 24 is used in CI), npm, and a system `zip` executable for packaging.

```sh
npm ci
npm run check
npm run package
```

- `npm run dev`: rebuild when source changes.
- `npm run check`: type-check, build, run automated tests, and validate release metadata and required files.
- `npm run package`: build clean installation/source ZIPs, individual GitHub release attachments, release notes, and SHA-256 checksums under `artifacts/releases/<version>/`.
- `npm run smoke`: optional integration check using your real local Codex and an isolated vault under `artifacts/smoke-vault/`. It uses account model quota and is not run by the packaging workflow.

See [RELEASING.md](RELEASING.md) for the release process. Generated assets, dependencies, test vaults, and private data are excluded from the public source archive.

## License and attribution

[MIT](LICENSE), copyright 2026 hoho. Obsidian and Codex/OpenAI names identify the applications and services this independent plugin works with.

Runtime imports use Obsidian's provided API and Node.js built-ins. Obsidian's API package and the build/test tools retain their respective licenses; they are development dependencies and are not bundled into the distributed plugin.
