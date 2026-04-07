# Show Me The Talk

Reverse-engineer natural language descriptions from codebases and validate them through code generation.

SMTT analyzes a codebase, produces a detailed natural-language description ("talk"), then validates it by having an AI regenerate the code from that description alone. A comparator scores the structural equivalence, and the process iterates until the description is accurate enough.

## Architecture

![smtt Architecture](imgs/smtt-architecture-flowchart.png)

### Pipeline

1. **Scanner** — Walks the codebase, classifies files by priority, extracts metadata
2. **Core Filter** — Filters to core source files (excludes tests, docs, assets, vendor)
3. **AI Select** — When core files exceed 80, AI selects the most important files
4. **Analyzer** — Reads source code, produces chapter-based `.md` descriptions ("Talk")
5. **Skeleton** — Generates project skeleton: type definitions, interfaces, function stubs + `groups.json` for module grouping
6. **Parallel Members** — Each module group is implemented independently in parallel by separate CLI subprocesses
7. **Merge** — Combines skeleton base + group implementations into a complete codebase
8. **Comparator** — Compares original vs generated code, scores across 5 dimensions (0-100), writes diff report
9. **Decision** — If score >= threshold: done. Otherwise: Analyzer refines the Talk, and parallel members re-run with fix context

### Roles

| Role | Responsibility |
|------|----------------|
| **Scanner** | Walks the codebase, classifies files by priority, filters to core files |
| **Analyzer** | Reads source code, produces chapter-based `.md` descriptions; refines based on diff reports |
| **Skeleton** | Generates project structure with type definitions, interfaces, and function stubs; partitions files into implementation groups |
| **Members** | Implement code from the description in parallel by module group (round 1: from scratch; round 2+: fix mode with diff report) |
| **Comparator** | Compares original vs generated code, scores across 5 dimensions, writes diff report |

## Install

```bash
npm install -g show-me-the-talk
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or a compatible CLI (e.g., `codex`) installed and authenticated.

## Usage

```bash
# Analyze a codebase (core-only mode, default)
smtt analyze /path/to/project

# Full mode (all files, slower)
smtt analyze /path/to/project --full

# Use a different CLI
smtt analyze /path/to/project --cli codex

# Custom threshold and rounds
smtt analyze /path/to/project --threshold 80 --max-rounds 10

# Resume a previous session
smtt analyze /path/to/project --resume ./.smtt/2026-04-07T05-51-58
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--cli <name>` | `claude` | CLI command to use |
| `--max-rounds <n>` | `5` | Maximum iteration rounds |
| `--threshold <n>` | `70` | Pass threshold (0-100) |
| `--timeout <ms>` | `1800000` | Member execution timeout (30min) |
| `--output <dir>` | `./.smtt` | Output directory |
| `--model <id>` | - | Model for Analyzer/Comparator |
| `--full` | `false` | Full mode (all files, not just core) |
| `--keep-generated` | `false` | Keep all rounds' generated code |
| `--verbose` | `false` | Show per-dimension scores |
| `--resume <dir>` | - | Resume from existing session |

## Output

Each session creates a timestamped directory under `./output/`:

```
.smtt/2026-04-07T05-51-58/
  workspace/
    talk/
      v1/                # Talk chapters (01-项目概述.md, 02-技术栈.md, ...)
      v2/                # Refined talk
    skeleton/            # Project skeleton (types, interfaces, stubs)
    generated/
      group-round-1/
        group-core/      # Parallel group implementations
        group-api/
        ...
    merged/              # Skeleton + group overlays combined
    logs/                # All CLI prompts and output logs
    reports/
      round-1/
        diff-report.md   # Detailed comparison report
        scores.json      # Dimension scores
    context/
      selected-files.json # AI-selected core files (if applicable)
  rounds/
    round-1/
      generated-code/    # Snapshot of generated code
      comparison.json    # Round result
  report.json            # Final summary
  talk-final.md          # Best talk as single file
  talk-final/            # Best talk chapters
  talk-final.html        # HTML preview (auto-opens in browser)
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
