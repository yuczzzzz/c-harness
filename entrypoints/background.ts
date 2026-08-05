import { installBackgroundRuntime } from "@/background/runtime";

export default defineBackground(() => {
  installBackgroundRuntime();
});
