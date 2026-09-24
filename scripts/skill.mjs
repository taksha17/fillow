#!/usr/bin/env node
/**
 * fillow skill — install fillow's harness skills into any AI CLI's skill directory.
 *
 *   fillow skill list
 *   fillow skill install fillow-discover               # → ~/.qwen/skills (default)
 *   fillow skill install fillow-discover --target cursor
 *   fillow skill install all --target claude           # every vendored skill
 *
 * Targets are harness homes, not fillow's: qwen, cursor, claude, kilo.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../lib/paths.mjs";

const SKILLS_DIR = join(ROOT, "skills");

export const HARNESS_TARGETS = {
  qwen: () => join(homedir(), ".qwen", "skills"),
  cursor: () => join(homedir(), ".cursor", "skills"),
  claude: () => join(homedir(), ".claude", "skills"),
  kilo: () => join(homedir(), ".kilo", "skills"),
};

export function availableSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, "SKILL.md")))
    .map((d) => d.name);
}

export function resolveTarget(name) {
  const factory = HARNESS_TARGETS[name];
  if (!factory) throw new Error(`unknown harness target: ${name} (known: ${Object.keys(HARNESS_TARGETS).join(", ")})`);
  return factory();
}

export function installSkill(name, target) {
  const source = join(SKILLS_DIR, name);
  if (!existsSync(join(source, "SKILL.md"))) throw new Error(`no such skill: ${name} (have: ${availableSkills().join(", ")})`);
  const destRoot = resolveTarget(target);
  const dest = join(destRoot, name);
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  return dest;
}

function usage() {
  process.stderr.write(`fillow skill — install fillow skills into any AI CLI harness

  fillow skill list
  fillow skill install <name|all> [--target qwen|cursor|claude|kilo]

Skills are vendored in skills/ of the fillow repo. Default target: qwen.
`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--target") args.target = rest[++i];
    else args.name = rest[i];
  }
  const target = args.target || "qwen";

  if (cmd === "list") {
    const skills = availableSkills();
    if (!skills.length) return process.stdout.write("(no vendored skills)\n");
    for (const s of skills) process.stdout.write(`${s}  →  ${resolveTarget(target)}/${s}\n`);
    return;
  }

  if (cmd === "install") {
    const names = args.name === "all" ? availableSkills() : [args.name];
    if (!names[0]) {
      usage();
      process.exit(1);
    }
    for (const name of names) {
      const dest = installSkill(name, target);
      process.stdout.write(`installed ${name} → ${dest}\n`);
    }
    return;
  }

  usage();
  process.exit(cmd ? 1 : 0);
}

const isCli = process.argv[1]?.endsWith("skill.mjs");
if (isCli) main();
