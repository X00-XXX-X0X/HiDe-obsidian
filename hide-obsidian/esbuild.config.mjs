import esbuild from "esbuild";
import { builtinModules as builtins } from "node:module";

const watch = process.argv.includes("--watch");
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language",
    "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr", ...builtins],
  format: "cjs", target: "es2020", logLevel: "info", sourcemap: false, treeShaking: true, outfile: "main.js",
});
if (watch) await ctx.watch(); else { await ctx.rebuild(); await ctx.dispose(); }
