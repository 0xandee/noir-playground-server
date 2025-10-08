import { Module } from '@nestjs/common';
import { CompilationController } from './compilation.controller';
import { CompilationService } from './compilation.service';

@Module({
  controllers: [CompilationController],
  providers: [CompilationService],
  exports: [CompilationService],
})
export class CompilationModule {}
