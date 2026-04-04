import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
function buildPrompt(talk) {
    return `You are a software developer. Based on the following project description, create the complete codebase from scratch.

Create all necessary files with the correct directory structure. Write production-quality code that matches the description.

IMPORTANT:
- Create every file described
- Follow the exact directory structure specified
- Implement all modules, functions, and logic described
- Use the exact technology stack mentioned
- Include package.json with all dependencies mentioned
- Include configuration files (tsconfig.json, etc.) as described

Here is the project description:

${talk.content}

Now create the complete codebase. Start by creating the directory structure, then implement each file.`;
}
export async function execute(talk, cli, timeout, logDir) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smtt-member-"));
    const prompt = buildPrompt(talk);
    const logFile = path.join(logDir, "member.log");
    const args = [
        "-p",
        "--allowedTools", "Edit,Write,Bash,Glob",
        "--dangerously-skip-permissions",
    ];
    return new Promise((resolve) => {
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
                if (!child.killed)
                    child.kill("SIGKILL");
            }, 5000);
        }, timeout);
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
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
//# sourceMappingURL=member.js.map