import type { ScanResult } from "./types.js";
/** Filter scan result to core source files only */
export declare function getCoreFiles(scanResult: ScanResult): ScanResult;
export declare function scan(targetDir: string): ScanResult;
