import manifest from '../manifest.json';

// Bundle the release metadata so the interface and protocol cannot drift.
export const PLUGIN_NAME = manifest.name;
export const PLUGIN_VERSION = manifest.version;
export const CLIENT_INFO = {name: 'vault_codex', title: PLUGIN_NAME, version: PLUGIN_VERSION};
