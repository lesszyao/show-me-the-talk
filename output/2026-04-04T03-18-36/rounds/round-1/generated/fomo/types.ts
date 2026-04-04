export type LogType = 'assistant' | 'tool_call' | 'tool_response' | 'user' | 'system' | 'error';

export interface LogEntry {
  timestamp: string;
  type: LogType;
  step: number;
  content: unknown;
}

export interface ExecutionLog {
  startTime: string;
  endTime: string;
  totalSteps: number;
  resultCount: number;
  entries: LogEntry[];
}

export interface SearchResult {
  name: string;
  infoUrl: string;
  productUrl?: string;
  githubUrl?: string;
  arxivUrl?: string;
  innovation: string;
  company: string;
  trend: 'High' | 'Medium' | 'Low';
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

export enum ExecutionStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export type Message =
  | { type: 'START_TASK'; tabId: number }
  | { type: 'STOP_TASK' }
  | { type: 'GET_STATUS' }
  | { type: 'DOWNLOAD_RESULTS' }
  | { type: 'DOWNLOAD_LOGS' }
  | {
      type: 'STATUS_UPDATE';
      status: ExecutionStatus;
      currentStep: number;
      resultCount: number;
      currentAction?: string;
    }
  | {
      type: 'TASK_COMPLETED';
      results: SearchResult[];
    }
  | {
      type: 'ERROR';
      error: string;
    };
