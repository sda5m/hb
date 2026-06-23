import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const textExtensions = new Set([
  ".js", ".mjs", ".cjs", ".html", ".css", ".json", ".md", ".txt", ".yml", ".yaml"
]);
const ignoredDirectories = new Set(["node_modules", ".git"]);
const ignoredFiles = new Set(["rebrand-hb.mjs"]);
const changed = [];

function rebrand(input) {
  return input
    .replace(/https:\/\/apps\.apple\.com\/app\/[^"'\s]+\/id6755466322/g, "https://halabt.com")
    .replace(/https:\/\/cdn\.shopify\.com\/s\/files\/1\/0619\/3915\/5027\/files\/Beauty_Time-icon_2(?:_1)?\.png(?:\?[^"'\s]*)?/g, "https://halabt.com/favicon.ico")
    .replace(/https:\/\/apps\.apple\.com\/app\/id6755466322/g, "https://halabt.com")
    .replace(/https:\/\/app\.beauttime\.com/gi, "https://app.halabt.com")
    .replace(/https:\/\/app\.btime\.om/gi, "https://app.halabt.com")
    .replace(/https:\/\/account\.beauttime\.com/gi, "https://account.halabt.com")
    .replace(/https:\/\/www\.btime\.om/gi, "https://halabt.com")
    .replace(/https:\/\/btime\.om/gi, "https://halabt.com")
    .replace(/www\.btime\.om/gi, "halabt.com")
    .replace(/\bbtime\.om\b/gi, "halabt.com")
    .replace(/app\.beauttime\.com/gi, "app.halabt.com")
    .replace(/بيوتي\s*تايم/g, "هلا بيوتي")
    .replace(/\bBeauty[ \t]+Time\b/g, "Hala Beauty")
    .replace(/\bBeautyTime\b/g, "Hala Beauty")
    .replace(/\bBeautytime\b/g, "Hala Beauty")
    .replace(/\bBtime\b/g, "Hala Beauty")
    .replace(/halabeauty-/g, "halabeauty-")
    .replace(/Your beauty time has started!/g, "Your Hala Beauty order is ready!")
    .replace(/registerBeautytimeSW/g, "registerHalaBeautySW")
    .replace(/beautytime credit/g, "hala beauty credit")
    .replace(/beauty time credit/g, "hala beauty credit")
    .replace(/beautytime\|beauty time/g, "hala beauty|halabeauty")
    .replace(/"beauty_time\.wav"/g, '"default"')
    .replace(/"beauty_time"/g, '"default"');
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(extname(entry.name).toLowerCase())) continue;

    const before = await readFile(fullPath, "utf8");
    const after = rebrand(before);
    if (after !== before) {
      await writeFile(fullPath, after, "utf8");
      changed.push(relative(root, fullPath));
    }
  }
}

await walk(root);
console.log(`Rebranded ${changed.length} files for Hala Beauty.`);
