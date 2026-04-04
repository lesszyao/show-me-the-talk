import { runCli } from "./claude-cli.js";
import type { ScanResult, SmttOptions, Talk } from "./types.js";

const SYSTEM_PROMPT = `你是一名资深软件架构师。你的任务是分析当前工作目录下的代码库，生成一份纯自然语言的项目描述（"talk"）。

这份描述必须足够详细，让一个完全没有上下文的开发者仅凭描述就能重建出结构等价的代码库。

规则：
- 必须使用简体中文
- 禁止包含任何代码片段、函数签名或 import 语句
- 只使用自然语言描述
- 明确说明目录结构、文件命名规范和模块组织方式
- 描述每个模块的职责及其与其他模块的接口
- 解释模块间的数据流
- 覆盖关键业务逻辑、算法和决策点
- 提及具体的技术选型（框架、库、语言特性）
- 包含 CLI 参数、配置选项和错误处理行为
- 描述边界情况和异常处理`;

const REFINE_SYSTEM = `你是一名资深软件架构师，正在根据对比反馈来改进项目描述。

你之前的描述被另一个开发者用来重建代码库，对比发现了差距。
请改进描述以解决反馈中指出的问题，保持纯自然语言（不要包含代码片段）。`;

function formatFileList(files: ScanResult["files"]): string {
  return files.map((f) => `  - ${f.relativePath}`).join("\n");
}

function formatMetadata(metadata: ScanResult["metadata"]): string {
  const parts: string[] = [];
  if (metadata.name) parts.push(`项目名称: ${metadata.name}`);
  if (metadata.description) parts.push(`描述: ${metadata.description}`);
  if (metadata.dependencies) {
    parts.push(`依赖: ${Object.keys(metadata.dependencies).join(", ")}`);
  }
  if (metadata.devDependencies) {
    parts.push(`开发依赖: ${Object.keys(metadata.devDependencies).join(", ")}`);
  }
  return parts.join("\n") || "无元数据";
}

export class Analyzer {
  private cli: string;
  private model?: string;

  constructor(cli: string, model?: string) {
    this.cli = cli;
    this.model = model;
  }

  async generate(targetDir: string, scanResult: ScanResult): Promise<Talk> {
    const prompt = `请分析当前工作目录下的代码库，生成一份完整的自然语言项目描述。

项目基本信息：
${formatMetadata(scanResult.metadata)}

项目包含以下文件：
${formatFileList(scanResult.files)}

请使用 Read、Glob 等工具自行读取这些文件的内容，然后生成描述。

描述需要覆盖：
1. 项目目的和高层架构
2. 技术栈和构建配置
3. 目录结构和文件命名规范
4. 每个模块的职责和接口
5. 模块间的数据流
6. 关键业务逻辑的自然语言描述
7. CLI 接口、参数和选项
8. 错误处理策略
9. 配置和默认值

记住：不要包含代码片段，纯自然语言。`;

    const content = await runCli({
      cli: this.cli,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      model: this.model,
      cwd: targetDir,
    });

    return {
      version: 1,
      content,
      generatedAt: new Date().toISOString(),
    };
  }

  async refine(targetDir: string, talk: Talk, feedback: string): Promise<Talk> {
    const prompt = `当前的项目描述（第 ${talk.version} 版）如下：

---
${talk.content}
---

对比反馈如下：

${feedback}

请使用 Read、Glob 等工具重新阅读当前工作目录下的代码，然后根据反馈改进描述。
重点关注生成代码与原始代码差异最大的部分。
保持纯自然语言，不要包含代码片段。`;

    const content = await runCli({
      cli: this.cli,
      prompt,
      systemPrompt: REFINE_SYSTEM,
      model: this.model,
      cwd: targetDir,
    });

    return {
      version: talk.version + 1,
      content,
      generatedAt: new Date().toISOString(),
    };
  }
}
