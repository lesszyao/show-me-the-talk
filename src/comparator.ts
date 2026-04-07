import * as fs from "node:fs";
import * as path from "node:path";
import { runCli } from "./claude-cli.js";
import type { ComparisonResult, DimensionScores } from "./types.js";

const COMPARE_CONTEXT = `你是一名代码对比专家。你可以访问两个代码库：
1. 原始代码库（通过 --add-dir 提供）
2. 生成的代码库（通过 --add-dir 提供）

使用 Read、Glob、Grep 工具检查两个代码库，然后评估它们的结构等价性。

按 5 个维度打分，每个维度 0-20 分（总分 0-100）：

1. Project Structure (0-20): 目录布局、文件命名、模块组织
2. Core Logic (0-20): 核心功能实现方式的等价性
3. Data Flow (0-20): 模块间调用关系、数据传递模式
4. Tech Choices (0-20): 框架、库、语言特性选择
5. Edge Cases (0-20): 错误处理、配置、CLI 参数覆盖度`;

const COMPARE_CONTEXT_CORE = `你是一名代码对比专家。你可以访问两个代码库：
1. 原始代码库（通过 --add-dir 提供）
2. 生成的代码库（通过 --add-dir 提供）

使用 Read、Glob、Grep 工具检查两个代码库，然后评估它们的核心源码等价性。

注意：本次采用 core-only 模式，只对比核心源码文件和技术栈。
跳过以下内容的对比：测试文件、文档、静态资源、CSS/样式、CI/CD 配置、示例代码。

按 5 个维度打分（总分 0-100）：

1. Tech Stack (0-25): package.json dependencies 是否一致，技术选型是否正确
2. Project Structure (0-20): 核心目录结构和文件组织（只看 src/、lib/ 等核心目录）
3. Core Logic (0-25): 核心模块的实现方式是否等价
4. Data Flow (0-20): 模块间调用关系和数据传递
5. Entry Points (0-10): 入口文件和 CLI 接口`;

export class Comparator {
  private cli: string;
  private model?: string;

  constructor(cli: string, model?: string) {
    this.cli = cli;
    this.model = model;
  }

  async compare(
    originalDir: string,
    generatedDir: string,
    reportDir: string,
    coreOnly = false,
  ): Promise<ComparisonResult> {
    const reportPath = path.join(reportDir, "diff-report.md");
    const absOriginal = path.resolve(originalDir);
    const absGenerated = path.resolve(generatedDir);

    const context = coreOnly ? COMPARE_CONTEXT_CORE : COMPARE_CONTEXT;

    const coreOnlyReportNote = coreOnly
      ? `\n注意：只对比核心源码文件和技术栈，跳过测试、文档、静态资源、样式等。\n`
      : "";

    const jsonFormat = coreOnly
      ? `{
  "techStack": <number 0-25>,
  "projectStructure": <number 0-20>,
  "coreLogic": <number 0-25>,
  "dataFlow": <number 0-20>,
  "entryPoints": <number 0-10>,
  "feedback": "<一句话总结主要差距>"
}`
      : `{
  "projectStructure": <number>,
  "coreLogic": <number>,
  "dataFlow": <number>,
  "techChoices": <number>,
  "edgeCases": <number>,
  "feedback": "<一句话总结主要差距>"
}`;

    const prompt = `${context}

请对比两个代码库的结构等价性。

原始代码库：${absOriginal}
生成的代码库：${absGenerated}

请使用 Read、Glob、Grep 工具分别检查两个目录下的文件。
${coreOnlyReportNote}
你需要完成两个任务：

任务一：写差异报告
请将详细的对比报告写入文件：${reportPath}
报告格式要求：
- 使用中文
- 按维度分章节，每个维度列出具体的差异点
- 对于每个差异，说明原始代码是什么样的，生成代码是什么样的（或缺失了什么）
- 给出改进建议：项目描述中应该如何修改才能让生成结果更接近原始代码
- 这份报告会用于指导下一轮的描述改进，所以要具体、可操作

任务二：输出 JSON 打分
在完成报告后，在回复中输出以下 JSON 格式的打分结果（不要输出其他文字）：
${jsonFormat}`;

    try {
      const output = await runCli({
        cli: this.cli,
        prompt,
        model: this.model,
        cwd: reportDir,
        addDirs: [absOriginal, absGenerated],
        dangerouslySkipPermissions: true,
        allowEmptyOutput: true,
        logDir: reportDir,
        logLabel: "comparator",
      });

      const result = this.parseResponse(output, coreOnly);

      // If model didn't write the report file, create one from feedback
      if (!fs.existsSync(reportPath) && result.feedback) {
        fs.writeFileSync(reportPath, `# 差异报告\n\n${result.feedback}\n`, "utf-8");
      }

      if (fs.existsSync(reportPath)) {
        console.log(`  [comparator] Diff report: ${reportPath}`);
      }

      return { ...result, reportPath: fs.existsSync(reportPath) ? reportPath : "" };
    } catch {
      return {
        score: 0,
        dimensions: {
          projectStructure: 0,
          coreLogic: 0,
          dataFlow: 0,
          techChoices: 0,
          edgeCases: 0,
        },
        feedback: "Comparator CLI failed. The generated code may be empty or inaccessible.",
        reportPath: "",
      };
    }
  }

  private parseResponse(text: string, coreOnly = false): Omit<ComparisonResult, "reportPath"> {
    let jsonStr = text.trim();

    // Extract JSON from markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Extract JSON object if surrounded by text
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      jsonStr = objMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    let dimensions: DimensionScores;
    if (coreOnly) {
      // Map core-only dimensions to DimensionScores fields
      dimensions = {
        projectStructure: this.clamp(parsed.projectStructure, 0, 20),
        coreLogic: this.clamp(parsed.coreLogic, 0, 25),
        dataFlow: this.clamp(parsed.dataFlow, 0, 20),
        techChoices: this.clamp(parsed.techStack, 0, 25),
        edgeCases: this.clamp(parsed.entryPoints, 0, 10),
      };
    } else {
      dimensions = {
        projectStructure: this.clamp(parsed.projectStructure, 0, 20),
        coreLogic: this.clamp(parsed.coreLogic, 0, 20),
        dataFlow: this.clamp(parsed.dataFlow, 0, 20),
        techChoices: this.clamp(parsed.techChoices, 0, 20),
        edgeCases: this.clamp(parsed.edgeCases, 0, 20),
      };
    }

    const score =
      dimensions.projectStructure +
      dimensions.coreLogic +
      dimensions.dataFlow +
      dimensions.techChoices +
      dimensions.edgeCases;

    return {
      score,
      dimensions,
      feedback: parsed.feedback || "",
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }
}
