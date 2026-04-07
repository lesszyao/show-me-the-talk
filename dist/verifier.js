import * as fs from "node:fs";
import { Analyzer } from "./analyzer.js";
import { Comparator } from "./comparator.js";
import { getCoreFiles, selectCoreFiles, MAX_CORE_FILES } from "./scanner.js";
import * as member from "./member.js";
export class Verifier {
    analyzer;
    comparator;
    reporter;
    options;
    callbacks;
    constructor(options, reporter, callbacks = {}) {
        this.analyzer = new Analyzer(options.cli, options.model);
        this.comparator = new Comparator(options.cli, options.model);
        this.reporter = reporter;
        this.options = options;
        this.callbacks = callbacks;
    }
    async run(targetDir, scanResult) {
        const startTime = Date.now();
        const results = [];
        const isResume = !!this.options.resume;
        const coreOnly = this.options.coreOnly;
        const logsDir = this.reporter.getLogsDir();
        // --- Step 1: Filter & select core files ---
        let effectiveScan;
        if (coreOnly) {
            const filtered = getCoreFiles(scanResult);
            console.log(`  [verifier] Core-only mode: ${filtered.fileCount} core files (from ${scanResult.fileCount} total)`);
            if (filtered.fileCount > MAX_CORE_FILES) {
                console.log(`  [verifier] Too many core files (${filtered.fileCount} > ${MAX_CORE_FILES}), using AI to select...`);
                effectiveScan = await selectCoreFiles(filtered, targetDir, this.options.cli, this.options.model, logsDir);
                // Save selected files to workspace context
                const contextDir = this.reporter.getContextDir();
                fs.writeFileSync(`${contextDir}/selected-files.json`, JSON.stringify(effectiveScan.files.map(f => f.relativePath), null, 2), "utf-8");
            }
            else {
                effectiveScan = filtered;
            }
        }
        else {
            effectiveScan = scanResult;
        }
        // --- Step 2: Generate talk ---
        let talk;
        if (isResume) {
            const latestVersion = this.reporter.getLatestTalkVersion();
            if (latestVersion > 0) {
                talk = this.reporter.readTalk(latestVersion);
                this.callbacks.onTalkGenerated?.(talk);
            }
            else {
                this.callbacks.onTalkGenerated?.({ version: 0, content: "", contentDir: "", generatedAt: "" });
                const talkDir = this.reporter.getTalkDir(1);
                talk = await this.analyzer.generate(targetDir, effectiveScan, coreOnly, talkDir, logsDir);
                this.reporter.writeTalk(talk);
                this.callbacks.onTalkGenerated?.(talk);
            }
        }
        else {
            this.callbacks.onTalkGenerated?.({ version: 0, content: "", contentDir: "", generatedAt: "" });
            const talkDir = this.reporter.getTalkDir(1);
            talk = await this.analyzer.generate(targetDir, effectiveScan, coreOnly, talkDir, logsDir);
            this.reporter.writeTalk(talk);
            this.callbacks.onTalkGenerated?.(talk);
        }
        // --- Step 3: Generate skeleton (once) ---
        const skeletonDir = this.reporter.getSkeletonDir();
        let groups = [];
        this.callbacks.onSkeletonStart?.();
        const skeletonResult = await member.executeSkeleton(talk, this.options.cli, this.options.timeout, skeletonDir, logsDir, coreOnly);
        groups = skeletonResult.groups;
        this.callbacks.onSkeletonComplete?.(groups.length);
        // --- Step 4: Iterative rounds ---
        let prevReportPath;
        for (let round = 1; round <= this.options.maxRounds; round++) {
            const roundStart = Date.now();
            this.callbacks.onRoundStart?.(round, this.options.maxRounds);
            // Resume: check if this round is already fully done
            if (isResume) {
                const existing = this.reporter.readComparison(round);
                if (existing && existing.score > 0) {
                    const result = {
                        round,
                        talk,
                        generatedDir: this.reporter.getGeneratedCodeDir(round),
                        score: existing.score,
                        feedback: existing.feedback,
                        dimensions: existing.dimensions,
                        duration: 0,
                    };
                    results.push(result);
                    this.callbacks.onSkipRound?.(round, existing.score);
                    prevReportPath = existing.reportPath;
                    if (existing.score >= this.options.threshold)
                        break;
                    const nextTalk = this.reporter.readTalk(talk.version + 1);
                    if (nextTalk)
                        talk = nextTalk;
                    continue;
                }
            }
            this.reporter.ensureRoundDir(round);
            // Build fix context for rounds 2+
            let fixCtx;
            if (prevReportPath) {
                fixCtx = {
                    previousDir: this.reporter.getMergedDir(),
                    reportPath: prevReportPath,
                };
            }
            // Execute members
            this.callbacks.onMemberStart?.(round);
            let mergedDir;
            let anyTimedOut = false;
            if (groups.length > 0) {
                // Parallel execution by groups
                const generatedDir = this.reporter.getGeneratedGroupDir(`round-${round}`);
                const groupResults = await member.executeParallel(talk, this.options.cli, this.options.timeout, skeletonDir, generatedDir, groups, logsDir, coreOnly, fixCtx);
                anyTimedOut = groupResults.some(r => r.timedOut);
                // Merge skeleton + group implementations
                mergedDir = this.reporter.getMergedDir();
                member.merge(skeletonDir, generatedDir, mergedDir, groups);
            }
            else {
                // Fallback: single member execution (no groups)
                mergedDir = this.reporter.getMergedDir();
                const memberResult = await member.execute(talk, this.options.cli, this.options.timeout, mergedDir, logsDir, coreOnly, fixCtx);
                anyTimedOut = memberResult.timedOut;
            }
            this.callbacks.onMemberComplete?.(round, anyTimedOut);
            // Save generated code snapshot
            this.reporter.copyGeneratedCode(round, mergedDir);
            // Handle timeout
            if (anyTimedOut) {
                const result = {
                    round,
                    talk,
                    generatedDir: mergedDir,
                    score: 0,
                    feedback: "Member(s) timed out.",
                    dimensions: {
                        projectStructure: 0,
                        coreLogic: 0,
                        dataFlow: 0,
                        techChoices: 0,
                        edgeCases: 0,
                    },
                    duration: Date.now() - roundStart,
                };
                results.push(result);
                this.reporter.writeComparison(round, result);
                this.callbacks.onComparisonComplete?.(round, 0, this.options.threshold);
                prevReportPath = undefined;
                if (round < this.options.maxRounds) {
                    this.callbacks.onRefining?.(round);
                    const refinedTalkDir = this.reporter.getTalkDir(talk.version + 1);
                    talk = await this.analyzer.refine(targetDir, talk, "", coreOnly, refinedTalkDir, logsDir);
                    this.reporter.writeTalk(talk);
                }
                continue;
            }
            // Compare
            this.callbacks.onComparisonStart?.(round);
            const reportsDir = this.reporter.getReportsDir(round);
            const comparison = await this.comparator.compare(targetDir, mergedDir, reportsDir, coreOnly, logsDir);
            const result = {
                round,
                talk,
                generatedDir: mergedDir,
                score: comparison.score,
                feedback: comparison.feedback,
                dimensions: comparison.dimensions,
                duration: Date.now() - roundStart,
            };
            results.push(result);
            this.reporter.writeComparison(round, result);
            prevReportPath = comparison.reportPath;
            this.callbacks.onComparisonComplete?.(round, comparison.score, this.options.threshold);
            if (comparison.score >= this.options.threshold)
                break;
            // Refine for next round
            if (round < this.options.maxRounds) {
                this.callbacks.onRefining?.(round);
                const refinedTalkDir = this.reporter.getTalkDir(talk.version + 1);
                talk = await this.analyzer.refine(targetDir, talk, comparison.reportPath, coreOnly, refinedTalkDir, logsDir);
                this.reporter.writeTalk(talk);
            }
        }
        // Select best round
        const bestResult = results.reduce((best, r) => r.score > best.score ? r : best);
        const report = {
            targetDir,
            rounds: results,
            bestRound: bestResult.round,
            finalTalk: bestResult.talk,
            totalDuration: Date.now() - startTime,
        };
        this.reporter.writeFinalReport(report);
        return report;
    }
}
//# sourceMappingURL=verifier.js.map