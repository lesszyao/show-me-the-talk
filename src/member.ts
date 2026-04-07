import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Talk } from "./types.js";

export interface MemberResult {
  generatedDir: string;
  log: string;
  timedOut: boolean;
  exitCode: number | null;
}

function buildPrompt(talk: Talk, coreOnly = false): string {
  const descSource = talk.contentDir
    ? `项目描述文件在目录：${talk.contentDir}
请先用 Read 工具读取该目录下的所有 .md 文件，了解完整的项目描述。`
    : `项目描述如下：

${talk.content}`;

  const coreOnlyInstruction = coreOnly
    ? `\nIMPORTANT - Core-Only Mode:
- Only create core source files (src/, lib/ directories)
- Create package.json with correct dependencies
- Create tsconfig.json and build config if described
- Create entry point files (index.ts, main.ts, cli.ts, etc.)
- Implement core module logic and data flow
- SKIP: test files, documentation, static assets, CSS/styles, CI/CD configs, examples
- Focus on getting the directory structure, module exports, and core logic right\n`
    : "";

  return `You are a software developer. Based on the project description, create the complete codebase from scratch.

Create all necessary files with the correct directory structure. Write production-quality code that matches the description.

IMPORTANT:
- Create every file described
- Follow the exact directory structure specified
- Implement all modules, functions, and logic described
- Use the exact technology stack mentioned
- Include package.json with all dependencies mentioned
- Include configuration files (tsconfig.json, etc.) as described
${coreOnlyInstruction}
${descSource}

Now create the complete codebase. Start by creating the directory structure, then implement each file.`;
}

export async function execute(
  talk: Talk,
  cli: string,
  timeout: number,
  logDir: string,
  coreOnly = false,
): Promise<MemberResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smtt-member-"));

  const prompt = buildPrompt(talk, coreOnly);
  const logFile = path.join(logDir, "member.log");

  const args = [
    "-p",
    "--allowedTools", "Read,Edit,Write,Bash,Glob",
    "--dangerously-skip-permissions",
  ];

  // Save prompt to log
  const promptLogFile = path.join(logDir, "member-prompt.md");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(promptLogFile, prompt, "utf-8");

  console.log(`  [member] Running: ${cli} ${args.join(" ")}`);
  console.log(`  [member] CWD: ${tmpDir}`);
  console.log(`  [member] Timeout: ${(timeout / 1000 / 60).toFixed(0)}min`);
  console.log(`  [member] Prompt: ${promptLogFile} (${prompt.length} chars)`);

  return new Promise<MemberResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(cli, args, {
      cwd: tmpDir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Write prompt via stdin to avoid arg length limits
    child.stdin.write(prompt);
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      const log = `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`;

      // Ensure log directory exists
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, log, "utf-8");

      resolve({
        generatedDir: tmpDir,
        log,
        timedOut,
        exitCode: code,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);

      const log = `=== ERROR ===\n${err.message}\n\n=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`;
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, log, "utf-8");

      resolve({
        generatedDir: tmpDir,
        log,
        timedOut: false,
        exitCode: null,
      });
    });
  });
}
