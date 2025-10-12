import { IsString, IsNumber } from 'class-validator';

export class SetBreakpointDto {
  @IsString()
  sessionId: string;

  @IsNumber()
  line: number;
}
