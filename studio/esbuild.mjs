// Three bundles, three targets:
//   extension — CJS, because that is what VS Code's extension host loads.
//   runner    — ESM, because it dynamically imports the user's ESM modules.
//   webview   — IIFE, because the panel loads it with a plain <script nonce>.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "out/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    // `vscode` is supplied by the extension host at runtime; bundling it would
    // break it. `typescript` is the parser the source layer reads the user's
    // file with — VS Code ships one but does not expose it to extensions, so it
    // is carried as a dependency and loaded normally rather than inlined into a
    // single very large bundle.
    external: ["vscode", "typescript"],
  },
  {
    ...common,
    entryPoints: ["src/runner/main.ts"],
    outfile: "out/runner.mjs",
    platform: "node",
    format: "esm",
    target: "node20",
  },
  {
    ...common,
    entryPoints: ["src/webview/main.ts"],
    outfile: "out/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
  },
  {
    ...common,
    entryPoints: ["src/webview/styles.css"],
    outfile: "out/webview.css",
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
