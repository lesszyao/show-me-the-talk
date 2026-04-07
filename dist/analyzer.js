import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "./claude-cli.js";
const ROLE_CONTEXT = `你是一名资深软件架构师。你的任务是分析代码库，生成一份纯自然语言的项目描述（"talk"）。

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
const REFINE_CONTEXT = `你是一名资深软件架构师，正在根据对比反馈来改进项目描述。

你之前的描述被另一个开发者用来重建代码库，对比发现了差距。
请改进描述以解决反馈中指出的问题，保持纯自然语言（不要包含代码片段）。`;
function formatFileList(files) {
    return files.map((f) => `  - ${f.relativePath}`).join("\n");
}
function formatMetadata(metadata) {
    const parts = [];
    if (metadata.name)
        parts.push(`项目名称: ${metadata.name}`);
    if (metadata.description)
        parts.push(`描述: ${metadata.description}`);
    if (metadata.dependencies) {
        parts.push(`依赖: ${Object.keys(metadata.dependencies).join(", ")}`);
    }
    if (metadata.devDependencies) {
        parts.push(`开发依赖: ${Object.keys(metadata.devDependencies).join(", ")}`);
    }
    return parts.join("\n") || "无元数据";
}
/** Read all .md files from a directory, sort by name, concatenate */
export function readTalkFiles(dir) {
    if (!fs.existsSync(dir))
        return "";
    const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort();
    if (files.length === 0)
        return "";
    return files
        .map((f) => fs.readFileSync(path.join(dir, f), "utf-8"))
        .join("\n\n");
}
export class Analyzer {
    cli;
    model;
    constructor(cli, model) {
        this.cli = cli;
        this.model = model;
    }
    async generate(targetDir, scanResult, coreOnly = false) {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "smtt-talk-"));
        const coreOnlyInstruction = coreOnly
            ? `\n注意：本次分析采用 core-only 模式。请重点描述：
- 核心源码模块（src/、lib/ 下的主要文件）
- 技术栈和依赖（package.json 中的 dependencies）
- 核心数据流和模块间调用关系
- 入口文件和 CLI 接口

可以略写或跳过：
- 测试文件和测试配置
- 文档文件（README、*.md）
- 静态资源（图片、字体、CSS/SCSS）
- CI/CD 配置（.github/、.circleci/）
- 示例和 fixture 文件\n`
            : "";
        const prompt = `${ROLE_CONTEXT}

请分析当前工作目录下的代码库，生成一份完整的自然语言项目描述。
${coreOnlyInstruction}
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

输出方式（二选一，推荐方式一）：
方式一（推荐）：将描述按章节写入以下目录中的 .md 文件：${outputDir}
  - 每个章节一个文件，按编号命名，例如：01-项目概述.md、02-技术栈.md、03-目录结构.md 等
  - 使用 Write 工具写入，可以边分析边写入
方式二：如果无法写入文件，则直接在回复中输出完整描述全文（不要只输出总结）

不要包含代码片段，纯自然语言。`;
        const stdout = await runCli({
            cli: this.cli,
            prompt,
            model: this.model,
            cwd: targetDir,
            dangerouslySkipPermissions: true,
            allowEmptyOutput: true,
            logDir: outputDir,
            logLabel: "analyzer-generate",
        });
        // Prefer file-based output, fall back to stdout
        const fileContent = readTalkFiles(outputDir);
        const content = fileContent || stdout;
        if (!content) {
            throw new Error(`Analyzer produced no output. Output dir: ${outputDir}, stdout length: ${stdout.length}`);
        }
        if (fileContent) {
            console.log(`  [analyzer] Output: ${fs.readdirSync(outputDir).filter(f => f.endsWith(".md")).length} files in ${outputDir}`);
        }
        else {
            console.log(`  [analyzer] Output: stdout (${stdout.length} chars, no files written)`);
        }
        return {
            version: 1,
            content,
            contentDir: fileContent ? outputDir : "",
            generatedAt: new Date().toISOString(),
        };
    }
    async refine(targetDir, talk, reportPath, coreOnly = false) {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "smtt-talk-"));
        const absTarget = path.resolve(targetDir);
        const prevDir = talk.contentDir;
        const addDirs = [absTarget];
        if (prevDir && fs.existsSync(prevDir)) {
            addDirs.push(prevDir);
        }
        if (reportPath && fs.existsSync(path.dirname(reportPath))) {
            addDirs.push(path.dirname(reportPath));
        }
        const reportInstruction = reportPath
            ? `差异报告文件在：${reportPath}\n请用 Read 工具读取这份报告，了解上一轮生成代码与原始代码的具体差异。`
            : "";
        const prevInstruction = prevDir
            ? `当前的项目描述文件在目录：${prevDir}\n请先用 Read 工具读取该目录下的所有 .md 文件，了解当前描述内容。`
            : `当前的项目描述（第 ${talk.version} 版）如下：\n\n---\n${talk.content}\n---`;
        const coreOnlyInstruction = coreOnly
            ? `\n注意：本次采用 core-only 模式，只关注核心源码和技术栈。忽略测试、文档、静态资源等方面的差异。\n`
            : "";
        const prompt = `${REFINE_CONTEXT}

${prevInstruction}

${reportInstruction}

代码库位于：${absTarget}
${coreOnlyInstruction}
请根据差异报告中指出的问题改进描述。重点关注：
- 报告中标注的缺失模块或文件
- 实现方式描述不准确的地方
- 技术选型、配置等细节的遗漏

输出方式（二选一，推荐方式一）：
方式一（推荐）：将改进后的描述按章节写入当前工作目录下的 .md 文件
  - 每个章节一个文件，按编号命名，例如：01-项目概述.md、02-技术栈.md、03-目录结构.md 等
  - 使用 Write 工具写入，可以边分析边写入
方式二：如果无法写入文件，则直接在回复中输出改进后的完整描述全文（不要只输出总结）

不要包含代码片段，纯自然语言。`;
        const stdout = await runCli({
            cli: this.cli,
            prompt,
            model: this.model,
            cwd: outputDir,
            addDirs,
            dangerouslySkipPermissions: true,
            allowEmptyOutput: true,
            logDir: outputDir,
            logLabel: "analyzer-refine",
        });
        const fileContent = readTalkFiles(outputDir);
        const content = fileContent || stdout;
        if (!content) {
            throw new Error(`Analyzer refine produced no output. Output dir: ${outputDir}, stdout length: ${stdout.length}`);
        }
        if (fileContent) {
            console.log(`  [analyzer] Refined: ${fs.readdirSync(outputDir).filter(f => f.endsWith(".md")).length} files in ${outputDir}`);
        }
        else {
            console.log(`  [analyzer] Refined: stdout (${stdout.length} chars, no files written)`);
        }
        return {
            version: talk.version + 1,
            content,
            contentDir: fileContent ? outputDir : "",
            generatedAt: new Date().toISOString(),
        };
    }
}
//# sourceMappingURL=analyzer.js.map