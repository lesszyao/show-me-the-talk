import type { AnalysisReport, ScanResult, SmttOptions, Talk } from "./types.js";
import { Reporter } from "./reporter.js";
export interface VerifierCallbacks {
    onRoundStart?: (round: number, maxRounds: number) => void;
    onTalkGenerated?: (talk: Talk) => void;
    onSkeletonStart?: () => void;
    onSkeletonComplete?: (groupCount: number) => void;
    onMemberStart?: (round: number) => void;
    onMemberComplete?: (round: number, timedOut: boolean) => void;
    onComparisonStart?: (round: number) => void;
    onComparisonComplete?: (round: number, score: number, threshold: number) => void;
    onRefining?: (round: number) => void;
    onSkipRound?: (round: number, score: number) => void;
    onSkipMember?: (round: number) => void;
}
export declare class Verifier {
    private analyzer;
    private comparator;
    private reporter;
    private options;
    private callbacks;
    constructor(options: SmttOptions, reporter: Reporter, callbacks?: VerifierCallbacks);
    run(targetDir: string, scanResult: ScanResult): Promise<AnalysisReport>;
}
