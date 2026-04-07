import type { AnalysisReport, ComparisonResult, RoundResult, Talk } from "./types.js";
export declare class Reporter {
    private sessionDir;
    constructor(outputBase: string);
    static fromExisting(sessionDir: string): Reporter;
    getSessionDir(): string;
    getRoundDir(round: number): string;
    ensureRoundDir(round: number): string;
    writeTalk(talk: {
        version: number;
        content: string;
        contentDir?: string;
    }): void;
    writeComparison(round: number, result: RoundResult): void;
    copyGeneratedCode(round: number, generatedDir: string): void;
    writeFinalReport(report: AnalysisReport): {
        htmlPath: string;
    };
    private writeHtmlPreview;
    private ensureDir;
    getWorkspaceDir(): string;
    getLogsDir(): string;
    getContextDir(): string;
    getTalkDir(version: number): string;
    getSkeletonDir(): string;
    getGeneratedGroupDir(groupName: string): string;
    getMergedDir(): string;
    getReportsDir(round?: number): string;
    getLatestTalkVersion(): number;
    readTalk(version: number): Talk | null;
    hasGeneratedCode(round: number): boolean;
    getGeneratedCodeDir(round: number): string;
    readComparison(round: number): ComparisonResult | null;
}
