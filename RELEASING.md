# Releasing Vault Codex

Plugin name: **Vault Codex**. Plugin ID: **`vault-codex`**. License: **MIT**.

This guide follows the Obsidian Community directory workflow documented on 2026-10-14. Preparing these files does not publish a repository or submit a plugin.

## Prepare a version

1. Review `manifest.json`: use a unique name/ID, an `x.y.z` version, the supported minimum app version, a concise description ending in a period, and `isDesktopOnly: true`.
2. Keep the package and lockfile names/versions consistent. For a later patch release, run `npm version patch --no-git-tag-version`; the version hook also updates `manifest.json` and adds the corresponding entry to `versions.json`. Do not overwrite older compatibility entries.
3. Update `CHANGELOG.md` and add `releases/<version>.md` describing the final changes. Update README requirements and data disclosures whenever behavior changes.
4. Use a supported Node.js LTS and install dependencies with `npm ci`.
5. Run `npm run check`, then `npm run package`. A system `zip` command is required. Packaging also validates metadata and assembles only explicitly allowed files.
6. Before announcing a new version, test installation, connection, a conversation, note references, approvals, stop/reconnect, export, and any changed microphone behavior in a separate desktop test vault. Unit tests do not replace this application check. Only claim the operating systems and versions actually verified.

The current release is **0.1.13** and requires **Obsidian desktop 1.13.7**. It builds against the 1.13.1 public API definitions; the README records the native macOS verification performed on 1.13.7.

## Generated files

```text
artifacts/
  release/vault-codex/                 # Clean manual installation folder
  releases/0.1.13/
    main.js                           # Required GitHub release attachment
    manifest.json                     # Required GitHub release attachment
    styles.css                        # Required for this plugin's styles
    vault-codex-0.1.13.zip             # Manual installation, includes LICENSE/READMEs
    vault-codex-0.1.13-source.zip      # Public source with build configuration
    RELEASE_NOTES.md                   # Release description
    SHA256SUMS.txt                     # Checksums of the three attachments and ZIPs
```

ZIPs and `SHA256SUMS.txt` remain local packaging/verification outputs; they are not attached to releases from 0.1.13 onward. The source archive includes source, tests, build/release scripts, `.github` workflows, documentation, and dependency metadata. It excludes `node_modules`, build output, artifacts, private plugin data, environment files, local vaults, and backups. The installation folder is recreated before packaging so stale files cannot carry over.

## Publish the GitHub repository

Create a **public GitHub repository** and upload the source archive contents, or initialize Git in this working directory and commit the source files. Keep the root `README.md`, `LICENSE`, `manifest.json`, `versions.json`, and build configuration visible. The checked-in `.gitignore` excludes generated and private files. Inspect the files to be committed before pushing.

Commit the release manifest and notes to the repository's **default branch** before submitting to Obsidian. The Community directory reads `manifest.json` from that branch, not from the installation ZIP.

## Create a GitHub release

Choose either method. The tag must exactly match `manifest.json`: **`0.1.13`**, not `v0.1.13`.

### Automatic draft

The included `.github/workflows/release.yml` builds, tests, validates the tag, and creates a **draft** GitHub release when a tag is pushed. After the default-branch commit is on GitHub:

```sh
git tag 0.1.13
git push origin 0.1.13
```

The workflow attaches only `main.js`, `manifest.json`, and `styles.css`, and uses `releases/0.1.13.md` for the description. Open the draft, inspect its attachments and description, and publish it. A draft is not downloadable by the Obsidian installer.

### Manual release

On GitHub, open **Releases → Draft a new release**, choose tag **0.1.13**, and use `releases/0.1.13.md` as the description. Upload only `main.js`, `manifest.json`, and `styles.css` from `artifacts/releases/0.1.13/`, using `RELEASE_NOTES.md` as the description. Do not attach the locally generated ZIPs or `SHA256SUMS.txt`: the directory flags these as unsupported extras. GitHub automatically provides source archives for the tag.

Attach `main.js`, `manifest.json`, and `styles.css` **individually** under those exact filenames. A ZIP-only release cannot be installed by Obsidian. Publish a normal release, not a draft or prerelease.

## Submit to the Obsidian Community directory

1. Visit [community.obsidian.md](https://community.obsidian.md) and sign in with your Obsidian account.
2. Connect the GitHub account that owns the repository.
3. Open **Plugins → New plugin**, enter the repository URL, and choose the owner.
4. Review the developer policies and maintenance commitment, then submit.
5. Address the automated review feedback. If a code/release change is needed, increment the version and create a matching new GitHub release. Select **Publish** when ready; unresolved automated-review errors prevent installation in Obsidian.

No `community-plugins.json` pull request is part of the current documented submission flow. Check name and ID availability in the directory during submission; local validation cannot reserve them.

## Release-specific disclosures

The README covers accounts/possible service fees, remote model and tool traffic, local process execution and files outside the vault, conversation persistence, full-access permissions, and microphone uploads. Optional dictation uses a non-public ChatGPT transcription endpoint; disclose its current limitation during review instead of describing it as a supported public third-party API.

The old development ID, `codex-for-obsidian`, stores data in a different folder. To migrate, disable the old plugin and close Obsidian, back up its plugin folder privately, install `vault-codex`, and copy only the old `data.json` into the new plugin folder before reopening Obsidian. Back up any existing new `data.json` before replacing it; this does not merge conversation histories. Enable only Vault Codex, reopen its panel, and confirm your conversations and settings are present before removing the old installation. Do not publish or bundle either `data.json` or the backup.

## Official references

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest and naming rules](https://docs.obsidian.md/Reference/Manifest)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Set up your community profile and submit](https://docs.obsidian.md/community-directory/set-up-and-claim)

The release workflow attests `main.js`, `manifest.json`, and `styles.css` using GitHub Actions. Before publishing the draft, verify the downloaded assets with `gh attestation verify <asset> --repo HoHoLab/vault-codex` as well as the checksums.

## Remaining behavior review findings

The 0.1.12 review reported Direct Filesystem Access and Shell Execution warnings, plus Vault Enumeration and Clipboard Access recommendations. These describe retained functionality, not failing build or style checks:

- `src/rpc.ts` checks executable permissions and lists the NVM installation directory to discover Codex. It launches the configured executable using `spawn` with separate arguments and `shell: false`; the scanner still classifies use of `child_process` as Shell Execution.
- `src/view.ts` enumerates eligible vault files for the note/image picker and writes the selected response to the clipboard after the user clicks Copy. It does not read clipboard contents.

Do not claim an all-Pass review while these findings remain. Hiding these calls through indirection or scanner-excluded files would not remove the underlying behavior. Removing them would change executable discovery, local Codex connection, file selection, or Copy reply. Record the actual review after each release.
