import type { Talk } from "./types.js";
export interface MemberResult {
    generatedDir: string;
    log: string;
    timedOut: boolean;
    exitCode: number | null;
}
export declare function execute(talk: Talk, cli: string, timeout: number, logDir: string): Promise<MemberResult>;
