import { installZaiContentRuntime } from "@/zai/content-runtime";

export default defineContentScript({
  matches: ["https://chat.z.ai/*"],
  main(ctx) {
    const coordinator = installZaiContentRuntime();
    ctx.onInvalidated(() => coordinator.dispose());
  }
});
