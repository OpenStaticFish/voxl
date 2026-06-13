/**
 * Root dev orchestrator — runs the GAME and the WEBSITE dev servers together.
 *
 *   bun run dev
 *
 * Two processes, prefixed logs, one Ctrl-C to stop both:
 *   • [game]  Vite dev for the voxel game itself (HMR)  → http://localhost:5173
 *   • [site]  Astro dev for the marketing site, which embeds the game via /play
 *             → http://localhost:4321   (click Play to launch the game)
 *
 * If either process exits, the other is killed and this script exits too.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const websiteDir = resolve(root, "website");

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface Job {
  name: string;
  color: (s: string) => string;
  url: string;
  cmd: string;
  args: string[];
  cwd: string;
}

const cyan = (s: string) => `\x1b[36m${s}${RESET}`;
const magenta = (s: string) => `\x1b[35m${s}${RESET}`;

const jobs: Job[] = [
  {
    name: "game",
    color: cyan,
    url: "http://localhost:5173",
    cmd: "bun",
    args: ["run", "game:dev"],
    cwd: root,
  },
  {
    name: "site",
    color: magenta,
    url: "http://localhost:4321",
    cmd: "bun",
    args: ["run", "dev"],
    cwd: websiteDir,
  },
];

console.log(`${BOLD}VOXL dev${RESET} ${DIM}— starting game + website…${RESET}\n`);

const procs: Record<string, { child: import("node:child_process").ChildProcess; job: Job }> = {};
let exiting = false;

function pipe(job: Job, child: import("node:child_process").ChildProcess): void {
  const prefix = job.color(`[${job.name}]`);
  let stdoutBuf = "";
  let stderrBuf = "";

  const onLine = (line: string): void => {
    if (line.length) process.stdout.write(`${prefix} ${line}\n`);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const parts = stdoutBuf.split("\n");
    stdoutBuf = parts.pop() ?? "";
    parts.forEach(onLine);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const parts = stderrBuf.split("\n");
    stderrBuf = parts.pop() ?? "";
    parts.forEach(onLine);
  });
}

function killAll(signal: NodeJS.Signals = "SIGTERM"): void {
  if (exiting) return;
  exiting = true;
  for (const key of Object.keys(procs)) {
    const { child, job } = procs[key];
    if (!child.killed) {
      try {
        process.kill(child.pid ?? 0, signal);
      } catch {
        /* already gone */
      }
      console.log(`${job.color(`[${job.name}]`)} ${DIM}stopped${RESET}`);
    }
  }
}

for (const job of jobs) {
  const child = spawn(job.cmd, job.args, {
    cwd: job.cwd,
    env: { ...process.env, FORCE_COLOR: "1" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  procs[job.name] = { child, job };
  pipe(job, child);

  child.on("exit", (code, signal) => {
    if (exiting) return;
    const detail = signal ? ` (${signal})` : "";
    console.log(
      `${job.color(`[${job.name}]`)} ${DIM}exited${RESET}${code ? ` code ${code}` : ""}${detail}`,
    );
    if (code && code !== 0) {
      console.log(`${BOLD}Stopping all dev servers…${RESET}`);
      killAll();
      process.exit(code);
    }
  });
}

// Give a friendly summary once both have had a moment to boot.
setTimeout(() => {
  console.log("");
  for (const job of jobs) {
    console.log(`  ${job.color(`[${job.name}]`)} ${BOLD}${job.url}${RESET}`);
  }
  console.log(`  ${DIM}Open the site URL and click Play to run the game in-browser.${RESET}`);
  console.log(`  ${DIM}Press Ctrl-C to stop both.${RESET}\n`);
}, 2500);

// Forward Ctrl-C / terminate to both children.
const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`\n${DIM}received ${signal}, shutting down…${RESET}`);
  killAll(signal);
  setTimeout(() => process.exit(0), 300);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
