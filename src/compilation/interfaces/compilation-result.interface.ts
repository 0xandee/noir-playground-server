export interface CompilationResult {
  success: boolean;
  artifact?: any; // Compiled program artifact JSON
  warnings?: string[];
  error?: string;
  compilationTime?: number;
}

export interface PackageInfo {
  name: string;
  type: string;
  compilerVersion?: string;
}
