import { installDeepSeekContentRuntime } from "@/deepseek/content-runtime";

export default defineContentScript({
  matches: ["https://chat.deepseek.com/*"],
  main(ctx) {
    const coordinator = installDeepSeekContentRuntime();
    ctx.onInvalidated(() => coordinator.dispose());
  }
});
