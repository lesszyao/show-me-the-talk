import type { ScanResult } from "./types.js";
export declare const MAX_CORE_FILES = 80;
/** Filter scan result to core source files only */
export declare function getCoreFiles(scanResult: ScanResult): ScanResult;
/**
 * Use AI to select the most important core files from a large file list.
 * Falls back to simple truncation if AI call fails.
 */
export declare function selectCoreFiles(scanResult: ScanResult, targetDir: string, cli: string, model?: string, logDir?: string): Promise<ScanResult>;
export declare function scan(targetDir: string): ScanResult;
