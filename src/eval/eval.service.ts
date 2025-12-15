import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  writeFile,
  mkdir,
  readdir,
  readFile,
  unlink,
  rmdir,
} from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EvalExpressionDto } from './dto/eval-expression.dto';
import { EvalResult } from './interfaces/eval-result.interface';

const execAsync = promisify(exec);

/**
 * Service for evaluating Noir expressions
 *
 * This service wraps user expressions in a minimal Noir program,
 * compiles it, executes it, and returns the result.
 */
@Injectable()
export class EvalService {
  private readonly logger = new Logger(EvalService.name);
  private readonly baseDataPath: string;
  private readonly defaultTimeout = 10000; // 10 seconds

  constructor(private configService: ConfigService) {
    this.baseDataPath = this.configService.getOrThrow<string>('noir.dataPath');
  }

  /**
   * Evaluate a Noir expression
   */
  async evaluateExpression(dto: EvalExpressionDto): Promise<EvalResult> {
    const startTime = performance.now();
    let requestDir: string | null = null;

    try {
      // Create unique request directory
      const requestId = randomUUID();
      requestDir = join(this.baseDataPath, 'eval', requestId);
      const srcDir = join(requestDir, 'src');

      this.logger.log(`Evaluating expression: ${dto.expression.substring(0, 50)}...`);

      // Create directories
      await mkdir(requestDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });

      // Generate wrapper program
      const wrapperCode = this.generateWrapperProgram(dto);
      this.logger.debug(`Generated wrapper program:\n${wrapperCode}`);

      // Write source code
      const sourceCodePath = join(srcDir, 'main.nr');
      await writeFile(sourceCodePath, wrapperCode, 'utf-8');

      // Write Nargo.toml
      const cargoToml = this.generateCargoToml(dto.context.cargoToml);
      const cargoTomlPath = join(requestDir, 'Nargo.toml');
      await writeFile(cargoTomlPath, cargoToml, 'utf-8');

      // Write Prover.toml with input values
      const proverToml = this.generateProverToml(dto.context.inputs);
      const proverTomlPath = join(requestDir, 'Prover.toml');
      await writeFile(proverTomlPath, proverToml, 'utf-8');

      // Compile the wrapper program
      const compileTimeout = dto.options?.timeout || this.defaultTimeout;
      const compileCommand = `cd "${requestDir}" && nargo compile`;

      this.logger.log(`Compiling wrapper: ${compileCommand}`);

      try {
        await execAsync(compileCommand, { timeout: compileTimeout });
      } catch (error) {
        const errorMessage = this.formatCompilationError(
          error.stderr || error.stdout || error.message
        );
        this.logger.error(`Compilation failed: ${errorMessage}`);
        return {
          success: false,
          error: `Expression compilation failed: ${errorMessage}`,
          evaluationTime: performance.now() - startTime,
        };
      }

      // Execute to get the result
      const executeCommand = `cd "${requestDir}" && nargo execute`;
      this.logger.log(`Executing: ${executeCommand}`);

      let executeOutput: string;
      try {
        const { stdout, stderr } = await execAsync(executeCommand, {
          timeout: compileTimeout,
        });
        executeOutput = stdout + stderr;
        this.logger.debug(`Execute output: ${executeOutput}`);

        // Try to extract result directly from execution output
        // Format: "[eval_wrapper] Circuit output: 0x..."
        const circuitOutputMatch = executeOutput.match(/Circuit output:\s*(0x[a-fA-F0-9]+|\d+)/);
        if (circuitOutputMatch) {
          const evaluationTime = performance.now() - startTime;
          this.logger.log(`Expression evaluated in ${evaluationTime.toFixed(0)}ms: ${circuitOutputMatch[1]}`);
          return {
            success: true,
            result: circuitOutputMatch[1],
            resultType: 'Field',
            evaluationTime,
          };
        }
      } catch (error) {
        const errorMessage = error.stderr || error.stdout || error.message;
        this.logger.error(`Execution failed: ${errorMessage}`);
        return {
          success: false,
          error: `Expression execution failed: ${errorMessage}`,
          evaluationTime: performance.now() - startTime,
        };
      }

      // Read the witness file to get the return value
      const result = await this.extractReturnValue(requestDir);

      if (result === null) {
        return {
          success: false,
          error: 'Failed to extract result from execution',
          evaluationTime: performance.now() - startTime,
        };
      }

      const evaluationTime = performance.now() - startTime;
      this.logger.log(`Expression evaluated in ${evaluationTime.toFixed(0)}ms: ${result}`);

      return {
        success: true,
        result,
        resultType: 'Field',
        evaluationTime,
      };
    } catch (error) {
      this.logger.error('Evaluation error:', error);
      return {
        success: false,
        error: error.message || 'Unknown evaluation error',
        evaluationTime: performance.now() - startTime,
      };
    } finally {
      // Clean up
      if (requestDir) {
        await this.cleanupRequestDir(requestDir);
      }
    }
  }

  /**
   * Generate a wrapper Noir program that evaluates the expression
   */
  private generateWrapperProgram(dto: EvalExpressionDto): string {
    const { expression, context } = dto;

    // Determine required imports based on expression
    const imports = this.getRequiredImports(expression);

    // Generate input parameters
    const inputParams = Object.entries(context.inputs)
      .map(([name, _value]) => `${name}: Field`)
      .join(', ');

    // Transform expression: replace $varName with varName
    const processedExpression = expression.replace(
      /\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
      '$1'
    );

    // Build the wrapper program
    const lines: string[] = [];

    // Add imports
    if (imports.length > 0) {
      lines.push(...imports);
      lines.push('');
    }

    // Add main function that returns the expression result
    if (inputParams) {
      lines.push(`fn main(${inputParams}) -> pub Field {`);
    } else {
      lines.push(`fn main() -> pub Field {`);
    }
    lines.push(`    ${processedExpression}`);
    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Get required imports based on the expression
   */
  private getRequiredImports(expression: string): string[] {
    const imports: string[] = [];
    const lowerExpr = expression.toLowerCase();

    if (/poseidon2::hash/i.test(expression)) {
      imports.push('use std::hash::poseidon2::Poseidon2;');
    }
    if (/keccak256/i.test(expression)) {
      imports.push('use std::hash::keccak256;');
    }
    if (/sha256/i.test(expression)) {
      imports.push('use std::hash::sha256;');
    }
    if (/pedersen_hash/i.test(expression)) {
      imports.push('use std::hash::pedersen_hash;');
    }
    if (/blake2s/i.test(expression)) {
      imports.push('use std::hash::blake2s;');
    }
    if (/blake3/i.test(expression)) {
      imports.push('use std::hash::blake3;');
    }

    return imports;
  }

  /**
   * Generate Nargo.toml for the wrapper program
   */
  private generateCargoToml(userCargoToml?: string): string {
    // Use a minimal Nargo.toml for evaluation
    // We don't need external dependencies since we use std library
    return `[package]
name = "eval_wrapper"
type = "bin"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]`;
  }

  /**
   * Generate Prover.toml with input values
   */
  private generateProverToml(inputs: Record<string, string | number>): string {
    const lines: string[] = [];

    for (const [name, value] of Object.entries(inputs)) {
      if (typeof value === 'string' && value.startsWith('0x')) {
        // Hex value - convert to decimal for TOML
        const decimalValue = BigInt(value).toString();
        lines.push(`${name} = "${decimalValue}"`);
      } else if (typeof value === 'number') {
        lines.push(`${name} = "${value}"`);
      } else {
        lines.push(`${name} = "${value}"`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Extract the return value from the witness file
   */
  private async extractReturnValue(requestDir: string): Promise<string | null> {
    try {
      // Read the compiled artifact to get ABI info
      const artifactPath = join(requestDir, 'target', 'eval_wrapper.json');
      const artifactContent = await readFile(artifactPath, 'utf-8');
      const artifact = JSON.parse(artifactContent);

      // Read the witness file
      const witnessPath = join(requestDir, 'target', 'eval_wrapper.gz');

      // Use nargo to show witness values
      const { stdout } = await execAsync(
        `cd "${requestDir}" && nargo info --show-witnesses 2>/dev/null || true`
      );

      // Parse the return value from ABI
      // The return value should be the last witness value
      const abi = artifact.abi;
      if (abi && abi.return_type) {
        // Get return value witness index from ABI
        const returnWitnessIndex = abi.return_value_witness_index || 0;

        // Alternative: read from Verifier.toml which contains public outputs
        try {
          const verifierPath = join(requestDir, 'Verifier.toml');
          const verifierContent = await readFile(verifierPath, 'utf-8');

          // Parse the return value from Verifier.toml
          const returnMatch = verifierContent.match(/return\s*=\s*"([^"]+)"/);
          if (returnMatch) {
            return returnMatch[1];
          }
        } catch {
          // Verifier.toml may not exist, continue with alternative
        }
      }

      // Fallback: try to read the execution output
      // The nargo execute command prints the return value
      const execResult = await execAsync(
        `cd "${requestDir}" && nargo execute 2>&1 | grep -i "return\\|output" || true`
      );

      if (execResult.stdout) {
        const valueMatch = execResult.stdout.match(/(\d+)/);
        if (valueMatch) {
          return valueMatch[1];
        }
      }

      // Another fallback: parse witness file directly
      const witnessFiles = await readdir(join(requestDir, 'target'));
      for (const file of witnessFiles) {
        if (file.endsWith('.toml') && file !== 'eval_wrapper.json') {
          try {
            const content = await readFile(join(requestDir, 'target', file), 'utf-8');
            const match = content.match(/return\s*=\s*"?([^"\n]+)"?/);
            if (match) {
              return match[1];
            }
          } catch {
            continue;
          }
        }
      }

      this.logger.warn('Could not extract return value from witness');
      return null;
    } catch (error) {
      this.logger.error('Error extracting return value:', error);
      return null;
    }
  }

  /**
   * Format compilation error for client
   */
  private formatCompilationError(error: string): string {
    // Remove ANSI color codes
    let formatted = error.replace(/\u001b\[[0-9;]*m/g, '');

    // Extract relevant error message
    const errorMatch = formatted.match(/error:(.+?)(?:\n\n|$)/s);
    if (errorMatch) {
      return errorMatch[1].trim();
    }

    return formatted.trim().substring(0, 500);
  }

  /**
   * Clean up request directory
   */
  private async cleanupRequestDir(requestDir: string): Promise<void> {
    try {
      await this.removeDirectoryRecursive(requestDir);
      this.logger.debug(`Cleaned up: ${requestDir}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup ${requestDir}:`, error.message);
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
    } catch {
      // Ignore errors
    }
  }

  /**
   * Health check
   */
  async checkHealth(): Promise<{ status: string; message: string }> {
    try {
      const { stdout } = await execAsync('nargo --version');
      return {
        status: 'ok',
        message: `Eval service ready. Nargo: ${stdout.trim()}`,
      };
    } catch {
      return {
        status: 'error',
        message: 'Nargo compiler not available',
      };
    }
  }
}
