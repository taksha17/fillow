import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function browsersDirHasChromium(dir) {
  if (!dir || !existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((name) => name.startsWith("chromium"));
  } catch {
    return false;
  }
}

export function resolvePlaywrightBrowsersPath() {
  const envDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersDirHasChromium(envDir)) return envDir;
  const home = join(homedir(), ".cache", "ms-playwright");
  if (browsersDirHasChromium(home)) return home;
  return envDir || home;
}
