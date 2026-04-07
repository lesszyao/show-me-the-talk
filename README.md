# Show Me The Talk

Reverse-engineer natural language descriptions from codebases and validate them through code generation.

SMTT analyzes a codebase, produces a detailed natural-language description ("talk"), then validates it by having an AI regenerate the code from that description alone. A comparator scores the structural equivalence, and the process iterates until the description is accurate enough.

## How It Works

```
Scanner ──► getCoreFiles() ──► Analyzer ──► Talk v1
                                              │
                              ┌────── Round Loop (max N) ──────┐
                              │                                │
                              │  Member ──► Generated Code     │
                              │                │               │
                              │         Comparator             │
                              │          │        │            │
                              │     Score ≥ 70?   diff-report  │
                              │      │                │        │
                              │     Yes              No        │
                              │      │         ┌─────┴─────┐   │
                              │      ▼         ▼           ▼   │
                              │    Done    Analyzer     Member  │
                              │           .refine()  (Fix mode) │
                              │              │           │      │
                              │           Talk v2   Fixed Code  │
                              │              └─────►─────┘      │
                              └────────────────────────────────┘
```

**Roles:**

| Role | Responsibility |
|------|----------------|
| **Scanner** | Walks the codebase, classifies files by priority, filters to core files |
| **Analyzer** | Reads source code, produces chapter-based `.md` descriptions |
| **Member** | Generates code from the description (round 1: from scratch; round 2+: fix mode) |
| **Comparator** | Compares original vs generated code, scores across 5 dimensions, writes diff report |
| **Refiner** | Improves the description based on the diff report |

## Install

```bash
npm install -g show-me-the-talk
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or a compatible CLI (e.g., `cfuse`, `codex`) installed and authenticated.

## Usage

```bash
# Analyze a codebase (core-only mode, default)
smtt analyze /path/to/project

# Full mode (all files, slower)
smtt analyze /path/to/project --full

# Use a different CLI
smtt analyze /path/to/project --cli cfuse

# Custom threshold and rounds
smtt analyze /path/to/project --threshold 80 --max-rounds 10

# Resume a previous session
smtt analyze /path/to/project --resume ./output/2026-04-07T05-51-58
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--cli <name>` | `claude` | CLI command to use |
| `--max-rounds <n>` | `5` | Maximum iteration rounds |
| `--threshold <n>` | `70` | Pass threshold (0-100) |
| `--timeout <ms>` | `1800000` | Member execution timeout (30min) |
| `--output <dir>` | `./output` | Output directory |
| `--model <id>` | - | Model for Analyzer/Comparator |
| `--full` | `false` | Full mode (all files, not just core) |
| `--keep-generated` | `false` | Keep all rounds' generated code |
| `--verbose` | `false` | Show per-dimension scores |
| `--resume <dir>` | - | Resume from existing session |

## Output

Each session creates a timestamped directory under `./output/`:

```
output/2026-04-07T05-51-58/
  talk-v1/              # Natural language description (chapter .md files)
  talk-v2/              # Refined description
  rounds/
    round-1/
      member-prompt.md  # Prompt sent to member
      member.log        # Member execution log
      generated-code/   # Code generated from description
      diff-report.md    # Detailed comparison report
      scores.json       # Dimension scores
      comparison.json   # Round result
    round-2/
      ...
  report.json           # Final summary
```

## Scoring Dimensions

**Core-only mode** (default):

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Tech Stack | /25 | Dependencies, versions, framework choices |
| Project Structure | /20 | Directory layout, file organization |
| Core Logic | /25 | Implementation equivalence |
| Data Flow | /20 | Module connections, data passing |
| Entry Points | /10 | CLI interface, entry files |

**Full mode** (`--full`):

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Project Structure | /20 | Directory layout, file naming |
| Core Logic | /20 | Functionality equivalence |
| Data Flow | /20 | Module call relationships |
| Tech Choices | /20 | Framework and library selection |
| Edge Cases | /20 | Error handling, config coverage |

## Development

```bash
git clone https://github.com/lesszyao/show-me-the-talk.git
cd show-me-the-talk
npm install
npm run build
```

## License

[MIT](LICENSE)
