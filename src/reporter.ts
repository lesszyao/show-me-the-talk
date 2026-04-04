import * as fs from "node:fs";
import * as path from "node:path";
import type { AnalysisReport, RoundResult } from "./types.js";

export class Reporter {
  private outputBase: string;
  private sessionDir: string;

  constructor(outputBase: string) {
    this.outputBase = outputBase;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.sessionDir = path.join(outputBase, timestamp);
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getRoundDir(round: number): string {
    return path.join(this.sessionDir, "rounds", `round-${round}`);
  }

  ensureRoundDir(round: number): string {
    const dir = this.getRoundDir(round);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  writeTalk(talk: { version: number; content: string }): void {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    const filename = `talk-v${talk.version}.md`;
    fs.writeFileSync(
      path.join(this.sessionDir, filename),
      talk.content,
      "utf-8",
    );
  }

  writeComparison(round: number, result: RoundResult): void {
    const roundDir = this.ensureRoundDir(round);
    fs.writeFileSync(
      path.join(roundDir, "comparison.json"),
      JSON.stringify(
        {
          round: result.round,
          score: result.score,
          dimensions: result.dimensions,
          feedback: result.feedback,
          duration: result.duration,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  copyGeneratedCode(round: number, generatedDir: string): void {
    const destDir = path.join(this.getRoundDir(round), "generated");
    fs.mkdirSync(destDir, { recursive: true });
    copyDirSync(generatedDir, destDir);
  }

  writeFinalReport(report: AnalysisReport): void {
    fs.mkdirSync(this.sessionDir, { recursive: true });

    // Write final talk
    fs.writeFileSync(
      path.join(this.sessionDir, "talk-final.md"),
      report.finalTalk.content,
      "utf-8",
    );

    // Write full report JSON
    fs.writeFileSync(
      path.join(this.sessionDir, "report.json"),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
  }
}

function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(dest, { recursive: true });

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === "node_modules" || entry.name === ".git") continue;

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch {
        // Skip uncopyable files
      }
    }
  }
}
