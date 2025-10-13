import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  writeFile,
  mkdir,
  readFile,
  unlink,
  readdir,
  rmdir,
} from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { StartDebugSessionDto } from './dto/start-debug-session.dto';
import {
  DebugSession,
  StartDebugResult,
  StepResult,
  VariablesResult,
  WitnessResult,
  OpcodesResult,
  DebugState,
  Variable,
  WitnessEntry,
  OpcodeInfo,
  VerifiedBreakpoint,
} from './interfaces/debug-session.interface';
import {
  DAPRequest,
  DAPResponse,
  DAPEvent,
  InitializeRequestArguments,
  LaunchRequestArguments,
  StoppedEvent,
  SetBreakpointsArguments,
  SourceBreakpoint,
} from './interfaces/dap-protocol.interface';

@Injectable()
export class DebugService implements OnModuleDestroy {
  private readonly logger = new Logger(DebugService.name);
  private readonly baseDataPath: string;
  private readonly sessions: Map<string, DebugSession> = new Map();
  private readonly SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private cleanupInterval: NodeJS.Timeout;

  // Configurable timeout values (loaded from config)
  private readonly dapRequestTimeout: number;
  private readonly dapDisconnectTimeout: number;
  private readonly initializedTimeout: number;
  private readonly stoppedTimeout: number;
  private readonly compilationTimeout: number;

  private readonly defaultCargoToml = `[package]
name = "playground"
type = "bin"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]`;

  constructor(private configService: ConfigService) {
    this.baseDataPath = this.configService.getOrThrow<string>('noir.dataPath');

    // Load timeout configurations with fallback defaults
    this.dapRequestTimeout = this.configService.get<number>('debug.timeouts.dapRequest', 5000);
    this.dapDisconnectTimeout = this.configService.get<number>('debug.timeouts.dapDisconnect', 180000);
    this.initializedTimeout = this.configService.get<number>('debug.timeouts.initialized', 10000);
    this.stoppedTimeout = this.configService.get<number>('debug.timeouts.stopped', 10000);
    this.compilationTimeout = this.configService.get<number>('debug.timeouts.compilation', 60000);

    this.logger.log(`Debug service initialized with timeouts: DAP=${this.dapRequestTimeout}ms, disconnect=${this.dapDisconnectTimeout}ms, compile=${this.compilationTimeout}ms`);

    // Start cleanup interval to remove stale sessions
    this.cleanupInterval = setInterval(
      () => this.cleanupStaleSessions(),
      60000,
    ); // Check every minute
  }

  /**
   * Lifecycle hook - cleanup when module is destroyed
   */
  onModuleDestroy() {
    this.logger.log('Cleaning up all debug sessions...');
    clearInterval(this.cleanupInterval);

    for (const [sessionId, session] of this.sessions.entries()) {
      this.terminateSession(sessionId);
    }
  }

  /**
   * Start a new debug session
   */
  async startSession(dto: StartDebugSessionDto): Promise<StartDebugResult> {
    const sessionId = randomUUID();
    let workspaceDir: string | null = null;

    try {
      // Create workspace directory
      workspaceDir = join(this.baseDataPath, sessionId);
      const srcDir = join(workspaceDir, 'src');

      this.logger.log(`Starting debug session: ${sessionId}`);

      await mkdir(workspaceDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });

      // Write source code
      await writeFile(join(srcDir, 'main.nr'), dto.sourceCode, 'utf-8');

      // Write Nargo.toml
      const cargoToml = dto.cargoToml || this.defaultCargoToml;
      await writeFile(join(workspaceDir, 'Nargo.toml'), cargoToml, 'utf-8');

      // Write Prover.toml with inputs
      const proverToml = this.generateProverToml(dto.inputs);
      await writeFile(join(workspaceDir, 'Prover.toml'), proverToml, 'utf-8');

      // Compile the program first (nargo dap requires a compiled artifact)
      this.logger.log(`Compiling program for session ${sessionId} (timeout: ${this.compilationTimeout}ms)...`);
      const compileCommand = `cd "${workspaceDir}" && nargo compile`;

      try {
        await promisify(exec)(compileCommand, { timeout: this.compilationTimeout });
        this.logger.log(`Compilation successful for session ${sessionId}`);
      } catch (error) {
        throw new Error(`Compilation failed: ${error.message}`);
      }

      // Spawn nargo dap process
      const dapProcess = spawn('nargo', ['dap'], {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Create session object
      const session: DebugSession = {
        sessionId,
        workspaceDir,
        dapProcess,
        initialized: false,
        seq: 1,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.sessions.set(sessionId, session);

      // Set up process event handlers
      this.setupProcessHandlers(session);

      // Initialize DAP protocol
      await this.initializeDAP(session);

      // Launch the debug session (this triggers the initialized event)
      await this.launchDAP(session);

      // Wait for initial stopped event and get initial debug state
      const stoppedEvent = await this.waitForStoppedEvent(session);
      const initialDebugState = await this.getCurrentDebugState(session, stoppedEvent);

      session.initialized = true;
      this.logger.log(`Debug session ${sessionId} initialized successfully`);

      return {
        success: true,
        sessionId,
        initialState: initialDebugState,
      };
    } catch (error) {
      this.logger.error(`Failed to start debug session:`, error);

      // Cleanup on failure
      if (workspaceDir) {
        await this.cleanupWorkspace(workspaceDir);
      }

      return {
        success: false,
        error: error.message || 'Failed to start debug session',
      };
    }
  }

  /**
   * Execute a step command (next, into, out, continue, etc.)
   */
  async executeStep(
    sessionId: string,
    command: string,
  ): Promise<StepResult> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        success: false,
        error: 'Session not found',
      };
    }

    if (!session.initialized) {
      return {
        success: false,
        error: 'Session not initialized',
      };
    }

    try {
      session.lastActivity = new Date();

      // === DIAGNOSTIC LOGGING: Step command entry ===
      this.logger.log(`[STEP] Session ${sessionId}: User command '${command}' received`);

      // Map user-friendly command to DAP protocol command
      const dapCommand = this.mapStepCommandToDAP(command);

      // === DIAGNOSTIC LOGGING: Command mapping ===
      if (dapCommand !== command) {
        this.logger.log(`[STEP] Session ${sessionId}: Mapped '${command}' → '${dapCommand}'`);
      }

      // === DIAGNOSTIC LOGGING: Before sending DAP request ===
      this.logger.log(`[STEP] Session ${sessionId}: Sending DAP '${dapCommand}' request...`);
      const requestStartTime = Date.now();

      // Send step command via DAP
      const response = await this.sendDAPRequest(session, dapCommand, {
        threadId: 1, // Noir typically uses thread ID 1
      });

      // === DIAGNOSTIC LOGGING: DAP response received ===
      const requestDuration = Date.now() - requestStartTime;
      this.logger.log(`[STEP] Session ${sessionId}: DAP response received in ${requestDuration}ms - success: ${response.success}`);

      if (response.body) {
        this.logger.debug(`[STEP] Session ${sessionId}: Response body: ${JSON.stringify(response.body)}`);
      }

      if (!response.success) {
        this.logger.error(`[STEP] Session ${sessionId}: DAP request failed - ${response.message}`);
        return {
          success: false,
          error: response.message || 'Step command failed',
        };
      }

      // Wait for stopped event (with short wait to see if process exits)
      try {
        this.logger.log(`[STEP] Session ${sessionId}: Waiting for 'stopped' event...`);
        const stoppedEvent = await this.waitForStoppedEvent(session);

        // === DIAGNOSTIC LOGGING: Stopped event received ===
        this.logger.log(`[STEP] Session ${sessionId}: Stopped event received - reason: '${stoppedEvent.body.reason}'`);

        // Check if process has exited (program completed)
        if (session.dapProcess.exitCode !== null) {
          this.logger.log(`[STEP] Session ${sessionId}: Process exit detected - execution completed`);
          return {
            success: true,
            state: {
              sessionId: session.sessionId,
              stopped: true,
              reason: 'completed',
            },
          };
        }

        // Get current state
        this.logger.log(`[STEP] Session ${sessionId}: Fetching current debug state...`);
        const state = await this.getCurrentDebugState(session, stoppedEvent);

        // === DIAGNOSTIC LOGGING: Debug state retrieved ===
        this.logger.log(`[STEP] Session ${sessionId}: Debug state - line: ${state.sourceLine}, file: ${state.sourceFile}, frameId: ${state.frameId}`);

        // Get and log stack trace for deeper inspection
        try {
          const stackTraceResponse = await this.sendDAPRequest(session, 'stackTrace', { threadId: 1 });
          if (stackTraceResponse.success && stackTraceResponse.body?.stackFrames) {
            this.logger.log(`[STEP] Session ${sessionId}: Stack depth: ${stackTraceResponse.body.stackFrames.length} frame(s)`);
            stackTraceResponse.body.stackFrames.forEach((frame: any, index: number) => {
              this.logger.log(`[STEP] Session ${sessionId}:   Frame ${index}: ${frame.name} at line ${frame.line} (${frame.source?.name || 'unknown'})`);
            });
          }
        } catch (stackError) {
          this.logger.warn(`[STEP] Session ${sessionId}: Could not fetch detailed stack trace`);
        }

        // Cache current variables and witnesses for completion tracking
        try {
          const variablesResult = await this.getVariables(sessionId);
          if (variablesResult.success) {
            session.lastVariables = variablesResult.variables;
          }

          const witnessesResult = await this.getWitnessMap(sessionId);
          if (witnessesResult.success) {
            session.lastWitnesses = witnessesResult.witnesses;
          }
        } catch (cacheError) {
          // Non-critical - log but don't fail the step
          this.logger.debug('Failed to cache state for completion tracking:', cacheError);
        }

        return {
          success: true,
          state,
        };
      } catch (eventError) {
        // If we timeout waiting for stopped event, check if process exited
        if (session.dapProcess.exitCode !== null) {
          this.logger.log(`Program execution completed for session ${sessionId}`);
          return {
            success: true,
            state: {
              sessionId: session.sessionId,
              stopped: true,
              reason: 'completed',
            },
          };
        }
        throw eventError;
      }
    } catch (error) {
      this.logger.error(`Step command failed:`, error);

      // Check if session still exists and process exited (program completed)
      const currentSession = this.sessions.get(sessionId);
      if (currentSession && currentSession.dapProcess.exitCode !== null) {
        this.logger.log(`Program execution completed for session ${sessionId}`);
        return {
          success: true,
          state: {
            sessionId,
            stopped: true,
            reason: 'completed',
          },
        };
      }

      return {
        success: false,
        error: error.message || 'Step command failed',
      };
    }
  }

  /**
   * Get variables for the current stack frame
   */
  async getVariables(sessionId: string): Promise<VariablesResult> {
    const session = this.sessions.get(sessionId);

    if (!session || !session.initialized) {
      return {
        success: false,
        error: 'Session not found or not initialized',
      };
    }

    // If session completed, return last known state
    if (session.completed) {
      return {
        success: true,
        variables: session.lastVariables || [],
      };
    }

    try {
      session.lastActivity = new Date();

      // Get stack trace
      const stackTraceResponse = await this.sendDAPRequest(
        session,
        'stackTrace',
        { threadId: 1 },
      );

      if (!stackTraceResponse.success || !stackTraceResponse.body?.stackFrames?.length) {
        return {
          success: false,
          error: 'No stack frames available',
        };
      }

      const frameId = stackTraceResponse.body.stackFrames[0].id;

      // Get scopes for the frame
      const scopesResponse = await this.sendDAPRequest(session, 'scopes', {
        frameId,
      });

      if (!scopesResponse.success || !scopesResponse.body?.scopes?.length) {
        return {
          success: false,
          error: 'No scopes available',
        };
      }

      // Get variables from the first scope
      const scope = scopesResponse.body.scopes[0];
      const variablesResponse = await this.sendDAPRequest(
        session,
        'variables',
        {
          variablesReference: scope.variablesReference,
        },
      );

      if (!variablesResponse.success) {
        return {
          success: false,
          error: 'Failed to fetch variables',
        };
      }

      const variables: Variable[] = variablesResponse.body?.variables?.map(
        (v: any) => ({
          name: v.name,
          value: v.value,
          type: v.type,
          variablesReference: v.variablesReference,
        }),
      ) || [];

      return {
        success: true,
        variables,
      };
    } catch (error) {
      this.logger.error(`Get variables failed:`, error);
      return {
        success: false,
        error: error.message || 'Failed to get variables',
      };
    }
  }

  /**
   * Get witness map (via Witness Map scope)
   * Nargo DAP exposes witness data through a dedicated scope, not via evaluate/REPL
   */
  async getWitnessMap(sessionId: string): Promise<WitnessResult> {
    const session = this.sessions.get(sessionId);

    if (!session || !session.initialized) {
      return {
        success: false,
        error: 'Session not found or not initialized',
      };
    }

    // If session completed, return last known state
    if (session.completed) {
      return {
        success: true,
        witnesses: session.lastWitnesses || [],
      };
    }

    try {
      session.lastActivity = new Date();

      // Get stack trace to get frame ID
      const stackTraceResponse = await this.sendDAPRequest(
        session,
        'stackTrace',
        { threadId: 1 },
      );

      if (!stackTraceResponse.success || !stackTraceResponse.body?.stackFrames?.length) {
        return {
          success: false,
          error: 'No stack frames available',
        };
      }

      const frameId = stackTraceResponse.body.stackFrames[0].id;

      // Get scopes for the frame
      const scopesResponse = await this.sendDAPRequest(session, 'scopes', {
        frameId,
      });

      if (!scopesResponse.success || !scopesResponse.body?.scopes?.length) {
        return {
          success: false,
          error: 'No scopes available',
        };
      }

      // Find the "Witness Map" scope
      const witnessScope = scopesResponse.body.scopes.find(
        (scope: any) => scope.name === 'Witness Map',
      );

      if (!witnessScope) {
        return {
          success: false,
          error: 'Witness Map scope not found',
        };
      }

      // Get variables from the Witness Map scope
      const variablesResponse = await this.sendDAPRequest(
        session,
        'variables',
        {
          variablesReference: witnessScope.variablesReference,
        },
      );

      if (!variablesResponse.success) {
        return {
          success: false,
          error: 'Failed to fetch witness variables',
        };
      }

      // Convert DAP variables to WitnessEntry format
      const witnesses: WitnessEntry[] = variablesResponse.body?.variables?.map(
        (v: any) => ({
          index: v.name, // e.g., "_0", "_1", etc.
          value: v.value,
        }),
      ) || [];

      return {
        success: true,
        witnesses,
      };
    } catch (error) {
      this.logger.error(`Get witness map failed:`, error);
      return {
        success: false,
        error: error.message || 'Failed to get witness map',
      };
    }
  }

  /**
   * Get ACIR opcodes
   * Note: Nargo DAP doesn't support opcode inspection via evaluate command
   * This returns empty opcodes gracefully (feature not available in nargo DAP)
   */
  async getOpcodes(sessionId: string): Promise<OpcodesResult> {
    const session = this.sessions.get(sessionId);

    if (!session || !session.initialized) {
      return {
        success: false,
        error: 'Session not found or not initialized',
      };
    }

    // If session completed, return empty opcodes (opcodes not cached)
    if (session.completed) {
      return {
        success: true,
        opcodes: [],
      };
    }

    try {
      session.lastActivity = new Date();

      // Nargo DAP doesn't support the evaluate command with REPL context
      // Return empty opcodes gracefully - this feature is not available
      this.logger.debug('Opcodes inspection not supported by nargo DAP - returning empty list');

      return {
        success: true,
        opcodes: [],
      };
    } catch (error) {
      this.logger.error(`Get opcodes failed:`, error);
      return {
        success: false,
        error: error.message || 'Failed to get opcodes',
      };
    }
  }

  /**
   * Set breakpoints for the debug session
   * Following DAP protocol: client sends ALL breakpoints for a source file
   */
  async setBreakpoints(
    sessionId: string,
    breakpoints: SourceBreakpoint[],
    sourceFile?: string,
  ): Promise<{ success: boolean; breakpoints?: VerifiedBreakpoint[]; error?: string }> {
    const session = this.sessions.get(sessionId);

    if (!session || !session.initialized) {
      return {
        success: false,
        error: 'Session not found or not initialized',
      };
    }

    try {
      session.lastActivity = new Date();

      // Default to main.nr if no source file specified
      const sourcePath = sourceFile || 'main.nr';

      this.logger.log(`Setting ${breakpoints.length} breakpoint(s) for session ${sessionId} in ${sourcePath}`);

      // Build DAP SetBreakpointsArguments
      // IMPORTANT: DAP uses relative paths like "src/main.nr", not absolute paths
      const relativePath = `src/${sourcePath}`;
      const args: SetBreakpointsArguments = {
        source: {
          name: sourcePath,
          path: relativePath,  // Use relative path that matches stack trace
        },
        breakpoints: breakpoints.map(bp => ({
          line: bp.line,
          column: bp.column,
        })),
        sourceModified: false,
      };

      // Log what we're sending to DAP
      this.logger.log(`[BREAKPOINTS] Sending to DAP:`, JSON.stringify({
        sourceName: args.source.name,
        sourcePath: args.source.path,
        breakpointsCount: args.breakpoints?.length || 0,
        breakpoints: args.breakpoints,
      }));

      // Send setBreakpoints request to DAP
      const response = await this.sendDAPRequest(session, 'setBreakpoints', args);

      this.logger.log(`[BREAKPOINTS] DAP response received - success: ${response.success}`);
      this.logger.log(`[BREAKPOINTS] Response body:`, JSON.stringify(response.body));

      if (!response.success) {
        this.logger.error(`Failed to set breakpoints: ${response.message}`);
        return {
          success: false,
          error: response.message || 'Failed to set breakpoints',
        };
      }

      // Parse verified breakpoints from DAP response
      const verifiedBreakpoints: VerifiedBreakpoint[] = response.body?.breakpoints?.map(
        (bp: any) => ({
          line: bp.line,
          verified: bp.verified,
          message: bp.message,
        }),
      ) || [];

      this.logger.log(`[BREAKPOINTS] Parsed ${verifiedBreakpoints.length} verified breakpoints`);
      this.logger.log(`[BREAKPOINTS] Verified breakpoints:`, JSON.stringify(verifiedBreakpoints));

      // Store verified breakpoints in session
      session.breakpoints = verifiedBreakpoints;

      this.logger.log(
        `Set breakpoints for session ${sessionId}: ${verifiedBreakpoints.filter(bp => bp.verified).length}/${verifiedBreakpoints.length} verified`,
      );

      return {
        success: true,
        breakpoints: verifiedBreakpoints,
      };
    } catch (error) {
      this.logger.error(`Set breakpoints failed:`, error);
      return {
        success: false,
        error: error.message || 'Failed to set breakpoints',
      };
    }
  }

  /**
   * Terminate a debug session with graceful disconnect and force-kill fallback
   *
   * Process:
   * 1. Try graceful DAP disconnect (3-minute timeout)
   * 2. If timeout/failure, proceed with force termination
   * 3. Send SIGTERM to process
   * 4. Wait 2 seconds for graceful exit
   * 5. If still alive, send SIGKILL
   * 6. Cleanup workspace regardless of outcome
   */
  async terminateSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.logger.warn(`Terminate session failed: session ${sessionId} not found`);
      return false;
    }

    this.logger.log(`[TERMINATE] Starting termination for session ${sessionId}`);

    try {
      // Step 1: Try graceful DAP disconnect (automatically uses 3-minute timeout)
      if (session.initialized && session.dapProcess.exitCode === null) {
        try {
          this.logger.log(`[TERMINATE] Sending graceful disconnect request (timeout: ${this.dapDisconnectTimeout}ms)...`);
          await this.sendDAPRequest(session, 'disconnect', {});
          this.logger.log(`[TERMINATE] Graceful disconnect succeeded`);
        } catch (disconnectError) {
          // Disconnect timeout or failure - continue with force termination
          this.logger.warn(`[TERMINATE] Disconnect failed or timed out: ${disconnectError.message}`);
          this.logger.log(`[TERMINATE] Proceeding with force termination...`);
        }
      } else {
        this.logger.log(`[TERMINATE] Skipping disconnect (session not initialized or process already exited)`);
      }

      // Step 2-5: Force kill with SIGTERM → SIGKILL escalation
      if (session.dapProcess.exitCode === null) {
        this.logger.log(`[TERMINATE] Sending SIGTERM to process...`);
        session.dapProcess.kill('SIGTERM');

        // Wait 2 seconds for graceful SIGTERM exit
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if process is still alive
        if (session.dapProcess.exitCode === null) {
          this.logger.warn(`[TERMINATE] Process did not exit with SIGTERM, escalating to SIGKILL`);
          session.dapProcess.kill('SIGKILL');

          // Give SIGKILL a moment to take effect
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          this.logger.log(`[TERMINATE] Process exited gracefully with SIGTERM (exit code: ${session.dapProcess.exitCode})`);
        }
      } else {
        this.logger.log(`[TERMINATE] Process already exited (exit code: ${session.dapProcess.exitCode})`);
      }

      // Step 6: Cleanup workspace (guaranteed to run)
      this.logger.log(`[TERMINATE] Cleaning up workspace: ${session.workspaceDir}`);
      await this.cleanupWorkspace(session.workspaceDir);

      // Remove from sessions map
      this.sessions.delete(sessionId);
      this.logger.log(`[TERMINATE] Session ${sessionId} terminated successfully`);

      return true;
    } catch (error) {
      // Even if everything fails, try to cleanup and remove session
      this.logger.error(`[TERMINATE] Unexpected error during termination of session ${sessionId}:`, error);

      try {
        await this.cleanupWorkspace(session.workspaceDir);
      } catch (cleanupError) {
        this.logger.error(`[TERMINATE] Workspace cleanup also failed:`, cleanupError);
      }

      this.sessions.delete(sessionId);
      this.logger.log(`[TERMINATE] Session ${sessionId} removed from map despite errors`);

      return false;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Setup process event handlers
   */
  private setupProcessHandlers(session: DebugSession) {
    session.dapProcess.stdout?.on('data', (data) => {
      // DAP messages come through stdout
      this.handleDAPOutput(session, data);
    });

    session.dapProcess.stderr?.on('data', (data) => {
      this.logger.warn(`[${session.sessionId}] stderr: ${data.toString()}`);
    });

    session.dapProcess.on('exit', (code) => {
      this.logger.log(`[${session.sessionId}] Process exited with code ${code}`);

      // Mark session as completed instead of deleting immediately
      // This allows the client to query the final state without "Session not found" errors
      session.completed = true;
      session.completedAt = new Date();

      // Schedule cleanup after 30 seconds to allow client to fetch final state
      setTimeout(() => {
        const stillExists = this.sessions.get(session.sessionId);
        if (stillExists) {
          this.logger.log(`Cleaning up completed session: ${session.sessionId}`);
          this.sessions.delete(session.sessionId);
        }
      }, 30000); // 30 second grace period
    });

    session.dapProcess.on('error', (error) => {
      this.logger.error(`[${session.sessionId}] Process error:`, error);
    });
  }

  /**
   * Handle DAP output from stdout
   */
  private handleDAPOutput(session: DebugSession, data: Buffer) {
    // DAP messages are in format:
    // Content-Length: <length>\r\n\r\n{json}
    const output = data.toString();
    this.logger.debug(`[${session.sessionId}] DAP output: ${output}`);

    // Store in buffer for later parsing
    // (In a production implementation, you'd need proper message buffering)
    if (!session['outputBuffer']) {
      session['outputBuffer'] = '';
    }
    session['outputBuffer'] += output;
  }

  /**
   * Send a DAP request and wait for response
   * Matches responses by request_seq to handle concurrent requests correctly
   *
   * @param session - The debug session
   * @param command - The DAP command to send
   * @param args - Command arguments
   * @param customTimeout - Optional custom timeout in milliseconds (overrides default)
   */
  private async sendDAPRequest(
    session: DebugSession,
    command: string,
    args?: any,
    customTimeout?: number,
  ): Promise<DAPResponse> {
    return new Promise((resolve, reject) => {
      const request: DAPRequest = {
        seq: session.seq++,
        type: 'request',
        command,
        arguments: args,
      };

      const requestSeq = request.seq;
      const message = this.formatDAPMessage(request);

      // Determine timeout: custom > command-specific > default
      let timeoutMs: number;
      if (customTimeout !== undefined) {
        timeoutMs = customTimeout;
      } else if (command === 'disconnect') {
        timeoutMs = this.dapDisconnectTimeout;
      } else {
        timeoutMs = this.dapRequestTimeout;
      }

      // Send request
      session.dapProcess.stdin?.write(message);

      // First, check if response is already in buffer
      const buffer = session['outputBuffer'] || '';
      if (buffer) {
        const messages = this.parseAllDAPMessages(buffer);
        const matchingResponse = messages.find(
          (msg) =>
            msg.type === 'response' &&
            msg['request_seq'] === requestSeq,
        ) as DAPResponse | undefined;

        if (matchingResponse) {
          this.logger.debug(`Found response for ${command} (seq ${requestSeq}) in buffer`);
          resolve(matchingResponse);
          return;
        }
      }

      // Wait for response (with configurable timeout)
      const timeout = setTimeout(() => {
        session.dapProcess.stdout?.removeListener('data', listener);
        reject(new Error(`DAP request timeout: ${command} (${timeoutMs}ms)`));
      }, timeoutMs);

      // Listen for response - check ALL messages in each chunk
      const listener = (data: Buffer) => {
        try {
          const messages = this.parseAllDAPMessages(data.toString());
          const matchingResponse = messages.find(
            (msg) =>
              msg.type === 'response' &&
              msg['request_seq'] === requestSeq,
          ) as DAPResponse | undefined;

          if (matchingResponse) {
            clearTimeout(timeout);
            session.dapProcess.stdout?.removeListener('data', listener);
            resolve(matchingResponse);
          }
        } catch (error) {
          // Parsing error, keep listening
        }
      };

      session.dapProcess.stdout?.on('data', listener);
    });
  }

  /**
   * Format DAP message with Content-Length header
   */
  private formatDAPMessage(message: any): string {
    const json = JSON.stringify(message);
    const contentLength = Buffer.byteLength(json, 'utf-8');
    return `Content-Length: ${contentLength}\r\n\r\n${json}`;
  }

  /**
   * Parse DAP message from buffer
   * Handles multiple messages in one buffer by respecting Content-Length headers
   */
  private parseDAPMessage(data: string): DAPResponse | DAPEvent | null {
    // Look for Content-Length header
    const headerMatch = data.match(/Content-Length: (\d+)\r\n\r\n/);
    if (!headerMatch) {
      return null;
    }

    const contentLength = parseInt(headerMatch[1], 10);
    const headerEndIndex = data.indexOf('\r\n\r\n') + 4; // Position after the header

    // Extract only the JSON content specified by Content-Length
    const jsonContent = data.substring(headerEndIndex, headerEndIndex + contentLength);

    try {
      return JSON.parse(jsonContent);
    } catch (error) {
      this.logger.error('Failed to parse DAP message:', error);
      this.logger.debug('Raw content:', jsonContent);
      return null;
    }
  }

  /**
   * Parse all DAP messages from buffer
   * Returns array of all messages found in the buffer
   */
  private parseAllDAPMessages(data: string): Array<DAPResponse | DAPEvent> {
    const messages: Array<DAPResponse | DAPEvent> = [];
    let remaining = data;

    while (remaining.length > 0) {
      const headerMatch = remaining.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) {
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEndIndex = remaining.indexOf('\r\n\r\n') + 4;
      const jsonContent = remaining.substring(headerEndIndex, headerEndIndex + contentLength);

      try {
        const message = JSON.parse(jsonContent);
        messages.push(message);

        // Move to next message
        remaining = remaining.substring(headerEndIndex + contentLength);
      } catch (error) {
        this.logger.error('Failed to parse DAP message in buffer:', error);
        break;
      }
    }

    return messages;
  }

  /**
   * Initialize DAP protocol
   */
  private async initializeDAP(session: DebugSession): Promise<void> {
    const args: InitializeRequestArguments = {
      clientID: 'noir-playground-server',
      clientName: 'Noir Playground Debug Server',
      adapterID: 'noir',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
    };

    const response = await this.sendDAPRequest(session, 'initialize', args);

    if (!response.success) {
      throw new Error('DAP initialization failed');
    }
  }

  /**
   * Launch DAP session
   */
  private async launchDAP(session: DebugSession): Promise<void> {
    const args: LaunchRequestArguments = {
      projectFolder: '.', // Current directory (since dapProcess cwd is already workspaceDir)
      proverName: 'Prover',
      generateAcir: false,
      skipInstrumentation: false,
    };

    const response = await this.sendDAPRequest(session, 'launch', args);

    if (!response.success) {
      throw new Error('DAP launch failed');
    }

    // Try to send configurationDone (optional command - nargo DAP doesn't support it)
    try {
      await this.sendDAPRequest(session, 'configurationDone', undefined);
      this.logger.debug('ConfigurationDone sent successfully');
    } catch (error) {
      // configurationDone is optional and not supported by nargo DAP
      // Log but don't fail - the debug session can continue without it
      this.logger.debug('ConfigurationDone not supported (this is expected for nargo DAP)');
    }
  }

  /**
   * Wait for initialized event
   */
  private async waitForInitialized(session: DebugSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for initialized event (${this.initializedTimeout}ms)`));
      }, this.initializedTimeout);

      const listener = (data: Buffer) => {
        const message = this.parseDAPMessage(data.toString());
        if (message && message.type === 'event' && message['event'] === 'initialized') {
          clearTimeout(timeout);
          session.dapProcess.stdout?.removeListener('data', listener);
          resolve();
        }
      };

      session.dapProcess.stdout?.on('data', listener);
    });
  }

  /**
   * Wait for stopped event after step command
   * Checks accumulated buffer first before setting up listener to avoid race conditions
   */
  private async waitForStoppedEvent(session: DebugSession): Promise<StoppedEvent> {
    return new Promise((resolve, reject) => {
      // First, check if the stopped event is already in the buffer
      const buffer = session['outputBuffer'] || '';
      if (buffer) {
        const messages = this.parseAllDAPMessages(buffer);
        const stoppedEvent = messages.find(
          (msg) => msg.type === 'event' && msg['event'] === 'stopped',
        ) as StoppedEvent | undefined;

        if (stoppedEvent) {
          this.logger.debug('Found stopped event in buffer');
          resolve(stoppedEvent);
          return;
        }
      }

      // If not in buffer, set up listener for new data
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for stopped event (${this.stoppedTimeout}ms)`));
      }, this.stoppedTimeout);

      const listener = (data: Buffer) => {
        const message = this.parseDAPMessage(data.toString());
        if (message && message.type === 'event' && message['event'] === 'stopped') {
          clearTimeout(timeout);
          session.dapProcess.stdout?.removeListener('data', listener);
          resolve(message as StoppedEvent);
        }
      };

      session.dapProcess.stdout?.on('data', listener);
    });
  }

  /**
   * Get current debug state
   */
  private async getCurrentDebugState(
    session: DebugSession,
    stoppedEvent: StoppedEvent,
  ): Promise<DebugState> {
    // Get stack trace to determine current location
    const stackTraceResponse = await this.sendDAPRequest(session, 'stackTrace', {
      threadId: 1,
    });

    const state: DebugState = {
      sessionId: session.sessionId,
      stopped: true,
      reason: stoppedEvent.body.reason,
      threadId: stoppedEvent.body.threadId,
    };

    if (stackTraceResponse.success && stackTraceResponse.body?.stackFrames?.length) {
      const frame = stackTraceResponse.body.stackFrames[0];
      state.sourceLine = frame.line;
      state.sourceFile = frame.source?.path || frame.source?.name;
      state.frameId = frame.id;
    }

    return state;
  }

  /**
   * Parse witness output from REPL command
   */
  private parseWitnessOutput(output: string): WitnessEntry[] {
    const witnesses: WitnessEntry[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Format: "_0 = 5" or similar
      const match = line.match(/(_\d+)\s*=\s*(.+)/);
      if (match) {
        witnesses.push({
          index: match[1],
          value: match[2].trim(),
        });
      }
    }

    return witnesses;
  }

  /**
   * Parse opcode output from REPL command
   */
  private parseOpcodeOutput(output: string): OpcodeInfo[] {
    const opcodes: OpcodeInfo[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Parse opcode lines (format varies, this is a simplified version)
      const match = line.match(/(\d+:\d+(?:\.\d+)?)\s+(.+)/);
      if (match) {
        opcodes.push({
          index: match[1],
          type: 'unknown', // Would need more parsing
          description: match[2].trim(),
        });
      }
    }

    return opcodes;
  }

  /**
   * Map user-friendly step commands to DAP protocol commands
   * DAP uses specific command names that differ from user-friendly names
   */
  private mapStepCommandToDAP(command: string): string {
    const commandMap: Record<string, string> = {
      'next': 'next',
      'into': 'stepIn',  // DAP uses 'stepIn' not 'into'
      'out': 'stepOut',  // DAP uses 'stepOut' not 'out'
      'over': 'next',    // 'over' is an alias for 'next'
      'continue': 'continue',
      'step': 'next',    // 'step' is an alias for 'next'
    };

    const mappedCommand = commandMap[command] || command;

    if (mappedCommand !== command) {
      this.logger.debug(`Mapped command '${command}' to DAP command '${mappedCommand}'`);
    }

    return mappedCommand;
  }

  /**
   * Generate Prover.toml from inputs
   */
  private generateProverToml(inputs: Record<string, any>): string {
    let toml = '';

    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'string') {
        // Check if string is numeric (Field values should not have quotes)
        if (!isNaN(Number(value)) && value.trim() !== '') {
          toml += `${key} = ${value}\n`;
        } else {
          toml += `${key} = "${value}"\n`;
        }
      } else if (Array.isArray(value)) {
        toml += `${key} = ${JSON.stringify(value)}\n`;
      } else {
        toml += `${key} = ${value}\n`;
      }
    }

    return toml;
  }

  /**
   * Cleanup workspace directory
   */
  private async cleanupWorkspace(workspaceDir: string): Promise<void> {
    try {
      await this.removeDirectoryRecursive(workspaceDir);
      this.logger.log(`Cleaned up workspace: ${workspaceDir}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup workspace ${workspaceDir}:`, error.message);
    }
  }

  /**
   * Recursively remove directory
   */
  private async removeDirectoryRecursive(dirPath: string): Promise<void> {
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        const filePath = join(dirPath, file);
        try {
          await unlink(filePath);
        } catch {
          await this.removeDirectoryRecursive(filePath);
        }
      }
      await rmdir(dirPath);
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Cleanup stale sessions (inactive for > SESSION_TIMEOUT_MS)
   */
  private cleanupStaleSessions(): void {
    const now = new Date();

    for (const [sessionId, session] of this.sessions.entries()) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();

      if (inactiveTime > this.SESSION_TIMEOUT_MS) {
        this.logger.log(`Cleaning up stale session: ${sessionId}`);
        this.terminateSession(sessionId);
      }
    }
  }
}
