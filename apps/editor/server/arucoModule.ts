import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const exportsByFile: Readonly<Record<string, string>> = { aruco: "AR", cv: "CV", posit1: "POS", svd: "SVD" };
const arucoFile = (id: string) => id.split("?")[0].match(/\/node_modules\/js-aruco2\/src\/(aruco|cv|posit1|svd)\.js$/)?.[1];

// Adapt the pinned js-aruco2 release's UMD-style globals to ES modules in dev and in both builds.
export function arucoModule(): Plugin {
  return {
    name: "sceneforge-aruco-module",
    enforce: "pre",
    transform(code, id) {
      const file = arucoFile(id);
      if (!file) return;
      const binding = exportsByFile[file];
      const moduleCode = code
        .replace(`this.${binding} = ${binding};`, `export { ${binding} };`)
        .replace(/var (CV|SVD) = this\.\1 \|\| require\('\.(\/(cv|svd))'\)\.\1;/,
          (_declaration, dependency: string, path: string) => `import { ${dependency} } from ".${path}.js";`);
      return { code: moduleCode, map: null };
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const source = chunk.moduleIds.find(arucoFile);
        if (source) {
          const license = readFileSync(resolve(dirname(source), "../LICENSE.txt"), "utf8");
          chunk.code = `/*! js-aruco2\n${license}\n*/\n${chunk.code}`;
        }
      }
    },
  };
}
