export interface Talk {
    version: number;
    content: string;
    generatedAt: string;
}
export interface DimensionScores {
    projectStructure: number;
    coreLogic: number;
    dataFlow: number;
    techChoices: number;
    edgeCases: number;
}
export interface RoundResult {
    round: number;
    talk: Talk;
    generatedDir: string;
    score: number;
    feedback: string;
    dimensions: DimensionScores;
    duration: number;
}
export interface AnalysisReport {
    targetDir: string;
    rounds: RoundResult[];
    bestRound: number;
    finalTalk: Talk;
    totalDuration: number;
}
export interface FileEntry {
    relativePath: string;
    priority: number;
}
export interface ScanResult {
    files: FileEntry[];
    metadata: ProjectMetadata;
    fileCount: number;
}
export interface ProjectMetadata {
    name?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    tsconfig?: Record<string, unknown>;
    entryPoint?: string;
}
export interface SmttOptions {
    maxRounds: number;
    threshold: number;
    cli: string;
    timeout: number;
    output: string;
    keepGenerated: boolean;
    model?: string;
    verbose: boolean;
}
export interface ComparisonResult {
    score: number;
    dimensions: DimensionScores;
    feedback: string;
}
