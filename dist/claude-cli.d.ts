export interface CliRunOptions {
    cli: string;
    prompt: string;
    model?: string;
    cwd?: string;
    addDirs?: string[];
    timeout?: number;
    maxRetries?: number;
    /** When true, don't treat empty stdout as an error (e.g. output is written to files instead) */
    allowEmptyOutput?: boolean;
    /** Bypass all permission checks (needed for Write tool in -p mode) */
    dangerouslySkipPermissions?: boolean;
    /** Directory to save prompt/output logs */
    logDir?: string;
    /** Label for log files (e.g. "analyzer", "comparator") */
    logLabel?: string;
}
export interface CliRunResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}
export declare function runCli(options: CliRunOptions): Promise<string>;
