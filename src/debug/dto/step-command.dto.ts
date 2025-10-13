import { IsString, IsIn } from 'class-validator';

export class StepCommandDto {
  @IsString()
  sessionId: string;

  @IsString()
  @IsIn(['next', 'into', 'out', 'over', 'continue', 'step'])
  command: 'next' | 'into' | 'out' | 'over' | 'continue' | 'step';
}
