import { spawn } from "node:child_process";
export async function runCli(options) {
    const maxRetries = options.maxRetries ?? 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await spawnCli(options);
            if (result.exitCode !== 0) {
                throw new Error(`CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
            }
            const output = result.stdout.trim();
            if (!output) {
                throw new Error("CLI returned empty output");
            }
            return output;
        }
        catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`CLI failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
            }
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw new Error("Unreachable");
}
function spawnCli(options) {
    const { cli, prompt, systemPrompt, model, cwd, addDirs, timeout = 600_000 } = options;
    const args = ["-p"];
    if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
    }
    if (model) {
        args.push("--model", model);
    }
    if (addDirs) {
        for (const dir of addDirs) {
            args.push("--add-dir", dir);
        }
    }
    return new Promise((resolve, reject) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        const child = spawn(cli, args, {
            cwd: cwd || process.cwd(),
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
            resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
//# sourceMappingURL=claude-cli.js.map