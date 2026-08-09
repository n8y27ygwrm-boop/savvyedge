import {
  OrchestratorRuntime,
  installProcessSignalHandlers,
} from "../src/runtime/orchestrator-runtime";

const runtime = new OrchestratorRuntime();
installProcessSignalHandlers(runtime);

void runtime.run();
