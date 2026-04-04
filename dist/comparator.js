import { runCli } from "./claude-cli.js";
const SYSTEM_PROMPT = `You are a code comparison expert. You have access to two codebases:
1. The ORIGINAL codebase in your current working directory
2. The GENERATED codebase in an additional directory (provided via --add-dir)

Use Read, Glob, and Grep tools to examine both codebases, then score their structural similarity.

Score across 5 dimensions, each 0-20 (total 0-100):

1. Project Structure (0-20): Directory layout, file naming, module organization
2. Core Logic (0-20): Main feature implementation approach equivalence
3. Data Flow (0-20): Inter-module call relationships, data passing patterns
4. Tech Choices (0-20): Framework, library, language feature selection
5. Edge Cases (0-20): Error handling, configuration, CLI arguments coverage

Your final output MUST be EXACTLY this JSON format (no other text before or after):
{
  "projectStructure": <number>,
  "coreLogic": <number>,
  "dataFlow": <number>,
  "techChoices": <number>,
  "edgeCases": <number>,
  "feedback": "<detailed feedback on gaps and differences, in Chinese>"
}`;
export class Comparator {
    cli;
    model;
    constructor(cli, model) {
        this.cli = cli;
        this.model = model;
    }
    async compare(originalDir, generatedDir) {
        const prompt = `请对比两个代码库的结构等价性。

当前工作目录是原始代码库。
生成的代码库在: ${generatedDir}

请使用 Read、Glob、Grep 工具分别检查两个目录下的文件，然后按照 5 个维度打分。
在 feedback 中用中文具体说明缺失或不同之处，以便改进项目描述。

只输出 JSON 结果，不要输出其他文字。`;
        try {
            const output = await runCli({
                cli: this.cli,
                prompt,
                systemPrompt: SYSTEM_PROMPT,
                model: this.model,
                cwd: originalDir,
                addDirs: [generatedDir],
            });
            return this.parseResponse(output);
        }
        catch {
            // If CLI fails, return score 0
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
            };
        }
    }
    parseResponse(text) {
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
        const dimensions = {
            projectStructure: this.clamp(parsed.projectStructure, 0, 20),
            coreLogic: this.clamp(parsed.coreLogic, 0, 20),
            dataFlow: this.clamp(parsed.dataFlow, 0, 20),
            techChoices: this.clamp(parsed.techChoices, 0, 20),
            edgeCases: this.clamp(parsed.edgeCases, 0, 20),
        };
        const score = dimensions.projectStructure +
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
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number(value) || 0));
    }
}
//# sourceMappingURL=comparator.js.map