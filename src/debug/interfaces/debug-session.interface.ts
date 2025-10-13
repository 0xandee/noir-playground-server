import { ChildProcess } from 'child_process';

/**
 * Represents an active debug session
 */
export interface DebugSession {
  sessionId: string;
  workspaceDir: string; // Temporary directory for this session
  dapProcess: ChildProcess; // The nargo dap process
  initialized: boolean; // Whether DAP initialization completed
  seq: number; // Sequence number for DAP messages
  createdAt: Date;
  lastActivity: Date;

  // Completion tracking (added for graceful program completion handling)
  completed?: boolean; // Whether the program has finished execution
  completedAt?: Date; // When the program completed
  lastVariables?: Variable[]; // Cached variables at completion
  lastWitnesses?: WitnessEntry[]; // Cached witnesses at completion

  // Breakpoint tracking
  breakpoints?: VerifiedBreakpoint[]; // Currently set breakpoints with verification status
}

/**
 * Verified breakpoint (matches DTO but kept here for type consistency)
 */
export interface VerifiedBreakpoint {
  line: number;
  verified: boolean;
  message?: string;
}

/**
 * Debug state returned to client
 */
export interface DebugState {
  sessionId: string;
  stopped: boolean;
  reason?: string; // 'breakpoint', 'step', 'exception', etc.
  sourceLine?: number;
  sourceFile?: string;
  threadId?: number;
  frameId?: number;
}

/**
 * Variable tree structure for inspection
 */
export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number; // For nested variables
}

/**
 * Stack frame information
 */
export interface StackFrame {
  id: number;
  name: string;
  source?: {
    path: string;
    name: string;
  };
  line: number;
  column: number;
}

/**
 * Witness map entry
 */
export interface WitnessEntry {
  index: string; // e.g., "_0", "_1", "_2"
  value: string;
  variable?: string; // Associated variable name (if known)
}

/**
 * ACIR opcode information
 */
export interface OpcodeInfo {
  index: string; // e.g., "0:0.16"
  type: string;
  description: string;
  sourceLine?: number;
  isCurrent?: boolean;
}

/**
 * Result of starting a debug session
 */
export interface StartDebugResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  initialState?: DebugState;
}

/**
 * Result of a step command
 */
export interface StepResult {
  success: boolean;
  state?: DebugState;
  error?: string;
}

/**
 * Result of fetching variables
 */
export interface VariablesResult {
  success: boolean;
  variables?: Variable[];
  error?: string;
}

/**
 * Result of fetching witness map
 */
export interface WitnessResult {
  success: boolean;
  witnesses?: WitnessEntry[];
  error?: string;
}

/**
 * Result of fetching opcodes
 */
export interface OpcodesResult {
  success: boolean;
  opcodes?: OpcodeInfo[];
  currentOpcode?: string;
  error?: string;
}
