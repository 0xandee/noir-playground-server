/**
 * Debug Adapter Protocol (DAP) message types
 * Based on: https://microsoft.github.io/debug-adapter-protocol/
 */

export interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

export interface DAPRequest extends DAPMessage {
  type: 'request';
  command: string;
  arguments?: any;
}

export interface DAPResponse extends DAPMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: any;
}

export interface DAPEvent extends DAPMessage {
  type: 'event';
  event: string;
  body?: any;
}

/**
 * DAP Initialize Request
 */
export interface InitializeRequestArguments {
  clientID?: string;
  clientName?: string;
  adapterID: string;
  locale?: string;
  linesStartAt1?: boolean;
  columnsStartAt1?: boolean;
  pathFormat?: 'path' | 'uri';
}

/**
 * DAP Launch Request (for nargo dap)
 */
export interface LaunchRequestArguments {
  projectFolder: string;
  proverName?: string;
  generateAcir?: boolean;
  skipInstrumentation?: boolean;
  testName?: string;
}

/**
 * DAP Threads Response
 */
export interface Thread {
  id: number;
  name: string;
}

/**
 * DAP StackTrace Response
 */
export interface StackTraceResponse {
  stackFrames: StackFrameInfo[];
  totalFrames?: number;
}

export interface StackFrameInfo {
  id: number;
  name: string;
  source?: SourceInfo;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface SourceInfo {
  name?: string;
  path?: string;
  sourceReference?: number;
}

/**
 * DAP Scopes Response
 */
export interface ScopesResponse {
  scopes: Scope[];
}

export interface Scope {
  name: string;
  variablesReference: number;
  expensive: boolean;
  source?: SourceInfo;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * DAP Variables Response
 */
export interface VariablesResponse {
  variables: VariableInfo[];
}

export interface VariableInfo {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  evaluateName?: string;
}

/**
 * DAP Stopped Event
 */
export interface StoppedEvent extends DAPEvent {
  event: 'stopped';
  body: {
    reason: string;
    description?: string;
    threadId?: number;
    preserveFocusHint?: boolean;
    text?: string;
    allThreadsStopped?: boolean;
  };
}

/**
 * DAP Initialized Event
 */
export interface InitializedEvent extends DAPEvent {
  event: 'initialized';
}

/**
 * DAP Terminated Event
 */
export interface TerminatedEvent extends DAPEvent {
  event: 'terminated';
  body?: {
    restart?: any;
  };
}

/**
 * DAP SetBreakpoints Request
 */
export interface SetBreakpointsArguments {
  source: SourceInfo;
  breakpoints?: SourceBreakpoint[];
  sourceModified?: boolean;
}

export interface SourceBreakpoint {
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

/**
 * DAP Evaluate Request (for custom commands like "witness", "vars")
 */
export interface EvaluateArguments {
  expression: string;
  frameId?: number;
  context?: string;
  format?: any;
}
