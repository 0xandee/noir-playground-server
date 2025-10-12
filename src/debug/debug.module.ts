import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { DebugService } from './debug.service';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [AppConfigModule],
  controllers: [DebugController],
  providers: [DebugService],
  exports: [DebugService],
})
export class DebugModule {}
