import { IsString, IsOptional, IsObject, IsNumber } from 'class-validator';

/**
 * DTO for evaluating a Noir expression
 */
export class EvalExpressionDto {
  /**
   * The expression to evaluate
   * @example "Poseidon2::hash([$x, $y], 2)"
   */
  @IsString()
  expression: string;

  /**
   * Context for variable resolution
   */
  @IsObject()
  context: {
    /**
     * Resolved input values (already-evaluated dependencies)
     */
    inputs: Record<string, string | number>;

    /**
     * Optional Nargo.toml content for external dependencies
     */
    cargoToml?: string;
  };

  /**
   * Optional evaluation settings
   */
  @IsOptional()
  @IsObject()
  options?: {
    /**
     * Maximum evaluation time in milliseconds
     */
    timeout?: number;
  };
}
