export interface LogEntry {
  timestamp: string;
  type: 'assistant' | 'tool_call' | 'tool_response' | 'user' | 'system' | 'error';
  step: number;
  content: unknown;
}

export interface ExecutionLog {
  startTime: string;
  endTime?: string;
  totalSteps: number;
  resultCount: number;
  entries: LogEntry[];
}

export interface SearchResult {
  name: string;
  sourceUrl: string;
  productUrl?: string;
  githubUrl?: string;
  arxivUrl?: string;
  innovation: string;
  company: string;
  trend: string;
  tags: string[];
  source: string;
  discoveredAt: string;
}

export interface AgentState {
  results: SearchResult[];
  visitedUrls: Set<string>;
  currentStep: number;
  maxSteps: number;
  targetCount: number;
  isComplete: boolean;
}

export type ExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface StatusUpdate {
  status: ExecutionStatus;
  progress: number;
  total: number;
  action?: string;
  error?: string;
}

export type MessageType =
  | { type: 'START_TASK'; tabId: number }
  | { type: 'STOP_TASK' }
  | { type: 'GET_STATUS' }
  | { type: 'DOWNLOAD_RESULTS' }
  | { type: 'DOWNLOAD_LOGS' }
  | ({ type: 'STATUS_UPDATE' } & StatusUpdate)
  | { type: 'TASK_COMPLETE'; results: SearchResult[] }
  | { type: 'ERROR'; error: string };
