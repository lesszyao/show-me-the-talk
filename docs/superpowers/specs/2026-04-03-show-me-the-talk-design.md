# show-me-the-talk Design Spec

**Date:** 2026-04-03
**Status:** Draft

## Problem

All code is increasingly produced via natural language (vibe coding). Given a codebase, we need to reverse-engineer the natural language description that could reproduce it. The reverse-engineered description must be validated: a fresh agent with no prior context should be able to write structurally equivalent code from the description alone.

## Goals

1. Read a codebase and produce a pure natural-language project description ("talk")
2. Validate the talk by having an isolated CLI agent write code from it
3. Iterate until the generated code is structurally similar to the original
4. Output a final verified talk plus a detailed verification report

## Non-Goals

- Producing identical code (structural/functional equivalence is sufficient)
- Supporting non-CLI verification backends (API-only mode)
- Parallel verification (future enhancement)

## Architecture

```
smtt analyze <target-dir> [options]

┌──────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│ Scanner  │───>│ Analyzer │───>│  Verifier  │───>│ Reporter │
│          │    │ (Main)   │<───│  (Loop)    │    │          │
└──────────┘    └──────────┘    └────────────┘    └──────────┘
                     │               │
                     ▼               ▼
                LLM API call    spawn CLI subprocess
               (code → talk)    (talk → code)
```

### Modules

| Module | File | Responsibility |
|--------|------|---------------|
| CLI | `src/cli.ts` | Entry point, argument parsing |
| Scanner | `src/scanner.ts` | Traverse target dir, extract project structure, filter and prioritize files |
| Analyzer | `src/analyzer.ts` | Call LLM API to generate/refine talk from code snapshot |
| Member | `src/member.ts` | Spawn isolated CLI subprocess, manage timeout, capture output |
| Comparator | `src/comparator.ts` | Call LLM API to compare original vs generated code, produce score + feedback |
| Verifier | `src/verifier.ts` | Orchestrate the analyze → verify → refine loop |
| Reporter | `src/reporter.ts` | Write final talk and report to output directory |
| Types | `src/types.ts` | Shared type definitions |

## Data Flow

### Single Round

```
Round N:

  Analyzer ──talk v(N)──> Member (claude CLI in tmpdir) ──generated code──> Comparator
     ^                                                                          │
     └────────────────────────feedback + score─────────────────────────────────┘
```

1. Analyzer produces talk (v1 on first round, refined on subsequent rounds)
2. Member executes in a fresh temp directory with only the talk as input
3. Comparator receives both codebases, scores similarity, produces feedback
4. If score >= threshold: done. Otherwise Analyzer refines talk using feedback.

### Iteration Control

```
talk = analyzer.generate(targetDir)
results = []

for round in 1..maxRounds:
    tmpDir = mkdtemp()
    member.execute(talk, tmpDir)
    score, feedback = comparator.compare(targetDir, tmpDir)
    results.push({ round, talk, score, feedback })

    if score >= threshold:
        break

    talk = analyzer.refine(talk, feedback)

return max(results, by: score)
```

- Maximum rounds: configurable, default 5
- Threshold: configurable, default 70
- On reaching max rounds without passing: select the round with highest score

## Core Types

```typescript
interface Talk {
  version: number;
  content: string;        // Pure natural language, no code snippets
  generatedAt: string;
}

interface RoundResult {
  round: number;
  talk: Talk;
  generatedDir: string;
  score: number;          // 0-100
  feedback: string;
  dimensions: DimensionScores;
  duration: number;       // ms
}

interface DimensionScores {
  projectStructure: number;   // 0-20
  coreLogic: number;          // 0-20
  dataFlow: number;           // 0-20
  techChoices: number;        // 0-20
  edgeCases: number;          // 0-20
}

interface AnalysisReport {
  targetDir: string;
  rounds: RoundResult[];
  bestRound: number;
  finalTalk: Talk;
  totalDuration: number;
}
```

## Scanner Strategy

1. Traverse target directory, respect `.gitignore`
2. Filter out: `node_modules`, `dist`, `.git`, binary files, lock files
3. Prioritize files for context window:
   - Entry files (index, main, app) > Core modules > Utilities > Tests
4. Extract project metadata from `package.json`, `tsconfig.json`, etc.
5. If total content exceeds context limit, truncate by priority

## Analyzer Prompt Strategy

The analyze prompt instructs the LLM to produce a talk that:
- Describes project purpose, tech stack, directory conventions
- Specifies each module's responsibility and interfaces
- Explains data flow between modules
- Covers key business logic in natural language
- Does NOT contain code snippets (the whole point is natural language sufficiency)

The refine prompt receives the previous talk + comparator feedback, and makes incremental adjustments to address identified gaps.

## Comparator Scoring

Five dimensions, each 0-20, total 0-100:

| Dimension | Criteria |
|-----------|----------|
| Project Structure | Directory layout, file naming, module organization |
| Core Logic | Main feature implementation approach equivalence |
| Data Flow | Inter-module call relationships, data passing patterns |
| Tech Choices | Framework, library, language feature selection |
| Edge Cases | Error handling, configuration, CLI arguments coverage |

Threshold: **>= 70** passes. Below 70: feedback drives next refinement.

## Member Execution

```bash
claude -p "<talk content>" \
  --output-dir /tmp/smtt-member-xxxx \
  --max-turns 50 \
  --allowedTools Edit,Write,Bash,Glob
```

- Each round: new process + new temp directory (complete isolation)
- Timeout: 10 minutes default (configurable)
- On timeout: SIGTERM, score 0, continue to next round
- CLI is configurable: `claude` (default) or `codex`
- stdout/stderr captured to `output/round-N/member.log`

## CLI Interface

```bash
smtt analyze <target-dir> [options]

Options:
  --max-rounds <n>        Maximum iteration rounds (default: 5)
  --threshold <n>         Pass threshold 0-100 (default: 70)
  --cli <name>            CLI to use for member: claude|codex (default: claude)
  --timeout <ms>          Member execution timeout (default: 600000)
  --output <dir>          Output directory (default: ./output)
  --keep-generated        Keep all rounds' generated code (default: best only)
  --model <id>            Model for Analyzer/Comparator API calls
  --verbose               Verbose logging
```

## Output Structure

```
output/
└── 2026-04-03T10-30-00/
    ├── talk-v1.md
    ├── talk-v2.md
    ├── talk-final.md           # Best version
    ├── report.json             # Full AnalysisReport
    └── rounds/
        ├── round-1/
        │   ├── member.log
        │   ├── generated/      # Member's code output
        │   └── comparison.json
        └── round-2/
            └── ...
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | LLM API for Analyzer and Comparator |
| `commander` | CLI argument parsing |
| `ora` | Progress spinner |
| `chalk` | Colored terminal output |

Build: `tsc` for production, `tsx` for development. No bundler.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Target CLI not installed | Pre-flight check, clear error message |
| `ANTHROPIC_API_KEY` missing | Pre-flight check, clear error message |
| Member timeout | Kill process, score 0 for round, continue |
| LLM API failure | Retry 3 times with backoff, then exit with error |
| Target dir empty/invalid | Pre-flight check, clear error message |

## Future Enhancements (Not in MVP)

- Parallel member execution (tmux-based, inspired by OMC team architecture)
- File-level granularity mode (reverse-engineer per module, then compose)
- Web UI for browsing talk versions and comparison reports
- Support for more CLI backends (Gemini, Copilot)
