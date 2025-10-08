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
import { CompileProgramDto } from './dto/compile-program.dto';
import {
  CompilationResult,
  PackageInfo,
} from './interfaces/compilation-result.interface';
import { ConfigService } from '@nestjs/config';

const execAsync = promisify(exec);

@Injectable()
export class CompilationService {
  private readonly logger = new Logger(CompilationService.name);
  private readonly baseDataPath: string;
  private readonly defaultCargoToml = `[package]
name = "playground"
type = "bin"
authors = [""]
compiler_version = ">=1.0.0"

[dependencies]`;

  constructor(private configService: ConfigService) {
    this.baseDataPath = this.configService.getOrThrow<string>('noir.dataPath');
  }

  async compileProgram(dto: CompileProgramDto): Promise<CompilationResult> {
    let requestDir: string | null = null;
    const startTime = performance.now();

    try {
      // Create unique request directory
      const requestId = randomUUID();
      requestDir = join(this.baseDataPath, requestId);
      const srcDir = join(requestDir, 'src');

      this.logger.log(`Created compilation request: ${requestId}`);

      // Create directories
      await mkdir(requestDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });

      // Write source code
      const sourceCodePath = join(srcDir, 'main.nr');
      await writeFile(sourceCodePath, dto.sourceCode, 'utf-8');
      this.logger.log(`Wrote source code to ${sourceCodePath}`);

      // Write Nargo.toml (use provided or default)
      const cargoTomlContent = dto.cargoToml || this.defaultCargoToml;
      const cargoTomlPath = join(requestDir, 'Nargo.toml');
      await writeFile(cargoTomlPath, cargoTomlContent, 'utf-8');
      this.logger.log(`Wrote Nargo.toml to ${cargoTomlPath}`);

      // Parse package name from Nargo.toml
      const packageInfo = this.parsePackageInfo(cargoTomlContent);
      this.logger.log(
        `Compiling package: ${packageInfo.name} (type: ${packageInfo.type})`,
      );

      // Run nargo compile
      const compileCommand = `cd "${requestDir}" && nargo compile`;
      this.logger.log(`Executing: ${compileCommand}`);

      let warnings: string[] = [];
      let compileOutput = '';

      try {
        const { stdout, stderr } = await execAsync(compileCommand, {
          timeout: 60000, // 60 second timeout
        });
        compileOutput = stdout;

        // Parse warnings from stderr
        if (stderr) {
          warnings = this.parseWarnings(stderr);
        }

        this.logger.log('Compilation succeeded');
      } catch (error) {
        // Compilation failed - extract error details
        const errorMessage =
          error.stderr || error.stdout || error.message || 'Compilation failed';
        this.logger.error('Compilation failed:', errorMessage);

        const compilationTime = performance.now() - startTime;
        return {
          success: false,
          error: this.formatCompilationError(errorMessage),
          compilationTime,
        };
      }

      // Read the compiled artifact
      const targetDir = join(requestDir, 'target');
      const artifactPath = join(targetDir, `${packageInfo.name}.json`);

      this.logger.log(`Reading artifact from ${artifactPath}`);

      let artifact: any;
      try {
        const artifactContent = await readFile(artifactPath, 'utf-8');
        artifact = JSON.parse(artifactContent);
        this.logger.log('Successfully parsed artifact JSON');
      } catch (error) {
        this.logger.error('Failed to read/parse artifact:', error.message);
        return {
          success: false,
          error: `Failed to read compiled artifact: ${error.message}`,
          compilationTime: performance.now() - startTime,
        };
      }

      const compilationTime = performance.now() - startTime;
      this.logger.log(`Compilation completed in ${compilationTime.toFixed(0)}ms`);

      return {
        success: true,
        artifact,
        warnings,
        compilationTime,
      };
    } catch (error) {
      this.logger.error('Compilation service error:', error);
      return {
        success: false,
        error: error.message || 'Unknown compilation error',
        compilationTime: performance.now() - startTime,
      };
    } finally {
      // Clean up request directory
      if (requestDir) {
        this.logger.log(`Cleaning up request directory: ${requestDir}`);
        await this.cleanupRequestDir(requestDir);
      }
    }
  }

  /**
   * Parse package information from Nargo.toml
   */
  private parsePackageInfo(cargoToml: string): PackageInfo {
    const lines = cargoToml.split('\n');
    let name = 'playground'; // default
    let type = 'bin'; // default
    let compilerVersion: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse name
      if (trimmed.startsWith('name =')) {
        const match = trimmed.match(/name\s*=\s*"([^"]+)"/);
        if (match) {
          name = match[1];
        }
      }

      // Parse type
      if (trimmed.startsWith('type =')) {
        const match = trimmed.match(/type\s*=\s*"([^"]+)"/);
        if (match) {
          type = match[1];
        }
      }

      // Parse compiler_version
      if (trimmed.startsWith('compiler_version =')) {
        const match = trimmed.match(/compiler_version\s*=\s*"([^"]+)"/);
        if (match) {
          compilerVersion = match[1];
        }
      }
    }

    return { name, type, compilerVersion };
  }

  /**
   * Parse warnings from nargo output
   */
  private parseWarnings(output: string): string[] {
    const warnings: string[] = [];

    // Look for warning patterns in nargo output
    const warningPattern = /warning:/gi;
    const lines = output.split('\n');

    for (const line of lines) {
      if (warningPattern.test(line)) {
        warnings.push(line.trim());
      }
    }

    return warnings;
  }

  /**
   * Format compilation error for client consumption
   */
  private formatCompilationError(error: string): string {
    // Remove ANSI color codes
    let formatted = error.replace(/\u001b\[[0-9;]*m/g, '');

    // Extract the most relevant error message
    const errorMatch = formatted.match(/error:(.+?)(?:\n\n|$)/s);
    if (errorMatch) {
      return errorMatch[1].trim();
    }

    return formatted.trim();
  }

  /**
   * Clean up request directory
   */
  private async cleanupRequestDir(requestDir: string | null): Promise<void> {
    if (requestDir) {
      try {
        await this.removeDirectoryRecursive(requestDir);
        this.logger.log('Cleaned up request directory');
      } catch (error) {
        this.logger.warn('Failed to cleanup request directory:', error.message);
      }
    }
  }

  /**
   * Recursively remove directory and all contents
   */
  private async removeDirectoryRecursive(dirPath: string): Promise<void> {
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        const filePath = join(dirPath, file);
        try {
          await unlink(filePath);
        } catch {
          // If it's a directory, remove it recursively
          await this.removeDirectoryRecursive(filePath);
        }
      }
      await rmdir(dirPath);
    } catch (error) {
      this.logger.warn(`Failed to remove directory ${dirPath}:`, error.message);
    }
  }

  /**
   * Check if nargo is available
   */
  async checkNargoAvailability(): Promise<{
    available: boolean;
    version?: string;
    message: string;
  }> {
    try {
      const { stdout } = await execAsync('nargo --version');
      return {
        available: true,
        version: stdout.trim(),
        message: 'Nargo compiler is available',
      };
    } catch (error) {
      return {
        available: false,
        message:
          'Nargo compiler is not available. Make sure it is installed and in PATH.',
      };
    }
  }
}
