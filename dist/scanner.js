import * as fs from "node:fs";
import * as path from "node:path";
const DEFAULT_IGNORE = [
    "node_modules",
    "dist",
    "build",
    ".git",
    ".next",
    ".nuxt",
    "coverage",
    "__pycache__",
    ".cache",
    ".turbo",
];
const BINARY_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".bz2",
    ".pdf", ".doc", ".docx",
    ".mp3", ".mp4", ".avi", ".mov",
    ".exe", ".dll", ".so", ".dylib",
    ".db", ".sqlite",
]);
const LOCK_FILES = new Set([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "Gemfile.lock",
    "poetry.lock",
    "Cargo.lock",
    "go.sum",
]);
const ENTRY_PATTERNS = [
    /^index\.[jt]sx?$/,
    /^main\.[jt]sx?$/,
    /^app\.[jt]sx?$/,
    /^server\.[jt]sx?$/,
    /^cli\.[jt]sx?$/,
];
const CORE_PATTERNS = [
    /^src\//,
    /^lib\//,
    /^app\//,
];
const TEST_PATTERNS = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /^__tests__\//,
    /^tests?\//,
];
function parseGitignore(targetDir) {
    const gitignorePath = path.join(targetDir, ".gitignore");
    if (!fs.existsSync(gitignorePath))
        return [];
    const content = fs.readFileSync(gitignorePath, "utf-8");
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
}
function shouldIgnore(relativePath, ignorePatterns) {
    const parts = relativePath.split(path.sep);
    for (const part of parts) {
        if (DEFAULT_IGNORE.includes(part))
            return true;
        if (part.startsWith(".") && part !== ".")
            return true;
    }
    const basename = path.basename(relativePath);
    if (LOCK_FILES.has(basename))
        return true;
    if (BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase()))
        return true;
    for (const pattern of ignorePatterns) {
        const clean = pattern.replace(/\/$/, "");
        if (parts.includes(clean))
            return true;
        if (basename === clean)
            return true;
        if (clean.startsWith("*") && basename.endsWith(clean.slice(1)))
            return true;
    }
    return false;
}
function getPriority(relativePath) {
    const basename = path.basename(relativePath);
    if (basename === "package.json" || basename === "tsconfig.json")
        return 0;
    for (const pattern of ENTRY_PATTERNS) {
        if (pattern.test(basename))
            return 1;
    }
    const inSrc = CORE_PATTERNS.some((p) => p.test(relativePath));
    for (const pattern of TEST_PATTERNS) {
        if (pattern.test(relativePath) || pattern.test(basename))
            return inSrc ? 4 : 5;
    }
    if (inSrc)
        return 2;
    return 3;
}
function walkDir(dir, baseDir, ignorePatterns) {
    const entries = [];
    let items;
    try {
        items = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return entries;
    }
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(baseDir, fullPath);
        if (shouldIgnore(relativePath, ignorePatterns))
            continue;
        if (item.isDirectory()) {
            entries.push(...walkDir(fullPath, baseDir, ignorePatterns));
        }
        else if (item.isFile()) {
            entries.push({
                relativePath,
                priority: getPriority(relativePath),
            });
        }
    }
    return entries;
}
function extractMetadata(targetDir) {
    const metadata = {};
    const pkgPath = path.join(targetDir, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            metadata.name = pkg.name;
            metadata.description = pkg.description;
            metadata.dependencies = pkg.dependencies;
            metadata.devDependencies = pkg.devDependencies;
            metadata.scripts = pkg.scripts;
            metadata.entryPoint = pkg.main || pkg.module;
        }
        catch {
            // Skip malformed package.json
        }
    }
    const tsconfigPath = path.join(targetDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
        try {
            const raw = fs.readFileSync(tsconfigPath, "utf-8");
            const stripped = raw.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
            metadata.tsconfig = JSON.parse(stripped);
        }
        catch {
            // Skip malformed tsconfig
        }
    }
    return metadata;
}
/** Directories to exclude in core-only mode */
const PERIPHERAL_DIRS = new Set([
    "public", "static", "assets", "images", "img", "icons",
    "docs", "doc", "documentation",
    "test", "tests", "__tests__", "e2e", "cypress",
    "fixtures", "mocks", "__mocks__",
    ".github", ".circleci", ".husky",
    "scripts", "examples", "samples",
]);
/** Extensions to exclude in core-only mode */
const PERIPHERAL_EXTENSIONS = new Set([
    ".md", ".txt", ".rst",
    ".css", ".scss", ".less", ".sass", ".styl",
    ".json", // except package.json/tsconfig.json (handled separately)
    ".yaml", ".yml", ".toml",
    ".env", ".env.example",
    ".sh", ".bat", ".cmd",
]);
/** Files to always include in core-only mode */
const CORE_KEEP_FILES = new Set([
    "package.json",
    "tsconfig.json",
    "vite.config.js", "vite.config.ts",
    "webpack.config.js", "webpack.config.ts",
    "next.config.js", "next.config.ts", "next.config.mjs",
    "nuxt.config.js", "nuxt.config.ts",
    "rollup.config.js", "rollup.config.ts",
]);
/** Source code extensions to include in core-only mode */
const SOURCE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".hpp", ".cs",
    ".rb", ".php", ".vue", ".svelte",
]);
/** Filter scan result to core source files only */
export function getCoreFiles(scanResult) {
    const coreFiles = scanResult.files.filter((f) => {
        // Always exclude tests (priority 4-5)
        if (f.priority >= 4)
            return false;
        const basename = path.basename(f.relativePath);
        const ext = path.extname(f.relativePath).toLowerCase();
        const parts = f.relativePath.split(path.sep);
        // Always include whitelisted config files
        if (CORE_KEEP_FILES.has(basename))
            return true;
        // Exclude files in peripheral directories
        if (parts.some((p) => PERIPHERAL_DIRS.has(p)))
            return false;
        // Exclude peripheral extensions
        if (PERIPHERAL_EXTENSIONS.has(ext))
            return false;
        // Include source code files
        if (SOURCE_EXTENSIONS.has(ext))
            return true;
        // Include extensionless files at root (entry points like Makefile, Dockerfile)
        if (!ext && parts.length === 1)
            return true;
        return false;
    });
    return {
        files: coreFiles,
        metadata: scanResult.metadata,
        fileCount: coreFiles.length,
    };
}
export function scan(targetDir) {
    const absDir = path.resolve(targetDir);
    if (!fs.existsSync(absDir)) {
        throw new Error(`Target directory does not exist: ${absDir}`);
    }
    if (!fs.statSync(absDir).isDirectory()) {
        throw new Error(`Target path is not a directory: ${absDir}`);
    }
    const ignorePatterns = parseGitignore(absDir);
    const files = walkDir(absDir, absDir, ignorePatterns);
    // Sort by priority (lower = higher priority)
    files.sort((a, b) => a.priority - b.priority);
    const metadata = extractMetadata(absDir);
    return {
        files,
        metadata,
        fileCount: files.length,
    };
}
//# sourceMappingURL=scanner.js.map