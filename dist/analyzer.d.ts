import type { ScanResult, Talk } from "./types.js";
export declare class Analyzer {
    private cli;
    private model?;
    constructor(cli: string, model?: string);
    generate(targetDir: string, scanResult: ScanResult): Promise<Talk>;
    refine(targetDir: string, talk: Talk, feedback: string): Promise<Talk>;
}
