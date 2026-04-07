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
export declare function execute(talk: Talk, cli: string, timeout: number, logDir: string, coreOnly?: boolean, fixCtx?: MemberFixContext): Promise<MemberResult>;
