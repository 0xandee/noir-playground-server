# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development
npm install                 # Install dependencies
npm run start:dev          # Start development server with watch mode (port 4000)
npm run start:debug        # Start with debug mode and watch
npm run start:prod         # Start production server
npm run build              # Build for production

# Testing
npm run test               # Run unit tests with Jest
npm run test:e2e           # Run end-to-end tests
npm run test:cov           # Run tests with coverage
npm run test:watch         # Run tests in watch mode

# Code Quality
npm run lint               # Run ESLint with auto-fix
npm run format             # Format code with Prettier

# Docker
docker build -t noir-playground-server .
docker run -p 4000:4000 noir-playground-server
docker-compose up --build  # Full stack with docker-compose

# Testing the API
node test-server.js        # Run the included test script
```

## Core Architecture

### NestJS Application Structure
This is a NestJS-based REST API server providing Noir circuit compilation, profiling, and debugging capabilities:

- **Main Module (`src/app.module.ts`)**: Root application module importing ConfigModule, CompilationModule, ProfilingModule, and DebugModule
- **Global Configuration**: CORS enabled, global validation pipe with whitelist/transform, `/api` prefix
- **Port Configuration**: Defaults to 4000, configurable via `PORT` environment variable
- **Triple Purpose**: Handles circuit compilation (via nargo CLI), circuit profiling (via noir-profiler CLI), and interactive debugging (via nargo dap)

### Profiling Service Architecture
The core functionality centers around `ProfilingService` (`src/profiling/profiling.service.ts`):

- **Temporary File Management**: Creates UUID-based request directories in `NOIR_DATA_PATH` for isolated processing
- **Multi-Command Execution**: Runs both `noir-profiler opcodes` and `noir-profiler gates` commands sequentially
- **Automatic Cleanup**: Removes entire request directories and all generated files after processing
- **Error Handling**: Comprehensive try-catch with cleanup in finally blocks

#### Profiling Pipeline
1. **File Creation**: Writes artifact JSON, source code (`src/main.nr`), and optional `Nargo.toml` to temporary directory
2. **Opcodes Profiling**: Executes `noir-profiler opcodes --artifact-path <path> --output <output>`
3. **Gates Profiling**: Executes `noir-profiler gates --artifact-path <path> --backend-path <bb-path> --output <output>`
4. **Circuit Metrics**: Runs `nargo info` in project directory to extract function-level statistics
5. **SVG Processing**: Reads all generated `.svg` files, extracts function names and types from filenames
6. **Response Generation**: Returns structured response with SVG content, circuit metrics, and success status

### Compilation Service Architecture
The server provides native Noir compilation via `CompilationService` (`src/compilation/compilation.service.ts`):

- **Native Nargo Compilation**: Executes `nargo compile` CLI command for native code compilation
- **UUID-Based Isolation**: Creates temporary directories for each compilation request (same pattern as profiling)
- **Git Dependency Support**: Native git operations eliminate CORS issues for external libraries
- **Automatic Cleanup**: Removes all temporary files after compilation completes
- **Error Handling**: Captures and formats compilation errors from Nargo CLI

#### Compilation Pipeline
1. **Directory Creation**: Creates UUID-based temporary directory in `NOIR_DATA_PATH`
2. **File Writing**: Writes source code to `src/main.nr` and `Nargo.toml`
3. **Dependency Resolution**: Runs `nargo compile` which natively clones git dependencies
4. **Artifact Extraction**: Reads compiled artifact from `target/{package_name}.json`
5. **Response Generation**: Returns artifact JSON, warnings, and compilation time
6. **Cleanup**: Removes entire temporary directory and all contents

#### Benefits Over Browser WASM Compilation
- **No CORS Issues**: Native git operations work with any GitHub repository
- **Faster Compilation**: ~2-5x speedup compared to browser WASM compiler
- **Transitive Dependencies**: Automatic resolution of dependency chains
- **Better Error Messages**: Direct access to Nargo CLI error output
- **No Browser Limitations**: No need for complex workarounds or caching layers

### Debug Service Architecture
The server provides interactive debugging capabilities via `DebugService` (`src/debug/debug.service.ts`):

- **DAP Protocol Integration**: Implements Debug Adapter Protocol by spawning and managing `nargo dap` processes
- **Session Management**: UUID-based session isolation with automatic cleanup and timeout handling
- **Stateful Debugging**: Maintains active debug sessions with process lifecycle management
- **Multi-Client Support**: Handles multiple concurrent debug sessions independently

#### DAP (Debug Adapter Protocol) Integration
The service acts as a DAP client communicating with `nargo dap` server:

**Protocol Details:**
- **Message Format**: Content-Length header protocol (`Content-Length: <bytes>\r\n\r\n{json}`)
- **Sequence Matching**: Tracks request/response pairs via `seq` and `request_seq` fields
- **Event Handling**: Processes DAP events (`stopped`, `initialized`, `terminated`)
- **Stdin/Stdout Communication**: Sends requests via stdin, receives responses/events via stdout

**DAP Session Lifecycle:**
1. **Initialize**: Send `initialize` request with client capabilities
2. **Launch**: Send `launch` request with project configuration
3. **Configure**: Optional `configurationDone` (not supported by nargo DAP)
4. **Wait**: Receive `stopped` event when program starts
5. **Step/Inspect**: Execute step commands and inspect variables/witnesses
6. **Disconnect**: Send `disconnect` and terminate process

#### Debug Pipeline
1. **Session Creation**: Create UUID-based workspace directory with source files
2. **Compilation**: Run `nargo compile` to generate debug artifact (required before DAP)
3. **Process Spawn**: Spawn `nargo dap` process in workspace directory
4. **DAP Initialization**: Initialize DAP protocol and launch debug session
5. **Stepping**: Execute step commands (`next`, `stepIn`, `stepOut`, `continue`)
6. **State Inspection**: Query variables, witnesses, stack frames, and opcodes
7. **Breakpoint Management**: Set/verify breakpoints with DAP `setBreakpoints` command
8. **Termination**: Send disconnect, kill process, cleanup workspace

#### Workspace Structure
```
/data/noir-profiler/{sessionId}/
├── src/
│   └── main.nr          # Source code
├── Nargo.toml           # Project manifest
├── Prover.toml          # Input values for execution
└── target/              # Compiled artifacts (generated by nargo compile)
    └── playground.json
```

#### API Endpoints - Debug Module

**Session Management:**
- **POST `/api/debug/start`**: Start new debug session with source code and inputs
- **DELETE `/api/debug/:sessionId`**: Terminate debug session and cleanup

**Stepping Commands:**
- **POST `/api/debug/step`**: Execute step command (next, into, out, continue)

**State Inspection:**
- **GET `/api/debug/variables/:sessionId`**: Get variables for current stack frame
- **GET `/api/debug/witness/:sessionId`**: Get witness map (circuit witness values)
- **GET `/api/debug/opcodes/:sessionId`**: Get ACIR opcodes (not supported by nargo DAP - returns empty)

**Breakpoint Management:**
- **POST `/api/debug/breakpoints`**: Set breakpoints for debug session (replaces all breakpoints)

**Health Check:**
- **GET `/api/debug/health`**: Debug API operational status

#### Debug Request/Response Patterns

**Start Debug Session (`POST /api/debug/start`):**
```json
{
  "sourceCode": "pub fn main(x: Field, y: pub Field) -> pub Field { x + y }",
  "cargoToml": "[package]\nname = \"playground\"\n...", // Optional
  "inputs": { "x": "5", "y": "3" }
}
```

**Start Debug Response:**
```json
{
  "success": true,
  "sessionId": "uuid-here",
  "initialState": {
    "sessionId": "uuid-here",
    "stopped": true,
    "reason": "entry",
    "sourceLine": 1,
    "sourceFile": "src/main.nr",
    "threadId": 1,
    "frameId": 0
  }
}
```

**Execute Step (`POST /api/debug/step`):**
```json
{
  "sessionId": "uuid-here",
  "command": "next" // next, into, out, over, continue, step
}
```

**Step Response:**
```json
{
  "success": true,
  "state": {
    "sessionId": "uuid-here",
    "stopped": true,
    "reason": "step",
    "sourceLine": 2,
    "sourceFile": "src/main.nr",
    "frameId": 0
  }
}
```

**Set Breakpoints (`POST /api/debug/breakpoints`):**
```json
{
  "sessionId": "uuid-here",
  "sourceFile": "main.nr", // Optional, defaults to main.nr
  "breakpoints": [
    { "line": 5 },
    { "line": 10, "column": 12 }
  ]
}
```

**Breakpoints Response:**
```json
{
  "success": true,
  "breakpoints": [
    { "line": 5, "verified": true },
    { "line": 10, "verified": false, "message": "No code at this line" }
  ]
}
```

#### Step Command Mapping
The service maps user-friendly commands to DAP protocol commands:

| User Command | DAP Command | Description |
|--------------|-------------|-------------|
| `next` | `next` | Step over (next line in current function) |
| `into` | `stepIn` | Step into function call |
| `out` | `stepOut` | Step out of current function |
| `over` | `next` | Alias for `next` |
| `step` | `next` | Alias for `next` |
| `continue` | `continue` | Continue execution until breakpoint |

#### Session Management Features

**Automatic Cleanup:**
- **Stale Sessions**: Terminates sessions inactive for >10 minutes
- **Completed Programs**: Caches final state for 30 seconds after program completion
- **Module Shutdown**: Cleans up all sessions when server stops

**Timeout Handling:**
- **DAP Request Timeout**: 5 seconds for DAP protocol requests
- **Stopped Event Timeout**: 10 seconds waiting for stopped event
- **Session Timeout**: 10 minutes of inactivity before cleanup

**Error Recovery:**
- **Process Exit Detection**: Handles program completion gracefully
- **Cached State**: Returns last known variables/witnesses after completion
- **Graceful Degradation**: Continues operation even if optional commands fail

#### Variables and Witnesses

**Variables Inspection:**
- Fetches from DAP `scopes` and `variables` commands
- Returns hierarchical variable tree with types and values
- Supports nested variables via `variablesReference` field

**Witness Map:**
- Retrieved from special "Witness Map" scope in DAP
- Maps witness indices (`_0`, `_1`, etc.) to their values
- Essential for understanding circuit constraint system

**Opcodes (Limited Support):**
- Nargo DAP doesn't support opcode inspection via REPL
- Returns empty array gracefully (feature unavailable)
- Future versions may support via enhanced DAP protocol

#### Breakpoint Verification

**DAP Breakpoint Protocol:**
- Client sends ALL breakpoints for a source file (not incremental)
- Server forwards to `nargo dap` via `setBreakpoints` request
- DAP verifies each breakpoint and returns verification status

**Verification Reasons:**
- ✅ Verified: Breakpoint set at valid executable line
- ❌ Unverified: No code at specified line (comment, whitespace, etc.)
- ❌ Unverified: Line outside valid range

**Path Handling:**
- Uses relative paths (`src/main.nr`) to match DAP stack trace format
- Source name and path must be consistent across requests

#### Diagnostic Logging

The service includes comprehensive diagnostic logging for debugging issues:

**Step Command Logging:**
- Command received and mapped to DAP command
- DAP request timing (milliseconds)
- Stopped event details (reason, line, file)
- Stack trace depth and frame details
- Line change tracking (detects function inlining)

**Breakpoint Logging:**
- Breakpoint count and source file
- DAP request/response details
- Verification status for each breakpoint
- Unverified breakpoint warnings with reasons

**Session Logging:**
- Session creation and initialization
- Compilation status and timing
- Process exit codes and completion
- Cleanup and timeout events

### Configuration System
Uses NestJS ConfigService with validation (`src/config/configuration.ts`):

- **Environment-based**: Loads from environment variables with sensible defaults
- **Docker-optimized**: Default paths configured for containerized deployment
- **Key Settings**:
  - `PORT`: Server port (default: 4000)
  - `NOIR_DATA_PATH`: Base directory for profiling operations (default: `/data/noir-profiler`)
  - `NOIR_BACKEND_PATH`: Path to Barretenberg backend binary (default: `/usr/local/bin/bb`)

### API Endpoints

#### Core Endpoints
- **GET `/api/health`**: Server health check with timestamp

#### Compilation Endpoints
- **POST `/api/compile`**: Compile Noir source code using native nargo CLI
- **GET `/api/compile/check-nargo`**: Verify `nargo` CLI availability and version

#### Profiling Endpoints
- **POST `/api/profile/opcodes`**: Generate profiling visualizations for compiled circuit
- **GET `/api/profile/check-profiler`**: Verify `noir-profiler` CLI availability and version

#### Debug Endpoints
See "Debug Service Architecture" section below for complete documentation of all debug endpoints including:
- Session management (start/terminate)
- Stepping commands (next, into, out, continue)
- State inspection (variables, witnesses, opcodes)
- Breakpoint management (set/verify breakpoints)

#### Request/Response Patterns

**Compilation Requests (`POST /api/compile`):**
```json
{
  "sourceCode": "pub fn main(x: Field) -> Field { x }",
  "cargoToml": "[package]\nname = \"playground\"\n..." // Optional, uses default if not provided
}
```

**Compilation Responses:**
```json
{
  "success": true,
  "artifact": { /* Compiled program artifact with bytecode and ABI */ },
  "warnings": ["warning message..."],
  "compilationTime": 594.72
}
```

**Profiling Requests (`POST /api/profile/opcodes`):**
- `artifact`: Circuit artifact object (required)
- `sourceCode`: Noir source code string (required)
- `cargoToml`: Optional Nargo.toml content (optional)

**Profiling Responses:**
- `success`: Boolean status
- `svgs`: Array of SVG objects with content, filename, function name, and type
- `circuitMetrics`: Object with total counts and per-function breakdowns
- `error`: Error message string if applicable

### SVG Generation Types
The service generates multiple profiling visualizations:

- **ACIR Opcodes** (`acir_opcodes`): Constraint generation profiling - filename pattern `{function}_acir_opcodes.svg`
- **Brillig Opcodes** (`brillig_opcodes`): Unconstrained execution profiling - filename pattern `{function}_brillig_opcodes.svg`
- **Gates** (`gates`): Backend gate-level profiling - filename pattern `{function}_gates.svg`

### Docker Integration

#### Multi-stage Build
- **Builder Stage**: Ubuntu 24.04 with Node.js 18, builds application with full dependencies
- **Production Stage**: Ubuntu 24.04 with runtime dependencies, pre-installed noir toolchain

#### Tool Installation
- **Noirup**: Installs Noir toolchain with version `1.0.0-beta.15`
- **Barretenberg**: Installs proving backend with version `1.0.0`, copies binaries to `/usr/local/bin/`
- **Permissions**: Runs as non-root `nestjs` user, proper file permissions for data directories

#### Container Configuration
- **Port Exposure**: 4000 (matches default server configuration)
- **Volume Mounting**: Optional `/app/output` for debugging generated files
- **Health Checks**: Built-in curl-based health monitoring in docker-compose

### Critical Dependencies

#### External Tools
- **noir-profiler**: CLI tool for generating flamegraph SVGs, must be in PATH
- **nargo**: Noir package manager providing:
  - `nargo compile`: Native compilation for circuit artifacts
  - `nargo info`: Circuit analysis and statistics
  - `nargo dap`: Debug Adapter Protocol server for interactive debugging
- **bb (Barretenberg)**: Proving backend for gates profiling, path configurable

#### npm Dependencies
- **@nestjs/common, @nestjs/core**: Core NestJS framework
- **@nestjs/config**: Configuration management with validation
- **class-transformer, class-validator**: DTO validation and transformation
- **child_process.exec**: System command execution for profiler tools

### File System Patterns

#### Temporary Directory Structure
```
/data/noir-profiler/{uuid}/
├── src/
│   └── main.nr          # Source code from request
├── Nargo.toml           # Project configuration (if provided)
├── circuit.json         # Artifact file
└── output/              # Generated SVG files
    ├── main_acir_opcodes.svg
    ├── function_brillig_opcodes.svg
    └── main_gates.svg
```

#### Security Considerations
- **UUID-based isolation**: Each request gets unique directory to prevent conflicts
- **Automatic cleanup**: All temporary files removed regardless of success/failure
- **Non-root execution**: Docker container runs with restricted user permissions
- **Input validation**: DTOs enforce required fields and proper types

### Error Handling Patterns

#### Service-level Errors
- **Command Execution**: Captures stdout/stderr from failed profiler commands
- **File Operations**: Handles permission errors, disk space issues
- **JSON Parsing**: Validates artifact format before processing

#### API-level Errors
- **Validation Errors**: 400 Bad Request with detailed field-level messages
- **Server Errors**: 500 Internal Server Error with sanitized error messages
- **Success Responses**: Always include `success: true/false` flag

### Development Notes

#### Local Development Setup
- **Manual Installation**: Requires `noirup` for noir-profiler CLI installation
- **Backend Dependency**: Needs Barretenberg backend (`bb`) in system PATH
- **Development Mode**: Hot reload enabled with `npm run start:dev`

#### Testing Infrastructure
- **Unit Tests**: Jest-based testing in `src/` directory
- **E2E Tests**: Integration tests with supertest
- **Manual Testing**: `test-server.js` script for API endpoint verification
- **Docker Testing**: Health checks and container startup verification

### Integration Patterns

#### Frontend Integration
The service is designed to integrate with the main Noir playground React application:
- **CORS Enabled**: Accepts cross-origin requests from frontend
- **JSON API**: Standard REST endpoints with JSON request/response
- **Error Format**: Consistent error response structure for frontend handling

#### Circuit Analysis Workflow
1. Frontend compiles Noir code to generate circuit artifact
2. Sends artifact + source code to profiler server
3. Server generates SVG flamegraphs and circuit metrics
4. Frontend displays interactive profiling visualizations
5. Server automatically cleans up all temporary files

#### Debug Workflow
1. Frontend sends source code and inputs to debug server
2. Server compiles code and starts `nargo dap` process
3. Server initializes DAP protocol and returns session ID
4. Frontend sends step commands and inspects state via session ID
5. Server maintains stateful debug session with automatic timeout
6. Frontend can set breakpoints that are verified by nargo DAP
7. Server cleans up when session terminates or times out

This architecture provides a clean separation between:
- **Compilation**: Native nargo CLI compilation (server-side) vs browser WASM (client-side)
- **Profiling**: Flamegraph analysis (backend server)
- **Debugging**: Interactive DAP debugging (backend server with stateful sessions)