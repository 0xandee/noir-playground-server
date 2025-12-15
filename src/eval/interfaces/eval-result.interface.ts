/**
 * Result of expression evaluation
 */
export interface EvalResult {
  /**
   * Whether evaluation succeeded
   */
  success: boolean;

  /**
   * The evaluated result (field element as string)
   */
  result?: string;

  /**
   * Type of the result
   */
  resultType?: 'Field' | 'u8' | 'u32' | 'u64' | 'bool' | 'array';

  /**
   * Error message if evaluation failed
   */
  error?: string;

  /**
   * Evaluation time in milliseconds
   */
  evaluationTime?: number;
}
