#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { scan } from "./scanner.js";
import { Reporter } from "./reporter.js";
import { Verifier } from "./verifier.js";
import type { SmttOptions } from "./types.js";

function preflightChecks(targetDir: string, cli: string): void {
  const absTarget = path.resolve(targetDir);
  if (!fs.existsSync(absTarget)) {
    console.error(chalk.red(`Error: Target directory does not exist: ${absTarget}`));
    process.exit(1);
  }
  if (!fs.statSync(absTarget).isDirectory()) {
    console.error(chalk.red(`Error: Target path is not a directory: ${absTarget}`));
    process.exit(1);
  }

  const entries = fs.readdirSync(absTarget).filter((e) => !e.startsWith("."));
  if (entries.length === 0) {
    console.error(chalk.red(`Error: Target directory is empty: ${absTarget}`));
    process.exit(1);
  }

  try {
    execSync(`which ${cli}`, { stdio: "ignore" });
  } catch {
    console.error(
      chalk.red(`Error: CLI "${cli}" is not installed or not in PATH.`),
    );
    console.error(
      chalk.yellow(`Install it or use --cli to specify a different CLI.`),
    );
    process.exit(1);
  }
}

const program = new Command();

program
  .name("smtt")
  .description(
    "Show Me The Talk — reverse-engineer natural language descriptions from codebases",
  )
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze a codebase and produce a verified natural-language description")
  .argument("<target-dir>", "Target directory to analyze")
  .option("--max-rounds <n>", "Maximum iteration rounds", "5")
  .option("--threshold <n>", "Pass threshold 0-100", "70")
  .option("--cli <name>", "CLI command to use (claude, cfuse, codex, etc.)", "claude")
  .option("--timeout <ms>", "Member execution timeout in ms", "1800000")
  .option("--output <dir>", "Output directory", "./output")
  .option("--keep-generated", "Keep all rounds' generated code", false)
  .option("--model <id>", "Model for Analyzer/Comparator API calls")
  .option("--full", "Full mode: generate and verify all files (default: core-only)", false)
  .option("--verbose", "Verbose logging", false)
  .option("--resume <dir>", "Resume from an existing session directory")
  .action(async (targetDir: string, opts: Record<string, string | boolean>) => {
    const options: SmttOptions = {
      maxRounds: parseInt(opts["maxRounds"] as string, 10),
      threshold: parseInt(opts["threshold"] as string, 10),
      cli: opts["cli"] as string,
      timeout: parseInt(opts["timeout"] as string, 10),
      output: opts["output"] as string,
      keepGenerated: opts["keepGenerated"] as boolean,
      model: opts["model"] as string | undefined,
      verbose: opts["verbose"] as boolean,
      resume: opts["resume"] as string | undefined,
      coreOnly: !(opts["full"] as boolean),
    };

    const absTarget = path.resolve(targetDir);

    console.log(chalk.bold("\n  Show Me The Talk\n"));
    console.log(chalk.dim(`  Target: ${absTarget}`));
    console.log(
      chalk.dim(
        `  Config: max ${options.maxRounds} rounds, threshold ${options.threshold}, CLI: ${options.cli}, mode: ${options.coreOnly ? "core-only" : "full"}`,
      ),
    );
    if (options.resume) {
      console.log(chalk.cyan(`  Resuming from: ${path.resolve(options.resume)}`));
    }
    console.log();

    // Preflight
    preflightChecks(targetDir, options.cli);

    // Scan
    const scanSpinner = ora("Scanning codebase...").start();
    let scanResult;
    try {
      scanResult = scan(absTarget);
      scanSpinner.succeed(
        `Scanned ${scanResult.fileCount} files`,
      );
    } catch (error) {
      scanSpinner.fail(
        `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    // Setup reporter
    const reporter = options.resume
      ? Reporter.fromExisting(options.resume)
      : new Reporter(options.output);
    console.log(chalk.dim(`  Output: ${reporter.getSessionDir()}\n`));

    // Run verification loop
    let spinner: ReturnType<typeof ora> | null = null;

    const verifier = new Verifier(options, reporter, {
      onTalkGenerated: (talk) => {
        if (talk.version === 0) {
          spinner = ora("  Generating talk...").start();
        } else {
          spinner?.succeed(`  Talk v${talk.version} generated`);
          spinner = null;
        }
      },
      onRoundStart: (round, maxRounds) => {
        console.log(
          chalk.bold(`\n  Round ${round}/${maxRounds}`),
        );
      },
      onSkipRound: (round, score) => {
        console.log(
          chalk.dim(`  Skipped (cached score: ${score}/100)`),
        );
      },
      onSkipMember: (_round) => {
        console.log(
          chalk.dim("  Member skipped (generated code exists)"),
        );
      },
      onMemberStart: (round) => {
        spinner = ora(`  Member executing (round ${round})...`).start();
      },
      onMemberComplete: (_round, timedOut) => {
        if (timedOut) {
          spinner?.fail("  Member timed out");
        } else {
          spinner?.succeed("  Member completed");
        }
        spinner = null;
      },
      onComparisonStart: (_round) => {
        spinner = ora("  Comparing codebases...").start();
      },
      onComparisonComplete: (round, score, threshold) => {
        spinner?.stop();
        spinner = null;
        const color = score >= threshold ? chalk.green : chalk.yellow;
        console.log(
          color(`  Score: ${score}/100 (threshold: ${threshold})`),
        );
        if (score >= threshold) {
          console.log(chalk.green.bold(`  ✓ Passed at round ${round}!`));
        }
      },
      onRefining: () => {
        console.log(chalk.dim("  Refining talk..."));
      },
    });

    try {
      const report = await verifier.run(absTarget, scanResult);

      // Summary
      console.log(chalk.bold("\n  Results"));
      console.log(chalk.dim("  ─".repeat(20)));

      for (const r of report.rounds) {
        const passed = r.score >= options.threshold;
        const icon = passed ? chalk.green("✓") : chalk.yellow("○");
        console.log(
          `  ${icon} Round ${r.round}: ${r.score}/100 (${(r.duration / 1000).toFixed(1)}s)`,
        );

        if (options.verbose) {
          const d = r.dimensions;
          console.log(
            chalk.dim(
              `    Structure: ${d.projectStructure}/20  Logic: ${d.coreLogic}/20  Flow: ${d.dataFlow}/20  Tech: ${d.techChoices}/20  Edge: ${d.edgeCases}/20`,
            ),
          );
        }
      }

      const bestScore = report.rounds[report.bestRound - 1]?.score ?? 0;
      const passed = bestScore >= options.threshold;

      console.log();
      console.log(
        passed
          ? chalk.green.bold(`  ✓ Passed! Best score: ${bestScore}/100 (round ${report.bestRound})`)
          : chalk.yellow.bold(
              `  ○ Did not pass. Best score: ${bestScore}/100 (round ${report.bestRound})`,
            ),
      );
      console.log(
        chalk.dim(
          `  Duration: ${(report.totalDuration / 1000).toFixed(1)}s`,
        ),
      );
      console.log(
        chalk.dim(`  Output: ${reporter.getSessionDir()}`),
      );
      console.log();

      // Show final talk paths
      const sessionDir = reporter.getSessionDir();
      const talkFinalMd = path.join(sessionDir, "talk-final.md");
      const talkFinalDir = path.join(sessionDir, "talk-final");
      const talkFinalHtml = path.join(sessionDir, "talk-final.html");
      console.log(`  📄 Talk:     ${chalk.cyan(talkFinalMd)}`);
      if (fs.existsSync(talkFinalDir)) {
        console.log(`  📂 Chapters: ${chalk.cyan(talkFinalDir + "/")}`);
      }
      if (fs.existsSync(talkFinalHtml)) {
        console.log(`  🌐 Preview:  ${chalk.cyan(talkFinalHtml)}`);
        try {
          const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          execSync(`${cmd} "${talkFinalHtml}"`, { stdio: "ignore" });
        } catch {
          // Ignore if browser open fails
        }
      }
      console.log();
    } catch (error) {
      console.error(
        chalk.red(
          `\nError: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exit(1);
    }
  });

program.parse();
