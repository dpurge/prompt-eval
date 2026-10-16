// Builds a throwaway prompt-eval root and application directory so the app
// registry and sync tests never touch the real repositories.
const fs = require("fs");
const os = require("os");
const path = require("path");

const ENTRY = `name: demo
promptDir: prompt/demo
target:
  root: ../demo-app
  env: DEMO_DIR
  prompts: internal/prompts
template: system.txt
axes:
  - { dir: lang, file: rules.txt, placeholder: languageRules, selector: language }
  - { dir: output, file: rules.txt, placeholder: outputRules, selector: output }
`;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// makeFixture returns { root, appDir, entryFile, write(rel, text), read(rel),
// appPath(rel) }. root plays prompt-eval, appDir the application.
function makeFixture({ entry = ENTRY, files = {} } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "app-fixture-"));
  const root = path.join(base, "prompt-eval");
  const appDir = path.join(base, "demo-app");
  fs.mkdirSync(appDir, { recursive: true });
  write(path.join(root, "apps", "demo.yaml"), entry);
  const defaults = {
    "prompt/demo/system.txt": "Base {{languageRules}} {{outputRules}}\n",
    "prompt/demo/lang/xaa/rules.txt": "Rules A\n",
    "prompt/demo/lang/xbb/rules.txt": "Rules B\n",
    "prompt/demo/output/quiz/rules.txt": "Quiz\n",
  };
  for (const [rel, text] of Object.entries({ ...defaults, ...files })) write(path.join(root, rel), text);
  return {
    base,
    root,
    appDir,
    entryFile: path.join(root, "apps", "demo.yaml"),
    write: (rel, text) => write(path.join(root, rel), text),
    read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    appPath: (rel) => path.join(appDir, rel),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

module.exports = { makeFixture, ENTRY, write };
