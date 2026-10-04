import fs from "node:fs/promises";
import path from "node:path";

const [repo, pluginId, vault] = process.argv.slice(2);
if (!repo || !pluginId || !vault) throw new Error("usage: node bench/install-obsidian-plugin-release.mjs owner/repo plugin-id vault-path");

const headers = { "User-Agent": "mdse-workbench-step53" };
const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
if (!releaseRes.ok) throw new Error(`latest release lookup failed for ${repo}: ${releaseRes.status}`);
const release = await releaseRes.json();

const dir = path.join(vault, ".obsidian", "plugins", pluginId);
await fs.mkdir(dir, { recursive: true });

for (const name of ["main.js", "manifest.json", "styles.css"]) {
  const asset = release.assets?.find((a) => a.name === name);
  if (!asset) {
    if (name === "styles.css") continue;
    throw new Error(`${repo} release ${release.tag_name} has no ${name} asset`);
  }
  const res = await fetch(asset.browser_download_url, { headers });
  if (!res.ok) throw new Error(`download failed for ${repo}/${name}: ${res.status}`);
  await fs.writeFile(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
}

const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
if (manifest.id !== pluginId) throw new Error(`plugin id mismatch: expected ${pluginId}, got ${manifest.id}`);
console.log(JSON.stringify({
  repo,
  tag: release.tag_name,
  id: manifest.id,
  version: manifest.version,
  minAppVersion: manifest.minAppVersion ?? null,
}, null, 2));
