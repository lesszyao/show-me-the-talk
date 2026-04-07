import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
export async function runCli(options) {
    const maxRetries = options.maxRetries ?? 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`  [cli] Retry ${attempt}/${maxRetries}...`);
            }
            const result = await spawnCli(options, attempt);
            if (result.exitCode !== 0) {
                throw new Error(`CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
            }
            const output = result.stdout.trim();
            if (!output && !options.allowEmptyOutput) {
                throw new Error("CLI returned empty output");
            }
            return output;
        }
        catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`CLI failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
            }
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`  [cli] Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw new Error("Unreachable");
}
function spawnCli(options, attempt) {
    const { cli, prompt, model, cwd, addDirs, dangerouslySkipPermissions, timeout = 1_800_000 } = options;
    const args = ["-p"];
    if (dangerouslySkipPermissions) {
        args.push("--dangerously-skip-permissions");
    }
    if (model) {
        args.push("--model", model);
    }
    if (addDirs) {
        for (const dir of addDirs) {
            args.push("--add-dir", dir);
        }
    }
    const effectiveCwd = cwd || process.cwd();
    const label = options.logLabel || "cli";
    // Save prompt to log file
    const logDir = options.logDir || fs.mkdtempSync(path.join(os.tmpdir(), "smtt-cli-log-"));
    fs.mkdirSync(logDir, { recursive: true });
    const promptLogFile = path.join(logDir, `${label}-prompt${attempt > 1 ? `-attempt${attempt}` : ""}.md`);
    fs.writeFileSync(promptLogFile, prompt, "utf-8");
    console.log(`  [${label}] Running: ${cli} ${args.join(" ")}`);
    console.log(`  [${label}] CWD: ${effectiveCwd}`);
    console.log(`  [${label}] Timeout: ${(timeout / 1000 / 60).toFixed(0)}min`);
    console.log(`  [${label}] Prompt: ${promptLogFile} (${prompt.length} chars)`);
    return new Promise((resolve, reject) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        const child = spawn(cli, args, {
            cwd: effectiveCwd,
            env: { ...process.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        // Write prompt via stdin
        child.stdin.write(prompt);
        child.stdin.end();
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => {
                if (!child.killed)
                    child.kill("SIGKILL");
            }, 5000);
            reject(new Error(`CLI timed out after ${timeout}ms`));
        }, timeout);
        child.stdout.on("data", (chunk) => {
            stdoutBuf += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderrBuf += String(chunk);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            // Save output log
            const outputLogFile = path.join(logDir, `${label}-output${attempt > 1 ? `-attempt${attempt}` : ""}.log`);
            const logContent = `=== EXIT CODE: ${code} ===\n\n=== STDOUT (${stdoutBuf.length} chars) ===\n${stdoutBuf}\n\n=== STDERR (${stderrBuf.length} chars) ===\n${stderrBuf}`;
            fs.writeFileSync(outputLogFile, logContent, "utf-8");
            console.log(`  [${label}] Done: exit=${code}, stdout=${stdoutBuf.length} chars, stderr=${stderrBuf.length} chars`);
            console.log(`  [${label}] Output log: ${outputLogFile}`);
            resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
//# sourceMappingURL=claude-cli.js.map