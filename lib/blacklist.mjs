import { existsSync, readFileSync } from "node:fs";
import { PATHS } from "./paths.mjs";

export function loadBlacklist(path = PATHS.blacklist) {
  if (!existsSync(path)) return [];
  const names = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (!cells[0] || cells[0] === "Company" || cells[0].startsWith("-")) continue;
    names.push(cells[0]);
  }
  return names;
}

export function isBlacklisted(company, names = loadBlacklist()) {
  const needle = String(company || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!needle) return false;
  return names.some((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "") === needle);
}
