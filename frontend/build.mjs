// Bundles the panel and the card into the integration's frontend folder.
import { context, build } from "esbuild";
import { fileURLToPath } from "node:url";

const outdir = fileURLToPath(
  new URL("../custom_components/notification_center/frontend/", import.meta.url),
);

const options = {
  entryPoints: {
    "notification-center-panel": "src/panel/notification-center-panel.ts",
    "notification-center-card": "src/card/index.ts",
  },
  outdir,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
