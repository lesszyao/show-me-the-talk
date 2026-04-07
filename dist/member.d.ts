import type { GroupDef, MemberGroupResult, SkeletonResult, Talk } from "./types.js";
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
export declare function executeSkeleton(talk: Talk, cli: string, timeout: number, skeletonDir: string, logDir: string, coreOnly: boolean): Promise<SkeletonResult>;
export declare function executeGroup(talk: Talk, cli: string, timeout: number, skeletonDir: string, groupDir: string, group: GroupDef, logDir: string, coreOnly: boolean, fixCtx?: MemberFixContext): Promise<MemberGroupResult>;
export declare function executeParallel(talk: Talk, cli: string, timeout: number, skeletonDir: string, generatedDir: string, groups: GroupDef[], logDir: string, coreOnly: boolean, fixCtx?: MemberFixContext): Promise<MemberGroupResult[]>;
/** Merge skeleton + group implementations into a single directory */
export declare function merge(skeletonDir: string, generatedDir: string, mergedDir: string, groups: GroupDef[]): string;
export declare function execute(talk: Talk, cli: string, timeout: number, outputDir: string, logDir: string, coreOnly: boolean, fixCtx?: MemberFixContext): Promise<MemberResult>;
