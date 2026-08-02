import { resolve } from "node:path";
import type { LinkResult, PluginManifest } from "./types.js";
import { atomicWrite, readJson, stableJson } from "./utils.js";

const APP_ID = /^plugin_asdk_app[A-Za-z0-9_-]+$/;

export async function linkRegisteredApp(rootInput: string, appId: string): Promise<LinkResult> {
  if (!APP_ID.test(appId)) {
    throw new Error("App ID must be a real ChatGPT Apps SDK identifier beginning with plugin_asdk_app.");
  }
  const root = resolve(rootInput);
  const pluginManifestPath = resolve(root, ".codex-plugin", "plugin.json");
  const appManifestPath = resolve(root, ".app.json");
  const manifest = await readJson<PluginManifest>(pluginManifestPath);
  await atomicWrite(appManifestPath, stableJson({
    apps: {
      [manifest.name]: { id: appId, category: manifest.interface.category },
    },
  }));
  manifest.apps = "./.app.json";
  await atomicWrite(pluginManifestPath, stableJson(manifest));
  return { appManifestPath, pluginManifestPath, appId };
}
