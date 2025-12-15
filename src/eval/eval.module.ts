import { Module } from '@nestjs/common';
import { EvalController } from './eval.controller';
import { EvalService } from './eval.service';

@Module({
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService],
})
export class EvalModule {}
