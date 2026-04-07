import type { ComparisonResult } from "./types.js";
export declare class Comparator {
    private cli;
    private model?;
    constructor(cli: string, model?: string);
    compare(originalDir: string, generatedDir: string, reportDir: string, coreOnly?: boolean, logDir?: string): Promise<ComparisonResult>;
    private parseResponse;
    private clamp;
}
