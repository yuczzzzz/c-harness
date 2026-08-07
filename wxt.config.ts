import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "../entrypoints",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "c-harness",
    description: "Enhance supported web LLMs with locally imported Skills and MCP tools.",
    version: "0.1.1",
    minimum_chrome_version: "114",
    host_permissions: ["https://chat.deepseek.com/*", "https://chat.z.ai/*"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "c-harness",
      default_popup: "options.html"
    }
  }
});
