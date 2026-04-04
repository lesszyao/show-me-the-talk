import type { AnalysisReport, RoundResult } from "./types.js";
export declare class Reporter {
    private outputBase;
    private sessionDir;
    constructor(outputBase: string);
    getSessionDir(): string;
    getRoundDir(round: number): string;
    ensureRoundDir(round: number): string;
    writeTalk(talk: {
        version: number;
        content: string;
    }): void;
    writeComparison(round: number, result: RoundResult): void;
    copyGeneratedCode(round: number, generatedDir: string): void;
    writeFinalReport(report: AnalysisReport): void;
}
