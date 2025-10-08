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
This is a NestJS-based REST API server providing Noir circuit compilation and profiling capabilities:

- **Main Module (`src/app.module.ts`)**: Root application module importing ConfigModule, CompilationModule, and ProfilingModule
- **Global Configuration**: CORS enabled, global validation pipe with whitelist/transform, `/api` prefix
- **Port Configuration**: Defaults to 4000, configurable via `PORT` environment variable
- **Dual Purpose**: Handles both circuit compilation (via nargo CLI) and circuit profiling (via noir-profiler CLI)

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
- **Noirup**: Installs Noir toolchain with version `1.0.0-beta.11`
- **Barretenberg**: Installs proving backend with version `0.84.0`, copies binaries to `/usr/local/bin/`
- **Permissions**: Runs as non-root `nestjs` user, proper file permissions for data directories

#### Container Configuration
- **Port Exposure**: 4000 (matches default server configuration)
- **Volume Mounting**: Optional `/app/output` for debugging generated files
- **Health Checks**: Built-in curl-based health monitoring in docker-compose

### Critical Dependencies

#### External Tools
- **noir-profiler**: CLI tool for generating flamegraph SVGs, must be in PATH
- **nargo**: Noir package manager for `nargo info` circuit analysis
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

This architecture provides a clean separation between Noir compilation (frontend) and profiling analysis (backend server).