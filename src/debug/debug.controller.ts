import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DebugService } from './debug.service';
import { StartDebugSessionDto } from './dto/start-debug-session.dto';
import { StepCommandDto } from './dto/step-command.dto';
import { SetBreakpointsRequestDto, SetBreakpointsResponseDto } from './dto/breakpoint.dto';
import {
  StartDebugResult,
  StepResult,
  VariablesResult,
  WitnessResult,
  OpcodesResult,
} from './interfaces/debug-session.interface';

@Controller('debug')
export class DebugController {
  constructor(private readonly debugService: DebugService) {}

  /**
   * Start a new debug session
   * POST /api/debug/start
   */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  async startSession(
    @Body() dto: StartDebugSessionDto,
  ): Promise<StartDebugResult> {
    return this.debugService.startSession(dto);
  }

  /**
   * Execute a step command (next, into, out, continue, etc.)
   * POST /api/debug/step
   */
  @Post('step')
  @HttpCode(HttpStatus.OK)
  async executeStep(@Body() dto: StepCommandDto): Promise<StepResult> {
    return this.debugService.executeStep(dto.sessionId, dto.command);
  }

  /**
   * Get variables for current stack frame
   * GET /api/debug/variables/:sessionId
   */
  @Get('variables/:sessionId')
  async getVariables(
    @Param('sessionId') sessionId: string,
  ): Promise<VariablesResult> {
    return this.debugService.getVariables(sessionId);
  }

  /**
   * Get witness map
   * GET /api/debug/witness/:sessionId
   */
  @Get('witness/:sessionId')
  async getWitnessMap(
    @Param('sessionId') sessionId: string,
  ): Promise<WitnessResult> {
    return this.debugService.getWitnessMap(sessionId);
  }

  /**
   * Get ACIR opcodes
   * GET /api/debug/opcodes/:sessionId
   */
  @Get('opcodes/:sessionId')
  async getOpcodes(
    @Param('sessionId') sessionId: string,
  ): Promise<OpcodesResult> {
    return this.debugService.getOpcodes(sessionId);
  }

  /**
   * Set breakpoints for a debug session
   * POST /api/debug/breakpoints
   */
  @Post('breakpoints')
  @HttpCode(HttpStatus.OK)
  async setBreakpoints(
    @Body() dto: SetBreakpointsRequestDto,
  ): Promise<SetBreakpointsResponseDto> {
    // Log what we received from the client
    console.log('[DebugController] Received setBreakpoints request:', {
      sessionId: dto.sessionId,
      sourceFile: dto.sourceFile,
      breakpointsCount: dto.breakpoints?.length || 0,
      breakpoints: dto.breakpoints,
    });

    const result = await this.debugService.setBreakpoints(
      dto.sessionId,
      dto.breakpoints,
      dto.sourceFile,
    );
    return result;
  }

  /**
   * Terminate a debug session
   * DELETE /api/debug/:sessionId
   */
  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async terminateSession(@Param('sessionId') sessionId: string): Promise<void> {
    await this.debugService.terminateSession(sessionId);
  }

  /**
   * Health check for debug API
   * GET /api/debug/health
   */
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      message: 'Debug API is operational',
      timestamp: new Date().toISOString(),
    };
  }
}
