import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { format } from "node:util";
import chalk from "chalk";

export const PROGRESS_SCHEMA = "fillow.progress.v1";
const MODES = new Set(["human", "json", "none"]);
const SENSITIVE_KEY = /(?:password|passwd|secret|token|authorization|api[_-]?key)/i;

// fillow palette (matches site/index.html): dark void, gold accents
const THEME = {
  gold: "#c9a24b",
  gold2: "#e2c47c",
  mute: "#8a8172",
  text: "#ece6da",
};
const gold = (text) => chalk.hex(THEME.gold)(text);
const gold2 = (text) => chalk.hex(THEME.gold2)(text);
const mute = (text) => chalk.hex(THEME.mute)(text);

function takeValue(args, index, flag) {
  const inline = args[index].slice(flag.length + 1);
  if (inline) return { value: inline, skip: 0 };
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return { value, skip: 1 };
}

export function parseProgressOptions(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv];
  let mode = String(env.FILLLOW_PROGRESS || "human").toLowerCase();
  let file = env.FILLLOW_PROGRESS_FILE || "";
  let runId = env.FILLLOW_RUN_ID || "";
  let quiet = ["1", "true", "yes"].includes(String(env.FILLLOW_QUIET || "").toLowerCase());
  let result = ["1", "true", "yes"].includes(String(env.FILLLOW_JSON_RESULT || "").toLowerCase());
  let noColor = env.NO_COLOR !== undefined ? env.NO_COLOR !== "false" : !(process.stderr.isTTY || process.stdout.isTTY);
  const passthrough = [];

  if (mode === "jsonl" || mode === "machine") mode = "json";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      mode = "json";
      result = true;
    } else if (arg === "--jsonl" || arg === "--json-progress" || arg === "--progress=jsonl" || arg === "--progress=machine") {
      mode = "json";
      result = false;
    } else if (arg === "--no-progress") {
      mode = "none";
    } else if (arg === "--progress" || arg === "--progress-mode") {
      const { value, skip } = takeValue(args, index, arg);
      mode = value.toLowerCase();
      index += skip;
    } else if (arg.startsWith("--progress=")) {
      const value = arg.slice("--progress=".length).toLowerCase();
      mode = value;
      result = ["human", "json", "none"].includes(value) ? false : result;
    } else if (arg === "--progress-file") {
      const { value, skip } = takeValue(args, index, arg);
      file = value;
      index += skip;
    } else if (arg.startsWith("--progress-file=")) {
      file = arg.slice("--progress-file=".length);
    } else if (arg === "--run-id") {
      const { value, skip } = takeValue(args, index, arg);
      runId = value;
      index += skip;
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    } else if (arg === "--quiet") {
      quiet = true;
    } else if (arg === "--no-color") {
      noColor = true;
    } else {
      passthrough.push(arg);
    }
  }

  if (!MODES.has(mode)) throw new Error(`Unsupported progress mode: ${mode}`);
  return {
    mode,
    file,
    quiet,
    result,
    noColor,
    runId: runId || randomUUID(),
    passthrough,
  };
}

function cleanValue(value, seen = new Set()) {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = cleanValue(item, seen);
  }
  return out;
}

function percent(current, total) {
  if (!Number.isFinite(Number(total)) || Number(total) <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(current) / Number(total)) * 100)));
}

function bar(current, total, width = 24) {
  const p = percent(current, total) / 100;
  const filled = Math.round(p * width);
  return `[${"=".repeat(filled)}${" ".repeat(width - filled)}]`;
}

function humanLine(reporter, record) {
  const { agent, type, phase, data = {} } = record;
  const prefix = `[${agent}]`;
  const label = data.label || phase || type;
  const stream = reporter.stream;
  const writeLine = (text) => {
    if (reporter.progressActive) stream.write("\n");
    reporter.progressActive = false;
    stream.write(`${text}\n`);
  };

  if (type === "run.start") {
    writeLine(`\n${gold2(prefix)} ${label || "starting"}`);
  } else if (type === "run.complete") {
    writeLine(`${chalk.green(prefix)} done${data.summary ? ` — ${data.summary}` : ""}`);
  } else if (type === "run.error") {
    writeLine(`${chalk.red(prefix)} failed — ${data.message || "unknown error"}`);
  } else if (type === "phase.start") {
    writeLine(`\n${gold(prefix)} ${label}`);
  } else if (type === "phase.complete") {
    writeLine(`${gold(prefix)} ${label} complete`);
  } else if (type === "item.update" || type === "progress") {
    const text = `${prefix} ${label} ${bar(data.current, data.total)} ${data.current ?? 0}/${data.total ?? "?"}`;
    if (stream.isTTY && !reporter.noColor) {
      stream.write(`\r${chalk.gray(text)}`);
      reporter.progressActive = true;
    } else {
      writeLine(text);
    }
  } else if (type === "item.start") {
    writeLine(`  ${gold2("start")} ${data.item || label}`);
  } else if (type === "item.done") {
    writeLine(`  ${chalk.green("done")} ${data.item || label}${data.count !== undefined ? ` (${data.count})` : ""}`);
  } else if (type === "item.error") {
    writeLine(`  ${chalk.red("fail")} ${data.item || label} — ${data.message || "error"}`);
  } else if (type === "log" || type === "warn" || type === "error") {
    writeLine(`  ${data.message || ""}`);
  }
}

export function createProgressReporter({
  agent = "fillow",
  mode = "human",
  stream = process.stderr,
  file = "",
  quiet = false,
  result = false,
  noColor = true,
  runId = randomUUID(),
} = {}) {
  if (!MODES.has(mode)) throw new Error(`Unsupported progress mode: ${mode}`);
  if (file) mkdirSync(dirname(file), { recursive: true });

  const reporter = {
    agent,
    mode,
    stream,
    file,
    quiet,
    result,
    noColor,
    runId,
    progressActive: false,
    sequence: 0,
  };

  reporter.emit = (eventOrRecord, data = {}, phase, agentOverride) => {
    const record = typeof eventOrRecord === "string"
      ? { type: eventOrRecord, data, phase }
      : { ...eventOrRecord };
    const aliases = {
      "agent:start": "run.start",
      "agent:complete": "run.complete",
      "agent:error": "run.error",
      "phase:start": "phase.start",
      "phase:complete": "phase.complete",
      "progress": "item.update",
      "item:start": "item.start",
      "item:done": "item.done",
      "item:error": "item.error",
    };
    record.schema = PROGRESS_SCHEMA;
    record.version = 1;
    record.ts = record.ts || record.timestamp || new Date().toISOString();
    record.timestamp = record.timestamp || record.ts;
    record.run_id = record.run_id || runId;
    record.agent = record.agent || agentOverride || agent;
    record.type = aliases[record.type] || record.type || aliases[record.event] || record.event || "log";
    delete record.event;
    record.job_id = record.job_id || record.data?.job_id;
    record.event_id = record.event_id || randomUUID();
    record.sequence = record.sequence ?? ++reporter.sequence;
    record.data = cleanValue(record.data || {});
    const line = `${JSON.stringify(record)}\n`;

    if (file) appendFileSync(file, line);
    if (mode === "json") {
      if (!quiet || ["run.error", "warn", "error"].includes(record.type)) stream.write(line);
    } else if (mode === "human" && !quiet) {
      humanLine(reporter, record);
    }
    return record;
  };

  reporter.emitResult = (payload, ok = true) => {
    if (!result) return;
    const cleanPayload = cleanValue(payload);
    const body = ok
      ? { ...cleanPayload, schema: "fillow.result.v1", ok: true, run_id: runId, agent }
      : { ...cleanPayload, schema: "fillow.result.v1", ok: false, run_id: runId, agent };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  };

  reporter.log = (message, data = {}) => reporter.emit("log", { message, ...data });
  reporter.warn = (message, data = {}) => reporter.emit("warn", { message, ...data });
  reporter.error = (message, data = {}) => reporter.emit("error", { message, ...data });
  reporter.close = () => {};
  return reporter;
}

export function emitterFor(reporter, agent) {
  return (event, data = {}, phase) => reporter.emit(event, data, phase, agent);
}

export function installConsoleReporter(reporter) {
  const originals = {};
  for (const level of ["log", "info", "warn", "error"]) {
    originals[level] = console[level];
    console[level] = (...args) => reporter.emit(level === "warn" ? "warn" : level === "error" ? "error" : "log", {
      level,
      message: format(...args),
    });
  }
  return () => {
    for (const [level, original] of Object.entries(originals)) console[level] = original;
  };
}

export function createDashboard(agent = "fillow") {
  const agents = {
    discover: { status: "idle", startTime: null, endTime: null, jobs: 0, errors: 0, engine: "api" },
    evaluate: { status: "idle", startTime: null, endTime: null, jobs: 0, errors: 0 },
    apply: { status: "idle", startTime: null, endTime: null, jobs: 0, errors: 0, engine: "playwright" },
    track: { status: "idle", startTime: null, endTime: null, jobs: 0, errors: 0 },
  };

  const columns = 1;
  const rows = 6;
  const boxWidth = 60;

  function clearScreen() {
    process.stdout.write('\x1Bc');
  }

  function drawBox(x, y, width, height, title = '') {
    const topLeft = '╔';
    const topRight = '╗';
    const bottomLeft = '╚';
    const bottomRight = '╝';
    const vertical = '║';
    const horizontal = '═';
    const tIntersection = '╦';
    const lIntersection = '╠';
    const rIntersection = '╣';
    const cross = '╬';

    let output = '';

    output += `${gold(topLeft)}${gold(horizontal.repeat(width - 2))}${gold(topRight)}\n`;

    if (title) {
      const padding = Math.floor((width - title.length - 2) / 2);
      const t = chalk.hex(THEME.gold2).bold(title);
      output += `${gold(vertical)}${' '.repeat(padding)}${t}${' '.repeat(padding)}${title.length % 2 === 0 ? '' : ' '}${gold(vertical)}\n`;
    }

    for (let i = 0; i < height - 2; i++) {
      output += `${gold(vertical)}${' '.repeat(width - 2)}${gold(vertical)}\n`;
    }

    output += `${gold(bottomLeft)}${gold(horizontal.repeat(width - 2))}${gold(bottomRight)}\n`;

    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\r${' '.repeat(x)}${lines[i]}\n`);
    }
  }

  function drawAgentBox(agent, data, x, y) {
    const statusColors = {
      idle: mute,
      running: gold2,
      complete: chalk.green,
      error: chalk.red,
    };
    const statusColor = statusColors[data.status] || mute;

    let content = `
${gold2(` Agent: ${agent.padEnd(8)}`)}${statusColor(`Status: ${data.status}`)}
${mute(` Jobs: ${String(data.jobs).padEnd(6)} Errors: ${String(data.errors).padEnd(4)}`)}
${mute(` Started: ${data.startTime ? new Date(data.startTime).toLocaleTimeString() : 'Not started'}`)}
${mute(` Ended: ${data.endTime ? new Date(data.endTime).toLocaleTimeString() : 'Not ended'}`)}
`;
    if (agent === 'discover') {
      const engine = String(data.engine || 'api');
      content += engine === 'bsk'
        ? `${mute(' Engine: ')}${gold2('API + Fillow Browser (bsk)')}\n`
        : `${mute(' Engine: API boards')}\n`;
    }
    if (agent === 'apply') {
      const engine = String(data.engine || 'playwright');
      content += engine === 'bsk'
        ? `${mute(' Engine: ')}${gold2('Fillow Browser (bsk)')}\n`
        : `${mute(' Engine: Playwright')}\n`;
    }

    drawBox(x, y, boxWidth, 7, agent.toUpperCase());

    const lines = content.split('\n');
    const padding = Math.floor((5 - lines.length) / 2);
    let lineIndex = y + 1;

    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\r${' '.repeat(x + 2)}${lines[i]}\n`);
    }
  }

  function updateDashboard() {
    clearScreen();

    process.stdout.write(`\r\n${chalk.hex(THEME.gold).bold('FILLOW')}${mute(' — apply pipeline')}\r\n\r\n`);

    const agentsList = Object.entries(agents);
    for (let i = 0; i < agentsList.length; i++) {
      const [agent, data] = agentsList[i];
      const row = Math.floor(i / columns);
      const col = i % columns;
      const x = col * (boxWidth + 2);
      const y = row * (7 + 1) + 2;
      drawAgentBox(agent, data, x, y);
    }

    process.stdout.write(`\r\n${gold('='.repeat(boxWidth))}\n`);
    process.stdout.write(`Controls: [R] Reset All | [?] Help\n`);
    process.stdout.write(`Time: ${new Date().toLocaleTimeString()}\n`);
  }

  function updateAgent(agent, updates) {
    agents[agent] = { ...agents[agent], ...updates };
    if (updates.status === 'running' && !agents[agent].startTime) {
      agents[agent].startTime = new Date().toISOString();
    }
    if (updates.status === 'complete' || updates.status === 'error') {
      agents[agent].endTime = new Date().toISOString();
    }
    updateDashboard();
  }

  function logAgent(agent, message, data = {}) {
    console.log(`${mute(`[${new Date().toLocaleTimeString()}]`)} ${gold2(agent)} ${message}`);
  }

  return {
    agents,
    updateAgent,
    logAgent,
    clearScreen,
    updateDashboard,
  };
}

export function runAgentCli({ agent, run, summarize }) {
    const reporter = createProgressReporter({ agent });
    // Agents take a callable emit(type, data); the reporter is an object — adapt here.
    const emit = (type, data) => reporter.emit(type, data);
    return run(emit).then((result) => {
        const summary = summarize ? summarize(result) : undefined;
        if (summary) {
            console.log(`  ${chalk.green('[')}${agent}${chalk.green(']')} ${summary}`);
        }
        return result;
    });
}
