export interface CliRunOptions {
    cli: string;
    prompt: string;
    systemPrompt?: string;
    model?: string;
    cwd?: string;
    addDirs?: string[];
    timeout?: number;
    maxRetries?: number;
}
export interface CliRunResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}
export declare function runCli(options: CliRunOptions): Promise<string>;
