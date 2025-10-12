import { IsString, IsOptional, IsObject } from 'class-validator';

export class StartDebugSessionDto {
  @IsString()
  sourceCode: string; // Noir source code (main.nr)

  @IsString()
  @IsOptional()
  cargoToml?: string; // Nargo.toml content (optional)

  @IsObject()
  inputs: Record<string, any>; // Circuit inputs (e.g., { x: "5", y: "3" })
}
