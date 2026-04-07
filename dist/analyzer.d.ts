import type { ScanResult, Talk } from "./types.js";
/** Read all .md files from a directory, sort by name, concatenate.
 *  Excludes log/prompt files written by runCli. */
export declare function readTalkFiles(dir: string): string;
export declare class Analyzer {
    private cli;
    private model?;
    constructor(cli: string, model?: string);
    generate(targetDir: string, scanResult: ScanResult, coreOnly: boolean, outputDir: string, logDir: string): Promise<Talk>;
    refine(targetDir: string, talk: Talk, reportPath: string, coreOnly: boolean, outputDir: string, logDir: string): Promise<Talk>;
}
