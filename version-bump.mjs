import { readFileSync, writeFileSync } from "fs";

// Синхронизирует версию из package.json в manifest.json и versions.json.
// Запускается автоматически при `npm version patch|minor|major`.
const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(`Версия выставлена: ${targetVersion} (minAppVersion ${minAppVersion})`);
