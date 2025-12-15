import { Controller, Post, Get, Body, Logger, HttpCode } from '@nestjs/common';
import { EvalService } from './eval.service';
import { EvalExpressionDto } from './dto/eval-expression.dto';
import { EvalResult } from './interfaces/eval-result.interface';

/**
 * Controller for expression evaluation endpoints
 */
@Controller('eval')
export class EvalController {
  private readonly logger = new Logger(EvalController.name);

  constructor(private readonly evalService: EvalService) {}

  /**
   * Evaluate a Noir expression
   *
   * @example POST /api/eval
   * {
   *   "expression": "Poseidon2::hash([$x, $y], 2)",
   *   "context": {
   *     "inputs": { "x": 123, "y": 456 }
   *   }
   * }
   */
  @Post()
  @HttpCode(200)
  async evaluate(@Body() dto: EvalExpressionDto): Promise<EvalResult> {
    this.logger.log(`Evaluating expression: ${dto.expression.substring(0, 50)}...`);
    return this.evalService.evaluateExpression(dto);
  }

  /**
   * Health check for the eval service
   */
  @Get('health')
  async health(): Promise<{ status: string; message: string }> {
    return this.evalService.checkHealth();
  }
}
