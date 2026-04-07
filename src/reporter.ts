import * as fs from "node:fs";
import * as path from "node:path";
import { readTalkFiles } from "./analyzer.js";
import type { AnalysisReport, ComparisonResult, DimensionScores, RoundResult, Talk } from "./types.js";

export class Reporter {
  private sessionDir: string;

  constructor(outputBase: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.sessionDir = path.join(outputBase, timestamp);
  }

  static fromExisting(sessionDir: string): Reporter {
    const absDir = path.resolve(sessionDir);
    if (!fs.existsSync(absDir)) {
      throw new Error(`Session directory does not exist: ${absDir}`);
    }
    const reporter = Object.create(Reporter.prototype) as Reporter;
    reporter.sessionDir = absDir;
    return reporter;
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

  writeTalk(talk: { version: number; content: string; contentDir?: string }): void {
    fs.mkdirSync(this.sessionDir, { recursive: true });

    // Copy talk files directory if available
    if (talk.contentDir && fs.existsSync(talk.contentDir)) {
      const destDir = path.join(this.sessionDir, `talk-v${talk.version}`);
      fs.mkdirSync(destDir, { recursive: true });
      copyDirSync(talk.contentDir, destDir);
    }

    // Also write concatenated content as single file for easy reading
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

    fs.writeFileSync(
      path.join(this.sessionDir, "talk-final.md"),
      report.finalTalk.content,
      "utf-8",
    );

    fs.writeFileSync(
      path.join(this.sessionDir, "report.json"),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
  }

  // --- Resume helpers ---

  getLatestTalkVersion(): number {
    if (!fs.existsSync(this.sessionDir)) return 0;
    const files = fs.readdirSync(this.sessionDir);
    let max = 0;
    for (const f of files) {
      const match = f.match(/^talk-v(\d+)\.md$/);
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
    return max;
  }

  readTalk(version: number): Talk | null {
    // Prefer directory-based talk
    const talkDir = path.join(this.sessionDir, `talk-v${version}`);
    if (fs.existsSync(talkDir) && fs.statSync(talkDir).isDirectory()) {
      const content = readTalkFiles(talkDir);
      if (content) {
        return {
          version,
          content,
          contentDir: talkDir,
          generatedAt: fs.statSync(talkDir).mtime.toISOString(),
        };
      }
    }

    // Fallback to single file
    const filePath = path.join(this.sessionDir, `talk-v${version}.md`);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return {
      version,
      content,
      contentDir: "",
      generatedAt: fs.statSync(filePath).mtime.toISOString(),
    };
  }

  hasGeneratedCode(round: number): boolean {
    const genDir = path.join(this.getRoundDir(round), "generated");
    if (!fs.existsSync(genDir)) return false;
    try {
      const entries = fs.readdirSync(genDir);
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  getGeneratedCodeDir(round: number): string {
    return path.join(this.getRoundDir(round), "generated");
  }

  readComparison(round: number): ComparisonResult | null {
    const filePath = path.join(this.getRoundDir(round), "comparison.json");
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (typeof raw.score !== "number" || raw.score <= 0) return null;
      const dims: DimensionScores = raw.dimensions || {
        projectStructure: 0,
        coreLogic: 0,
        dataFlow: 0,
        techChoices: 0,
        edgeCases: 0,
      };
      // Check if diff report exists in round dir
      const roundDir = this.getRoundDir(round);
      const reportPath = path.join(roundDir, "diff-report.md");

      return {
        score: raw.score,
        dimensions: dims,
        feedback: raw.feedback || "",
        reportPath: fs.existsSync(reportPath) ? reportPath : "",
      };
    } catch {
      return null;
    }
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
