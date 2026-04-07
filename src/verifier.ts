import type { AnalysisReport, RoundResult, ScanResult, SmttOptions, Talk } from "./types.js";
import { Analyzer } from "./analyzer.js";
import { Comparator } from "./comparator.js";
import { Reporter } from "./reporter.js";
import { getCoreFiles } from "./scanner.js";
import * as member from "./member.js";
import type { MemberFixContext } from "./member.js";

export interface VerifierCallbacks {
  onRoundStart?: (round: number, maxRounds: number) => void;
  onTalkGenerated?: (talk: Talk) => void;
  onMemberStart?: (round: number) => void;
  onMemberComplete?: (round: number, timedOut: boolean) => void;
  onComparisonStart?: (round: number) => void;
  onComparisonComplete?: (round: number, score: number, threshold: number) => void;
  onRefining?: (round: number) => void;
  onSkipRound?: (round: number, score: number) => void;
  onSkipMember?: (round: number) => void;
}

export class Verifier {
  private analyzer: Analyzer;
  private comparator: Comparator;
  private reporter: Reporter;
  private options: SmttOptions;
  private callbacks: VerifierCallbacks;

  constructor(
    options: SmttOptions,
    reporter: Reporter,
    callbacks: VerifierCallbacks = {},
  ) {
    this.analyzer = new Analyzer(options.cli, options.model);
    this.comparator = new Comparator(options.cli, options.model);
    this.reporter = reporter;
    this.options = options;
    this.callbacks = callbacks;
  }

  async run(
    targetDir: string,
    scanResult: ScanResult,
  ): Promise<AnalysisReport> {
    const startTime = Date.now();
    const results: RoundResult[] = [];
    const isResume = !!this.options.resume;
    const coreOnly = this.options.coreOnly;

    // Filter to core files if core-only mode
    const effectiveScan = coreOnly ? getCoreFiles(scanResult) : scanResult;

    if (coreOnly) {
      console.log(`  [verifier] Core-only mode: ${effectiveScan.fileCount} core files (from ${scanResult.fileCount} total)`);
    }

    // Resolve initial talk
    let talk: Talk;

    if (isResume) {
      const latestVersion = this.reporter.getLatestTalkVersion();
      if (latestVersion > 0) {
        talk = this.reporter.readTalk(latestVersion)!;
        this.callbacks.onTalkGenerated?.(talk);
      } else {
        // No talk found in session, generate fresh
        this.callbacks.onTalkGenerated?.({ version: 0, content: "", contentDir: "", generatedAt: "" });
        talk = await this.analyzer.generate(targetDir, effectiveScan, coreOnly);
        this.reporter.writeTalk(talk);
        this.callbacks.onTalkGenerated?.(talk);
      }
    } else {
      this.callbacks.onTalkGenerated?.({ version: 0, content: "", contentDir: "", generatedAt: "" });
      talk = await this.analyzer.generate(targetDir, effectiveScan, coreOnly);
      this.reporter.writeTalk(talk);
      this.callbacks.onTalkGenerated?.(talk);
    }

    // Track previous round for iterative fix mode
    let prevGeneratedDir: string | undefined;
    let prevReportPath: string | undefined;

    for (let round = 1; round <= this.options.maxRounds; round++) {
      const roundStart = Date.now();
      this.callbacks.onRoundStart?.(round, this.options.maxRounds);

      // Resume: check if this round is already fully done
      if (isResume) {
        const existing = this.reporter.readComparison(round);
        if (existing && existing.score > 0) {
          // Round fully complete — skip
          const result: RoundResult = {
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

          // Track for next round's fix context
          prevGeneratedDir = this.reporter.getGeneratedCodeDir(round);
          prevReportPath = existing.reportPath;

          if (existing.score >= this.options.threshold) {
            break;
          }

          // Load refined talk for next round if it exists
          const nextTalk = this.reporter.readTalk(talk.version + 1);
          if (nextTalk) talk = nextTalk;
          continue;
        }
      }

      const roundDir = this.reporter.ensureRoundDir(round);

      // Resume: check if member code exists but comparison is missing
      let generatedDir: string;
      let memberTimedOut = false;

      if (isResume && this.reporter.hasGeneratedCode(round)) {
        // Skip member, use existing generated code
        generatedDir = this.reporter.getGeneratedCodeDir(round);
        this.callbacks.onSkipMember?.(round);
      } else {
        // Build fix context for rounds 2+ (iterative improvement)
        let fixCtx: MemberFixContext | undefined;
        if (prevGeneratedDir && prevReportPath) {
          fixCtx = { previousDir: prevGeneratedDir, reportPath: prevReportPath };
        }

        // Execute member
        this.callbacks.onMemberStart?.(round);
        const memberResult = await member.execute(
          talk,
          this.options.cli,
          this.options.timeout,
          roundDir,
          coreOnly,
          fixCtx,
        );
        this.callbacks.onMemberComplete?.(round, memberResult.timedOut);
        generatedDir = memberResult.generatedDir;
        memberTimedOut = memberResult.timedOut;

        // Save generated code
        this.reporter.copyGeneratedCode(round, generatedDir);
      }

      // Handle timeout
      if (memberTimedOut) {
        const result: RoundResult = {
          round,
          talk,
          generatedDir,
          score: 0,
          feedback: "Member timed out. No code was generated in time.",
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

        // Track for next round even on timeout (member may have partial output)
        prevGeneratedDir = generatedDir;
        prevReportPath = undefined;

        if (round < this.options.maxRounds) {
          this.callbacks.onRefining?.(round);
          talk = await this.analyzer.refine(targetDir, talk, "", coreOnly);
          this.reporter.writeTalk(talk);
        }
        continue;
      }

      // Compare
      this.callbacks.onComparisonStart?.(round);
      const comparison = await this.comparator.compare(targetDir, generatedDir, roundDir, coreOnly);

      const result: RoundResult = {
        round,
        talk,
        generatedDir,
        score: comparison.score,
        feedback: comparison.feedback,
        dimensions: comparison.dimensions,
        duration: Date.now() - roundStart,
      };

      results.push(result);
      this.reporter.writeComparison(round, result);

      // Track for next round's fix context
      prevGeneratedDir = generatedDir;
      prevReportPath = comparison.reportPath;

      if (this.options.keepGenerated && !isResume) {
        this.reporter.copyGeneratedCode(round, generatedDir);
      }

      this.callbacks.onComparisonComplete?.(
        round,
        comparison.score,
        this.options.threshold,
      );

      if (comparison.score >= this.options.threshold) {
        break;
      }

      // Refine for next round
      if (round < this.options.maxRounds) {
        this.callbacks.onRefining?.(round);
        talk = await this.analyzer.refine(targetDir, talk, comparison.reportPath, coreOnly);
        this.reporter.writeTalk(talk);
      }
    }

    // Select best round
    const bestResult = results.reduce((best, r) =>
      r.score > best.score ? r : best,
    );

    const report: AnalysisReport = {
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
