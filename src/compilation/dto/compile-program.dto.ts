import { IsString, IsOptional } from 'class-validator';

export class CompileProgramDto {
  @IsString()
  sourceCode: string; // Noir source code (main.nr)

  @IsString()
  @IsOptional()
  cargoToml?: string; // Nargo.toml content (optional, will use default if not provided)
}
