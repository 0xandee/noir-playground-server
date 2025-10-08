import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CompilationService } from './compilation.service';
import { CompileProgramDto } from './dto/compile-program.dto';
import { CompilationResult } from './interfaces/compilation-result.interface';

@Controller('compile')
export class CompilationController {
  constructor(private readonly compilationService: CompilationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async compileProgram(
    @Body() dto: CompileProgramDto,
  ): Promise<CompilationResult> {
    return this.compilationService.compileProgram(dto);
  }

  @Get('check-nargo')
  async checkNargo() {
    return this.compilationService.checkNargoAvailability();
  }
}
