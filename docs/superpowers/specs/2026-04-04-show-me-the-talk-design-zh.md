# show-me-the-talk 设计文档

**日期：** 2026-04-04
**状态：** 实现完成

## 问题

随着 vibe coding 的普及，越来越多的代码通过自然语言生成。给定一个代码库，我们需要逆向工程出能够复现它的自然语言描述。逆向工程生成的描述必须经过验证：一个没有任何上下文的全新 CLI agent 应该能仅凭描述写出结构等价的代码。

## 目标

1. 读取代码库，生成纯自然语言的项目描述（"talk"）
2. 通过隔离的 CLI agent 从 talk 生成代码来验证 talk 的完整性
3. 迭代优化，直到生成代码与原始代码结构相似
4. 输出最终的已验证 talk 和详细的验证报告

## 非目标

- 生成完全相同的代码（结构/功能等价即可）
- 支持非 CLI 的验证后端
- 并行验证（未来增强）

## 核心设计理念：工作空间模式

所有 CLI 调用均采用**工作空间模式**运行，而非将代码内容塞入 prompt：

- **Analyzer**：将 `cwd` 设为目标代码库目录，只传短 prompt（含文件列表），CLI 自行用 Read/Glob 工具读取代码
- **Member**：将 `cwd` 设为临时目录，CLI 在该目录中直接创建文件
- **Comparator**：将 `cwd` 设为原始代码库目录，通过 `--add-dir` 授权访问生成代码目录，CLI 自行对比两边

这样做的好处：
- 避免命令行参数长度限制
- 不受 prompt 上下文窗口限制
- CLI 可以按需读取文件，比全量灌入 prompt 更高效

## 架构

```
smtt analyze <target-dir> [options]

┌──────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│ Scanner  │───>│ Analyzer │───>│  Verifier  │───>│ Reporter │
│          │    │          │<───│  (Loop)    │    │          │
└──────────┘    └──────────┘    └────────────┘    └──────────┘
                     │               │
                     ▼               ▼
              CLI 子进程          CLI 子进程
              cwd=目标目录        cwd=临时目录
            (代码 → talk)       (talk → 代码)
                                     │
                                     ▼
                              CLI 子进程
                              cwd=目标目录
                              --add-dir=临时目录
                              (对比打分)
```

### 模块一览

| 模块 | 文件 | 职责 |
|------|------|------|
| CLI | `src/cli.ts` | 入口，参数解析，预检 |
| CLI Runner | `src/claude-cli.ts` | 统一的 CLI 子进程调用封装（支持 cwd、--add-dir、stdin、重试） |
| Scanner | `src/scanner.ts` | 遍历目标目录，提取文件列表和项目元数据（不读取文件内容） |
| Analyzer | `src/analyzer.ts` | 调用 CLI 在目标目录工作空间中生成/优化 talk |
| Member | `src/member.ts` | 在隔离临时目录中启动 CLI 子进程，从 talk 生成代码 |
| Comparator | `src/comparator.ts` | 调用 CLI 对比原始代码与生成代码，产出分数和反馈 |
| Verifier | `src/verifier.ts` | 编排 生成 → 验证 → 优化 循环 |
| Reporter | `src/reporter.ts` | 将 talk、比较结果和报告写入输出目录 |
| Types | `src/types.ts` | 共享类型定义 |

## 数据流

### 单轮流程

```
第 N 轮:

  Analyzer ──talk v(N)──> Member (CLI 在临时目录) ──生成代码──> Comparator
     ^                                                              │
     └──────────────────────反馈 + 分数───────────────────────────┘
```

1. Analyzer 在目标目录的工作空间中运行 CLI，生成 talk（首轮为 v1，后续轮为优化版）
2. Member 在全新的临时目录中执行 CLI，仅以 talk 内容作为 prompt
3. Comparator 在目标目录中运行 CLI，通过 `--add-dir` 访问生成代码目录，打分并生成反馈
4. 若分数 >= 阈值：完成。否则 Analyzer 根据反馈优化 talk

### 迭代控制

```
scanResult = scanner.scan(targetDir)    // 仅收集文件列表
talk = analyzer.generate(targetDir, scanResult)

for round in 1..maxRounds:
    tmpDir = mkdtemp()
    member.execute(talk, tmpDir)       // CLI 以 cwd=tmpDir 运行
    score, feedback = comparator.compare(targetDir, tmpDir)
    results.push({ round, talk, score, feedback })

    if score >= threshold:
        break

    talk = analyzer.refine(targetDir, talk, feedback)

return max(results, by: score)
```

- 最大轮数：可配置，默认 5
- 通过阈值：可配置，默认 70
- 达到最大轮数仍未通过时：选择分数最高的轮次

## 核心类型

```typescript
interface Talk {
  version: number;
  content: string;        // 纯自然语言，无代码片段，中文
  generatedAt: string;
}

interface RoundResult {
  round: number;
  talk: Talk;
  generatedDir: string;
  score: number;          // 0-100
  feedback: string;
  dimensions: DimensionScores;
  duration: number;       // 毫秒
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

interface FileEntry {
  relativePath: string;       // 仅路径，不含文件内容
  priority: number;
}

interface ScanResult {
  files: FileEntry[];
  metadata: ProjectMetadata;
  fileCount: number;
}
```

## Scanner 策略

1. 遍历目标目录，解析 `.gitignore`
2. 过滤：`node_modules`、`dist`、`.git`、二进制文件、lock 文件、以 `.` 开头的隐藏目录
3. 按优先级排序文件（仅路径，不读内容）：
   - 配置文件（package.json, tsconfig.json）> 入口文件 > 核心模块 > 普通文件 > 测试文件
4. 从 `package.json`、`tsconfig.json` 提取项目元数据

## Analyzer Prompt 策略

Analyzer 不再将代码内容塞入 prompt，而是：
1. 将 CLI 的 `cwd` 设为目标目录
2. Prompt 中仅包含文件列表和元数据摘要
3. 通过 `--system-prompt` 传递角色设定
4. CLI 自行使用 Read、Glob 等工具探索代码库

生成的 talk 要求：
- 使用简体中文
- 描述项目目的、技术栈、目录规范
- 说明每个模块的职责和接口
- 解释模块间的数据流
- 覆盖关键业务逻辑
- 禁止包含代码片段

优化 prompt 同理：CLI 在目标目录工作空间中运行，可以重新阅读代码来改进描述。

## Comparator 评分

五个维度，每个 0-20 分，总计 0-100：

| 维度 | 评判标准 |
|------|---------|
| 项目结构 | 目录布局、文件命名、模块组织 |
| 核心逻辑 | 主要功能实现方式的等价性 |
| 数据流 | 模块间调用关系、数据传递模式 |
| 技术选型 | 框架、库、语言特性选择 |
| 边界情况 | 错误处理、配置、CLI 参数覆盖度 |

通过阈值：**>= 70** 分通过。低于 70 分：反馈驱动下一轮优化。

Comparator 运行方式：
- `cwd` = 原始代码目录
- `--add-dir` = 生成代码目录
- CLI 自行读取两边文件进行对比

## CLI Runner（claude-cli.ts）

所有模块共用的 CLI 调用封装：

```typescript
interface CliRunOptions {
  cli: string;            // 可执行命令（claude、cfuse、codex 等）
  prompt: string;         // 通过 stdin 传递
  systemPrompt?: string;  // 通过 --system-prompt 传递
  model?: string;         // 通过 --model 传递
  cwd?: string;           // 工作目录
  addDirs?: string[];     // 通过 --add-dir 传递
  timeout?: number;       // 默认 600000ms
  maxRetries?: number;    // 默认 3 次，指数退避
}
```

关键设计：
- Prompt 通过 stdin 管道传递，避免命令行参数长度限制
- 支持任意 CLI 命令，不硬编码 claude/codex
- 失败自动重试 3 次，指数退避

## Member 执行

```bash
<cli> -p \
  --allowedTools Edit,Write,Bash,Glob \
  --dangerously-skip-permissions \
  < prompt_via_stdin
# cwd = /tmp/smtt-member-xxxx
```

- 每轮：新进程 + 新临时目录（完全隔离）
- Prompt 通过 stdin 传入
- 超时：默认 10 分钟（可配置）
- 超时处理：SIGTERM，该轮得 0 分，继续下一轮
- CLI 可配置：`claude`（默认）、`cfuse`、`codex` 或任意命令
- stdout/stderr 记录到 `output/rounds/round-N/member.log`

## CLI 接口

```bash
smtt analyze <target-dir> [options]

Options:
  --max-rounds <n>        最大迭代轮数（默认: 5）
  --threshold <n>         通过阈值 0-100（默认: 70）
  --cli <name>            CLI 命令（默认: claude，可用 cfuse、codex 等）
  --timeout <ms>          Member 执行超时（默认: 600000）
  --output <dir>          输出目录（默认: ./output）
  --keep-generated        保留所有轮次的生成代码（默认仅保留最佳）
  --model <id>            Analyzer/Comparator 使用的模型
  --verbose               详细日志
```

## 输出结构

```
output/
└── 2026-04-04T10-30-00/
    ├── talk-v1.md
    ├── talk-v2.md
    ├── talk-final.md           # 最佳版本
    ├── report.json             # 完整 AnalysisReport
    └── rounds/
        ├── round-1/
        │   ├── member.log
        │   ├── generated/      # Member 生成的代码
        │   └── comparison.json
        └── round-2/
            └── ...
```

## 依赖

| 包 | 用途 |
|---|------|
| `commander` | CLI 参数解析 |
| `ora` | 进度动画 |
| `chalk` | 彩色终端输出 |

**无 SDK 依赖**：所有 LLM 调用均通过 CLI 子进程，不直接使用 `@anthropic-ai/sdk`。

构建：`tsc` 用于生产，`tsx` 用于开发。无打包器。

## 错误处理

| 场景 | 行为 |
|------|------|
| 目标 CLI 未安装 | 预检，明确错误提示 |
| 目标目录为空/无效 | 预检，明确错误提示 |
| Member 超时 | SIGTERM 终止，该轮 0 分，继续下一轮 |
| CLI 调用失败 | 重试 3 次（指数退避），然后报错退出 |
| Comparator 返回无效 JSON | 捕获异常，该轮 0 分 |

## 与初版设计的主要变更

| 项目 | 初版 | 当前实现 |
|------|------|---------|
| LLM 调用方式 | `@anthropic-ai/sdk` 直连 API | CLI 子进程（`-p` 模式） |
| Prompt 传递 | 命令行参数 | stdin 管道 |
| 代码传递给 Analyzer | Scanner 读取文件内容塞入 prompt | 工作空间模式，CLI 自行读取 |
| 代码传递给 Comparator | 两份代码全量塞入 prompt | `cwd` + `--add-dir`，CLI 自行读取 |
| Scanner 职责 | 读取文件内容 + 排序 | 仅收集文件路径 + 元数据 |
| CLI 支持 | 硬编码 claude/codex | 支持任意命令 |
| Talk 语言 | 英文 | 简体中文 |
| API Key 检查 | 预检 ANTHROPIC_API_KEY | 不检查（CLI 自行处理认证） |

## 未来增强（不在 MVP 范围）

- 并行 Member 执行（基于 tmux）
- 文件级粒度模式（逐模块逆向，再组合）
- Web UI 浏览 talk 版本和对比报告
- 支持更多 CLI 后端
