import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { ProfilingModule } from "./profiling/profiling.module";
import { CompilationModule } from "./compilation/compilation.module";
import { DebugModule } from "./debug/debug.module";
import { EvalModule } from "./eval/eval.module";
import { AppConfigModule } from "./config/config.module";

@Module({
  imports: [AppConfigModule, ProfilingModule, CompilationModule, DebugModule, EvalModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
