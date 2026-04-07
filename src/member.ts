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

export interface MemberFixContext {
  /** Previous round's generated code directory */
  previousDir: string;
  /** Path to the diff report from comparator */
  reportPath: string;
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

function buildFixPrompt(talk: Talk, fixCtx: MemberFixContext, coreOnly = false): string {
  const descSource = talk.contentDir
    ? `项目描述文件在目录：${talk.contentDir}
请先用 Read 工具读取该目录下的所有 .md 文件，了解完整的项目描述。`
    : `项目描述如下：

${talk.content}`;

  const coreOnlyInstruction = coreOnly
    ? `\n注意：本次采用 core-only 模式，只关注核心源码和技术栈。不需要创建测试、文档、静态资源等。\n`
    : "";

  return `You are a software developer. You are improving an existing generated codebase based on a diff report.

The current working directory already contains a previously generated codebase. A comparator has analyzed it against the original project and produced a detailed diff report listing specific gaps.

Your task: Read the diff report, understand what's missing or wrong, then FIX the existing code. Do NOT start from scratch — edit and add to the existing files.
${coreOnlyInstruction}
PRIORITY ORDER (fix the highest-scoring gaps first):
1. Fix incorrect package.json dependencies (wrong versions, missing packages, wrong dep/devDep classification)
2. Add missing source files identified in the report
3. Fix incomplete implementations (replace stubs with real logic)
4. Fix data flow issues (missing module connections, incorrect imports)
5. Fix entry point issues (missing CLI args, missing modes)

${descSource}

差异报告文件在：${fixCtx.reportPath}
请用 Read 工具读取这份差异报告，了解上一轮生成代码与原始项目的具体差异。

然后逐一修复报告中指出的问题。使用 Edit 工具修改现有文件，使用 Write 工具创建缺失的文件。
优先修复扣分最多的维度。`;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function execute(
  talk: Talk,
  cli: string,
  timeout: number,
  logDir: string,
  coreOnly = false,
  fixCtx?: MemberFixContext,
): Promise<MemberResult> {
  let tmpDir: string;

  if (fixCtx && fs.existsSync(fixCtx.previousDir)) {
    // Fix mode: copy previous generated code to new tmp dir
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smtt-member-fix-"));
    copyDir(fixCtx.previousDir, tmpDir);
    console.log(`  [member] Fix mode: copied ${fixCtx.previousDir} → ${tmpDir}`);
  } else {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smtt-member-"));
  }

  const prompt = fixCtx && fs.existsSync(fixCtx.previousDir)
    ? buildFixPrompt(talk, fixCtx, coreOnly)
    : buildPrompt(talk, coreOnly);
  const logFile = path.join(logDir, "member.log");

  const args = [
    "-p",
    "--allowedTools", "Read,Edit,Write,Bash,Glob",
    "--dangerously-skip-permissions",
  ];

  // Add dirs so the CLI can read talk files (outside CWD)
  if (talk.contentDir) {
    args.push("--add-dir", path.resolve(talk.contentDir));
  }
  // In fix mode, also add the diff report dir
  if (fixCtx?.reportPath) {
    args.push("--add-dir", path.resolve(path.dirname(fixCtx.reportPath)));
  }

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
