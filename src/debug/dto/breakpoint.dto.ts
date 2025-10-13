import { IsString, IsNumber, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Represents a single source breakpoint
 */
export class SourceBreakpointDto {
  @IsNumber()
  line: number;

  @IsNumber()
  @IsOptional()
  column?: number;
}

/**
 * Request to set breakpoints for a debug session
 * Following DAP protocol: client sends ALL breakpoints for a source file
 */
export class SetBreakpointsRequestDto {
  @IsString()
  sessionId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceBreakpointDto)
  breakpoints: SourceBreakpointDto[];

  @IsString()
  @IsOptional()
  sourceFile?: string; // Path to source file (default: "main.nr")
}

/**
 * Verified breakpoint returned from DAP
 */
export interface VerifiedBreakpoint {
  line: number;
  verified: boolean;
  message?: string; // Reason if not verified
}

/**
 * Response from setBreakpoints request
 */
export interface SetBreakpointsResponseDto {
  success: boolean;
  breakpoints?: VerifiedBreakpoint[];
  error?: string;
}
