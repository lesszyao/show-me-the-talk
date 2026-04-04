import type { AnalysisReport, RoundResult, ScanResult, SmttOptions, Talk } from "./types.js";
import { Analyzer } from "./analyzer.js";
import { Comparator } from "./comparator.js";
import { Reporter } from "./reporter.js";
import * as member from "./member.js";

export interface VerifierCallbacks {
  onRoundStart?: (round: number, maxRounds: number) => void;
  onTalkGenerated?: (talk: Talk) => void;
  onMemberStart?: (round: number) => void;
  onMemberComplete?: (round: number, timedOut: boolean) => void;
  onComparisonComplete?: (round: number, score: number, threshold: number) => void;
  onRefining?: (round: number) => void;
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

    // Generate initial talk
    this.callbacks.onTalkGenerated?.({
      version: 0,
      content: "",
      generatedAt: "",
    });

    let talk = await this.analyzer.generate(targetDir, scanResult);
    this.reporter.writeTalk(talk);
    this.callbacks.onTalkGenerated?.(talk);

    for (let round = 1; round <= this.options.maxRounds; round++) {
      const roundStart = Date.now();
      this.callbacks.onRoundStart?.(round, this.options.maxRounds);

      // Ensure round directory exists
      const roundDir = this.reporter.ensureRoundDir(round);

      // Execute member
      this.callbacks.onMemberStart?.(round);
      const memberResult = await member.execute(
        talk,
        this.options.cli,
        this.options.timeout,
        roundDir,
      );
      this.callbacks.onMemberComplete?.(round, memberResult.timedOut);

      // Handle timeout: score 0
      if (memberResult.timedOut) {
        const result: RoundResult = {
          round,
          talk,
          generatedDir: memberResult.generatedDir,
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

        if (round < this.options.maxRounds) {
          this.callbacks.onRefining?.(round);
          talk = await this.analyzer.refine(
            targetDir,
            talk,
            "The previous attempt timed out. Simplify the description to focus on the most essential structure and logic.",
          );
          this.reporter.writeTalk(talk);
        }
        continue;
      }

      // Compare
      const comparison = await this.comparator.compare(
        targetDir,
        memberResult.generatedDir,
      );

      const result: RoundResult = {
        round,
        talk,
        generatedDir: memberResult.generatedDir,
        score: comparison.score,
        feedback: comparison.feedback,
        dimensions: comparison.dimensions,
        duration: Date.now() - roundStart,
      };

      results.push(result);
      this.reporter.writeComparison(round, result);

      // Copy generated code if keeping all rounds or this could be the best
      if (this.options.keepGenerated) {
        this.reporter.copyGeneratedCode(round, memberResult.generatedDir);
      }

      this.callbacks.onComparisonComplete?.(
        round,
        comparison.score,
        this.options.threshold,
      );

      // Check threshold
      if (comparison.score >= this.options.threshold) {
        // Copy the winning round's code
        if (!this.options.keepGenerated) {
          this.reporter.copyGeneratedCode(round, memberResult.generatedDir);
        }
        break;
      }

      // Refine for next round
      if (round < this.options.maxRounds) {
        this.callbacks.onRefining?.(round);
        talk = await this.analyzer.refine(targetDir, talk, comparison.feedback);
        this.reporter.writeTalk(talk);
      }
    }

    // Select best round
    const bestResult = results.reduce((best, r) =>
      r.score > best.score ? r : best,
    );

    // Copy best round's code if not already copied
    if (!this.options.keepGenerated && bestResult.score < this.options.threshold) {
      this.reporter.copyGeneratedCode(bestResult.round, bestResult.generatedDir);
    }

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
