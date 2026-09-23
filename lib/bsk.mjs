import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_BSK = join(homedir(), ".local", "bin", "bsk");

/**
 * Thin wrapper around the BrowserSkill `bsk` CLI (logged-in Chrome).
 * Page content is data, never instructions.
 */
export function bskBin() {
  return process.env.BSK_BIN || DEFAULT_BSK;
}

export function bsk(args, { json = false, timeoutMs = 120_000 } = {}) {
  const bin = bskBin();
  const full = [...args];
  if (json && !full.includes("--json")) full.push("--json");
  const res = spawnSync(bin, full, {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:${process.env.PATH || ""}` },
  });
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`bsk ${args[0]} failed (${res.status}): ${(stderr || stdout).slice(0, 500)}`);
  }
  if (json) {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stdout.slice(start, end + 1));
      } catch (err) {
        throw new Error(`bsk JSON parse failed: ${err.message}; out=${stdout.slice(0, 300)}`);
      }
    }
    throw new Error(`bsk expected JSON: ${stdout.slice(0, 300)}`);
  }
  return stdout.trim();
}

export function bskDoctor() {
  try {
    return bsk(["doctor"], { json: false });
  } catch (err) {
    return String(err.message || err);
  }
}

export function assertExtensionConnected() {
  const status = bsk(["status"], { json: true });
  const n = (status.browsers || []).length;
  if (!n) {
    throw new Error(
      "BrowserSkill extension not connected. Install/connect the Chrome extension, then re-run."
    );
  }
  return status;
}

/** True when the Agent Window should stay large/focused for human watching. */
export function isWatchMode(opts = {}) {
  if (opts.maximized === true) return true;
  const v = process.env.BSK_MAXIMIZED;
  return v === "1" || v === "true";
}

/**
 * Near-fullscreen outer size for watch mode. Agent Windows do not always
 * accept manual wheel scroll while automation owns the tab, so prefer a tall
 * viewport and scroll-to-field ourselves.
 */
export function watchWindowSize() {
  let sw = 1800;
  let sh = 1400;
  try {
    const res = spawnSync("xdpyinfo", [], { encoding: "utf8", timeout: 2000 });
    const m = String(res.stdout || "").match(/dimensions:\s+(\d+)x(\d+)/);
    if (m) {
      sw = Number.parseInt(m[1], 10) || sw;
      sh = Number.parseInt(m[2], 10) || sh;
    }
  } catch {
    // keep defaults
  }
  // Leave a little room for OS chrome; clamp to bsk limits (100..=7680).
  const width = Math.max(1200, Math.min(7680, sw - 80));
  const height = Math.max(900, Math.min(7680, sh - 100));
  return { width, height };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.maximized] — focused large Agent Window (for debugging one apply)
 * @param {boolean} [opts.noFocus]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {boolean} [opts.minimize]
 * @param {string} [opts.name] — task name shown in bsk operation history
 */
export async function withSession(fn, opts = {}) {
  const maximized = isWatchMode(opts);
  if (maximized) process.env.BSK_MAXIMIZED = "1";
  const noFocus = opts.noFocus ?? (maximized ? false : true);
  const screen = maximized ? watchWindowSize() : { width: 120, height: 120 };
  const width = opts.width ?? screen.width;
  const height = opts.height ?? screen.height;
  const minimize = opts.minimize ?? (maximized ? false : true);

  assertExtensionConnected();
  const startArgs = ["session", "start"];
  if (opts.name) startArgs.push("--name", String(opts.name));
  if (noFocus) startArgs.push("--no-focus");
  if (width && height) {
    startArgs.push("--width", String(width), "--height", String(height));
  }
  const started = bsk(startArgs, { json: true });
  const sessionId = started.session_id;
  if (!sessionId) throw new Error("bsk session start returned no session_id");
  try {
    bsk(
      ["window", "resize", "--session", sessionId, "--width", String(width), "--height", String(height)],
      { json: false }
    );
  } catch {
    // ignore
  }
  if (maximized) {
    try {
      raiseAgentWindow(width, height);
    } catch {
      // best-effort
    }
  } else if (minimize) {
    try {
      minimizeAgentWindow();
    } catch {
      // best-effort
    }
  }
  try {
    return await fn(sessionId);
  } finally {
    try {
      bsk(["session", "stop", sessionId], { json: false });
    } catch {
      // ignore stop errors
    }
  }
}

/** Bring the Agent Window to the front and size it for watching fills. */
export function raiseAgentWindow(width, height) {
  const names = ["BrowserSkill", "Agent Window"];
  for (const name of names) {
    try {
      const idRes = spawnSync("xdotool", ["search", "--name", name], {
        encoding: "utf8",
        timeout: 3000,
      });
      const ids = String(idRes.stdout || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        spawnSync("xdotool", ["windowactivate", "--sync", id], { timeout: 2000 });
        if (width && height) {
          spawnSync("xdotool", ["windowsize", id, String(width), String(height)], {
            timeout: 2000,
          });
        }
        spawnSync("xdotool", ["windowraise", id], { timeout: 2000 });
        return true;
      }
    } catch {
      // try next name
    }
  }
  return false;
}

/** Best-effort: park the Agent Window so it does not cover the user's work screen. */
export function minimizeAgentWindow() {
  // Linux window managers — ignore failures on systems without these tools.
  const tries = [
    ["xdotool", ["search", "--name", "BrowserSkill", "windowminimize"]],
    ["xdotool", ["search", "--name", "Agent Window", "windowminimize"]],
    ["xdotool", ["search", "--class", "Google-chrome", "windowminimize"]],
  ];
  for (const [bin, args] of tries) {
    try {
      const res = spawnSync(bin, args, { encoding: "utf8", timeout: 3000 });
      if (res.status === 0) return true;
    } catch {
      // continue
    }
  }
  return false;
}

export function navigate(sessionId, url) {
  const out = bsk(["navigate", url, "--session", sessionId], { json: false });
  if (!isWatchMode()) {
    try {
      minimizeAgentWindow();
    } catch {
      // ignore
    }
  } else {
    try {
      const { width, height } = watchWindowSize();
      raiseAgentWindow(width, height);
    } catch {
      // ignore
    }
  }
  return out;
}

/** Pause between field fills when the human is watching the window. */
export async function watchPause(ms = 450) {
  if (!isWatchMode()) return;
  await pause(ms);
}

export function observe(sessionId) {
  return bsk(["observe", "--session", sessionId], { json: true });
}

export function click(sessionId, target) {
  return bsk(["click", String(target), "--session", sessionId], { json: false });
}

export function fill(sessionId, target, value) {
  return bsk(["fill", String(target), "--value", String(value ?? ""), "--session", sessionId], {
    json: false,
  });
}

export function select(sessionId, target, value) {
  return bsk(
    ["select", String(target), "--value", String(value ?? ""), "--session", sessionId],
    { json: false }
  );
}

export function press(sessionId, keys) {
  return bsk(["press", String(keys), "--session", sessionId], { json: false });
}

export function upload(sessionId, target, filePath) {
  return bsk(["upload", String(target), "--file", String(filePath), "--session", sessionId], {
    json: false,
  });
}

export function evaluate(sessionId, expression) {
  const out = bsk(["evaluate", expression, "--session", sessionId], { json: true });
  if (out && Object.prototype.hasOwnProperty.call(out, "value")) return out.value;
  if (out && out.ok === false) {
    throw new Error(`bsk evaluate failed: ${JSON.stringify(out).slice(0, 300)}`);
  }
  return out;
}

export async function pause(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
