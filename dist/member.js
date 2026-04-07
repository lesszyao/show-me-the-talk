import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
// --- Shared utilities ---
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    let entries;
    try {
        entries = fs.readdirSync(src, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git")
            continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        }
        else {
            try {
                fs.copyFileSync(srcPath, destPath);
            }
            catch {
                // Skip uncopyable files
            }
        }
    }
}
/** Copy specific files from src to dest, preserving directory structure */
function copyFiles(src, dest, files) {
    for (const file of files) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        if (fs.existsSync(srcPath)) {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            if (fs.statSync(srcPath).isDirectory()) {
                copyDir(srcPath, destPath);
            }
            else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}
function spawnCli(cli, prompt, cwd, timeout, logDir, logLabel, addDirs) {
    const args = [
        "-p",
        "--allowedTools", "Read,Edit,Write,Bash,Glob",
        "--dangerously-skip-permissions",
    ];
    if (addDirs) {
        for (const dir of addDirs) {
            args.push("--add-dir", path.resolve(dir));
        }
    }
    // Save prompt
    fs.mkdirSync(logDir, { recursive: true });
    const promptFile = path.join(logDir, `${logLabel}-prompt.md`);
    fs.writeFileSync(promptFile, prompt, "utf-8");
    console.log(`  [${logLabel}] Running: ${cli} ${args.join(" ")}`);
    console.log(`  [${logLabel}] CWD: ${cwd}`);
    console.log(`  [${logLabel}] Timeout: ${(timeout / 1000 / 60).toFixed(0)}min`);
    console.log(`  [${logLabel}] Prompt: ${promptFile} (${prompt.length} chars)`);
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const child = spawn(cli, args, {
            cwd,
            env: { ...process.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdin.write(prompt);
        child.stdin.end();
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => {
                if (!child.killed)
                    child.kill("SIGKILL");
            }, 5000);
        }, timeout);
        child.stdout.on("data", (data) => { stdout += data.toString(); });
        child.stderr.on("data", (data) => { stderr += data.toString(); });
        child.on("close", (code) => {
            clearTimeout(timer);
            const log = `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`;
            const logFile = path.join(logDir, `${logLabel}-output.log`);
            fs.writeFileSync(logFile, log, "utf-8");
            console.log(`  [${logLabel}] Done: exit=${code}, timedOut=${timedOut}`);
            resolve({ generatedDir: cwd, log, timedOut, exitCode: code });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            const log = `=== ERROR ===\n${err.message}\n\n=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`;
            const logFile = path.join(logDir, `${logLabel}-output.log`);
            fs.writeFileSync(logFile, log, "utf-8");
            resolve({ generatedDir: cwd, log, timedOut: false, exitCode: null });
        });
    });
}
// --- Phase 1: Skeleton generation ---
function buildSkeletonPrompt(talk, coreOnly) {
    const descSource = talk.contentDir
        ? `项目描述文件在目录：${talk.contentDir}\n请先用 Read 工具读取该目录下的所有 .md 文件，了解完整的项目描述。`
        : `项目描述如下：\n\n${talk.content}`;
    const coreOnlyNote = coreOnly
        ? `\n注意：Core-Only 模式 — 只创建核心源码文件，跳过测试、文档、静态资源等。\n`
        : "";
    return `You are a software architect. Based on the project description, create the complete project SKELETON — file structure, type definitions, interfaces, and function signatures only.

IMPORTANT RULES:
- Create ALL files described in the project description
- Write complete type/interface definitions
- Write function signatures with parameter types and return types
- Function bodies should be minimal stubs: \`throw new Error("TODO")\` or empty \`{}\`
- Include package.json with correct dependencies
- Include config files (tsconfig.json, etc.)
- Follow the exact directory structure from the description
${coreOnlyNote}
${descSource}

ADDITIONALLY, after creating all skeleton files, write a file called \`groups.json\` in the current working directory.
This file should partition the source files into 3-5 implementation groups that can be developed independently.

Format:
\`\`\`json
[
  { "name": "core", "files": ["src/core/engine.ts", "src/core/parser.ts"], "desc": "Core engine and parser logic" },
  { "name": "api", "files": ["src/api/handler.ts", "src/api/routes.ts"], "desc": "API routes and handlers" },
  ...
]
\`\`\`

Grouping criteria:
- Files in the same group should be tightly coupled (import each other frequently)
- Files in different groups should be loosely coupled
- Each group should have 5-25 files
- Config files (package.json, tsconfig.json) do NOT need to be in any group

Now create the skeleton. Start with the directory structure, then types/interfaces, then function stubs, then groups.json.`;
}
export async function executeSkeleton(talk, cli, timeout, skeletonDir, logDir, coreOnly) {
    fs.mkdirSync(skeletonDir, { recursive: true });
    const prompt = buildSkeletonPrompt(talk, coreOnly);
    const addDirs = [];
    if (talk.contentDir)
        addDirs.push(talk.contentDir);
    const result = await spawnCli(cli, prompt, skeletonDir, timeout, logDir, "skeleton", addDirs);
    if (result.timedOut) {
        console.log(`  [skeleton] Timed out — returning empty groups`);
        return { skeletonDir, groups: [] };
    }
    // Read groups.json
    const groupsPath = path.join(skeletonDir, "groups.json");
    let groups = [];
    if (fs.existsSync(groupsPath)) {
        try {
            const raw = fs.readFileSync(groupsPath, "utf-8");
            const parsed = JSON.parse(raw);
            groups = Array.isArray(parsed) ? parsed : parsed.groups || [];
            console.log(`  [skeleton] Groups: ${groups.map(g => `${g.name}(${g.files.length})`).join(", ")}`);
        }
        catch (e) {
            console.log(`  [skeleton] Failed to parse groups.json: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    else {
        console.log(`  [skeleton] No groups.json found — will run as single member`);
    }
    return { skeletonDir, groups };
}
// --- Phase 2: Parallel group implementation ---
function buildGroupPrompt(talk, group, coreOnly) {
    const descSource = talk.contentDir
        ? `项目描述文件在目录：${talk.contentDir}\n请先用 Read 工具读取该目录下的所有 .md 文件，了解完整的项目描述。`
        : `项目描述如下：\n\n${talk.content}`;
    const coreOnlyNote = coreOnly
        ? `\n注意：Core-Only 模式 — 只关注核心源码实现。\n`
        : "";
    return `You are a software developer. You are implementing a specific module group of a project.

The current working directory contains a project skeleton with type definitions and function stubs.
The full project skeleton (for reference to other modules' interfaces) is available via --add-dir.

Your task: Implement ONLY the following files with full business logic:
${group.files.map(f => `  - ${f}`).join("\n")}

Group: "${group.name}" — ${group.desc}
${coreOnlyNote}
RULES:
- Read the skeleton code first to understand types and interfaces
- Replace stub implementations (throw new Error("TODO")) with real logic
- Use Edit tool to modify existing files — do NOT recreate them from scratch
- Do NOT modify files outside your group — other groups will handle those
- Ensure your implementations match the project description exactly

${descSource}

Now implement the files listed above. Read the skeleton first, then edit each file.`;
}
function buildGroupFixPrompt(talk, group, fixCtx, coreOnly) {
    const descSource = talk.contentDir
        ? `项目描述文件在目录：${talk.contentDir}\n请先用 Read 工具读取该目录下的所有 .md 文件。`
        : `项目描述如下：\n\n${talk.content}`;
    const coreOnlyNote = coreOnly
        ? `\n注意：Core-Only 模式。\n`
        : "";
    return `You are a software developer. You are fixing an existing generated codebase based on a diff report.

The current working directory contains previously generated code. A comparator found gaps.

Your task: Fix ONLY the files in your group:
${group.files.map(f => `  - ${f}`).join("\n")}

Group: "${group.name}" — ${group.desc}
${coreOnlyNote}
差异报告文件在：${fixCtx.reportPath}
请用 Read 工具读取差异报告，了解需要修复的问题。

${descSource}

PRIORITY: Fix the highest-scoring gaps first. Use Edit tool to modify existing files.`;
}
export async function executeGroup(talk, cli, timeout, skeletonDir, groupDir, group, logDir, coreOnly, fixCtx) {
    fs.mkdirSync(groupDir, { recursive: true });
    // Copy skeleton files for this group into groupDir
    copyFiles(skeletonDir, groupDir, group.files);
    const addDirs = [path.resolve(skeletonDir)];
    if (talk.contentDir)
        addDirs.push(talk.contentDir);
    if (fixCtx?.reportPath)
        addDirs.push(path.dirname(path.resolve(fixCtx.reportPath)));
    const prompt = fixCtx
        ? buildGroupFixPrompt(talk, group, fixCtx, coreOnly)
        : buildGroupPrompt(talk, group, coreOnly);
    const result = await spawnCli(cli, prompt, groupDir, timeout, logDir, `member-${group.name}`, addDirs);
    return {
        group,
        generatedDir: groupDir,
        timedOut: result.timedOut,
        exitCode: result.exitCode,
    };
}
export async function executeParallel(talk, cli, timeout, skeletonDir, generatedDir, groups, logDir, coreOnly, fixCtx) {
    fs.mkdirSync(generatedDir, { recursive: true });
    console.log(`  [member] Parallel execution: ${groups.length} groups`);
    const promises = groups.map((group) => {
        const groupDir = path.join(generatedDir, `group-${group.name}`);
        return executeGroup(talk, cli, timeout, skeletonDir, groupDir, group, logDir, coreOnly, fixCtx);
    });
    const results = await Promise.all(promises);
    const succeeded = results.filter(r => !r.timedOut).length;
    console.log(`  [member] Parallel done: ${succeeded}/${results.length} succeeded`);
    return results;
}
// --- Phase 3: Merge ---
/** Merge skeleton + group implementations into a single directory */
export function merge(skeletonDir, generatedDir, mergedDir, groups) {
    // Start with skeleton as base
    copyDir(skeletonDir, mergedDir);
    // Remove groups.json from merged output (internal artifact)
    const groupsJsonPath = path.join(mergedDir, "groups.json");
    if (fs.existsSync(groupsJsonPath)) {
        fs.unlinkSync(groupsJsonPath);
    }
    // Overlay each group's implemented files
    for (const group of groups) {
        const groupDir = path.join(generatedDir, `group-${group.name}`);
        if (!fs.existsSync(groupDir))
            continue;
        // Copy group files over skeleton (overwriting stubs with implementations)
        for (const file of group.files) {
            const srcPath = path.join(groupDir, file);
            const destPath = path.join(mergedDir, file);
            if (fs.existsSync(srcPath)) {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
    console.log(`  [member] Merged skeleton + ${groups.length} groups → ${mergedDir}`);
    return mergedDir;
}
// --- Legacy: single member execution (fallback when no groups) ---
function buildPrompt(talk, coreOnly) {
    const descSource = talk.contentDir
        ? `项目描述文件在目录：${talk.contentDir}\n请先用 Read 工具读取该目录下的所有 .md 文件，了解完整的项目描述。`
        : `项目描述如下：\n\n${talk.content}`;
    const coreOnlyInstruction = coreOnly
        ? `\nIMPORTANT - Core-Only Mode:
- Only create core source files (src/, lib/ directories)
- Create package.json with correct dependencies
- Create tsconfig.json and build config if described
- Create entry point files (index.ts, main.ts, cli.ts, etc.)
- Implement core module logic and data flow
- SKIP: test files, documentation, static assets, CSS/styles, CI/CD configs, examples\n`
        : "";
    return `You are a software developer. Based on the project description, create the complete codebase from scratch.

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
function buildFixPrompt(talk, fixCtx, coreOnly) {
    const descSource = talk.contentDir
        ? `项目描述文件在目录：${talk.contentDir}\n请先用 Read 工具读取该目录下的所有 .md 文件。`
        : `项目描述如下：\n\n${talk.content}`;
    const coreOnlyNote = coreOnly
        ? `\n注意：Core-Only 模式。\n`
        : "";
    return `You are a software developer fixing a generated codebase based on a diff report.
The current working directory has previously generated code. Fix gaps identified in the report.
${coreOnlyNote}
${descSource}

差异报告文件在：${fixCtx.reportPath}
请用 Read 工具读取差异报告，然后逐一修复问题。优先修复扣分最多的维度。`;
}
export async function execute(talk, cli, timeout, outputDir, logDir, coreOnly, fixCtx) {
    fs.mkdirSync(outputDir, { recursive: true });
    if (fixCtx && fs.existsSync(fixCtx.previousDir)) {
        copyDir(fixCtx.previousDir, outputDir);
        console.log(`  [member] Fix mode: copied previous code → ${outputDir}`);
    }
    const prompt = fixCtx && fs.existsSync(fixCtx.previousDir)
        ? buildFixPrompt(talk, fixCtx, coreOnly)
        : buildPrompt(talk, coreOnly);
    const addDirs = [];
    if (talk.contentDir)
        addDirs.push(talk.contentDir);
    if (fixCtx?.reportPath)
        addDirs.push(path.dirname(path.resolve(fixCtx.reportPath)));
    return spawnCli(cli, prompt, outputDir, timeout, logDir, "member", addDirs);
}
//# sourceMappingURL=member.js.map