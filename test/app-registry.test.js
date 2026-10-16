const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadApp } = require("../lib/app-registry");
const { makeFixture, ENTRY } = require("./helpers/app-fixture");

function withFixture(opts, fn) {
  const f = makeFixture(opts);
  try {
    return fn(f);
  } finally {
    f.cleanup();
  }
}

test("a valid entry resolves to absolute paths", () => {
  withFixture({}, (f) => {
    const app = loadApp("demo", { root: f.root, env: {} });
    assert.equal(app.name, "demo");
    assert.equal(app.promptDir, path.join(f.root, "prompt", "demo"));
    assert.equal(app.targetRoot, f.appDir);
    assert.equal(app.promptsTarget, path.join(f.appDir, "internal", "prompts"));
    assert.equal(app.template, "system.txt");
    assert.deepEqual(app.axes.map((a) => a.placeholder), ["languageRules", "outputRules"]);
    assert.deepEqual(app.files, []);
  });
});

test("the environment variable overrides the target root", () => {
  withFixture({}, (f) => {
    const app = loadApp("demo", { root: f.root, env: { DEMO_DIR: "/somewhere/else" } });
    assert.equal(app.targetRoot, "/somewhere/else");
    assert.equal(app.promptsTarget, path.join("/somewhere/else", "internal", "prompts"));
  });
});

test("an empty environment variable does not override", () => {
  withFixture({}, (f) => {
    assert.equal(loadApp("demo", { root: f.root, env: { DEMO_DIR: "" } }).targetRoot, f.appDir);
  });
});

test("extra files resolve against both roots", () => {
  withFixture({
    entry: ENTRY + "files:\n  - { from: vectors/v.json, to: testdata/v.json }\n",
    files: { "vectors/v.json": "{}" },
  }, (f) => {
    const app = loadApp("demo", { root: f.root, env: {} });
    assert.deepEqual(app.files, [{ from: path.join(f.root, "vectors", "v.json"), to: path.join(f.appDir, "testdata", "v.json") }]);
  });
});

test("application names that could leave apps/ are refused", () => {
  withFixture({}, (f) => {
    for (const bad of ["../demo", "a/b", "", "demo.yaml", ".hidden", undefined, 7]) {
      assert.throws(() => loadApp(bad, { root: f.root, env: {} }), /invalid application name/, String(bad));
    }
  });
});

test("an unknown application names the expected file", () => {
  withFixture({}, (f) => {
    assert.throws(() => loadApp("nope", { root: f.root, env: {} }), /no registry entry for "nope": expected .*nope\.yaml/);
  });
});

test("the name in the file must match the file name", () => {
  withFixture({ entry: ENTRY.replace("name: demo", "name: other") }, (f) => {
    assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /name is "other", expected "demo"/);
  });
});

test("every required key is checked", () => {
  const cases = {
    promptDir: ENTRY.replace("promptDir: prompt/demo\n", ""),
    "target.env": ENTRY.replace("  env: DEMO_DIR\n", ""),
    "target.root": ENTRY.replace("  root: ../demo-app\n", ""),
    "target.prompts": ENTRY.replace("  prompts: internal/prompts\n", ""),
    template: ENTRY.replace("template: system.txt\n", ""),
    axes: ENTRY.slice(0, ENTRY.indexOf("axes:")),
  };
  for (const [key, entry] of Object.entries(cases)) {
    withFixture({ entry }, (f) => {
      assert.throws(() => loadApp("demo", { root: f.root, env: {} }), new RegExp(key.split(".").pop()), key);
    });
  }
});

test("a registry file that is not a mapping or not YAML is refused", () => {
  withFixture({ entry: "- just\n- a list\n" }, (f) => assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /must be a mapping/));
  withFixture({ entry: "name: [unclosed\n" }, (f) => assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /not valid YAML/));
});

test("the prompt directory and template must exist", () => {
  withFixture({ entry: ENTRY.replace("prompt/demo", "prompt/missing") }, (f) => {
    assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /promptDir .* does not exist/);
  });
  withFixture({ entry: ENTRY.replace("template: system.txt", "template: other.txt") }, (f) => {
    assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /template other\.txt not found/);
  });
});

test("paths that leave their root are refused", () => {
  for (const [from, to, pattern] of [
    ["promptDir: prompt/demo", "promptDir: ../outside", /promptDir .* leaves/],
    ["promptDir: prompt/demo", "promptDir: /abs/path", /must be relative/],
    ["prompts: internal/prompts", "prompts: ../../escape", /target\.prompts .* leaves/],
    ["prompts: internal/prompts", "prompts: /abs", /must be relative/],
  ]) {
    withFixture({ entry: ENTRY.replace(from, to) }, (f) => assert.throws(() => loadApp("demo", { root: f.root, env: {} }), pattern, to));
  }
  withFixture({
    entry: ENTRY + "files:\n  - { from: vectors/v.json, to: ../escape.json }\n",
    files: { "vectors/v.json": "{}" },
  }, (f) => assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /files\[0\]\.to .* leaves/));
  withFixture({ entry: ENTRY + "files:\n  - { from: ../x.json, to: a.json }\n" }, (f) => {
    assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /files\[0\]\.from .* leaves/);
  });
});

test("an extra file whose source is missing is refused", () => {
  withFixture({ entry: ENTRY + "files:\n  - { from: vectors/none.json, to: a.json }\n" }, (f) => {
    assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /files\[0\]\.from .* does not exist/);
  });
});

test("axis names must be plain and unique", () => {
  const axes = (a, b) => ENTRY.slice(0, ENTRY.indexOf("axes:")) + `axes:\n  - ${a}\n  - ${b}\n`;
  const ok = "{ dir: lang, file: rules.txt, placeholder: languageRules, selector: language }";
  const cases = [
    [ok.replace("dir: lang", "dir: ../lang"), "{ dir: output, file: rules.txt, placeholder: outputRules, selector: output }", /dir .* not a plain directory name/],
    [ok.replace("rules.txt", "../rules.txt"), "{ dir: output, file: rules.txt, placeholder: outputRules, selector: output }", /file .* not a plain file name/],
    [ok.replace("languageRules", "language Rules"), "{ dir: output, file: rules.txt, placeholder: outputRules, selector: output }", /placeholder .* not an identifier/],
    [ok, ok, /is used by another axis/],
    [ok, "{ dir: output, file: rules.txt, placeholder: languageRules, selector: output }", /placeholder "languageRules" is used by another axis/],
    [ok, "{ dir: output, file: rules.txt, placeholder: outputRules, selector: language }", /selector "language" is used by another axis/],
  ];
  for (const [a, b, pattern] of cases) {
    withFixture({ entry: axes(a, b) }, (f) => assert.throws(() => loadApp("demo", { root: f.root, env: {} }), pattern, `${a} / ${b}`));
  }
});

test("axes may be empty, and the template must be a plain file name", () => {
  withFixture({ entry: ENTRY.slice(0, ENTRY.indexOf("axes:")) + "axes: []\n" }, (f) => {
    assert.deepEqual(loadApp("demo", { root: f.root, env: {} }).axes, []);
  });
  withFixture({ entry: ENTRY.replace("template: system.txt", "template: ../system.txt") }, (f) => {
    assert.throws(() => loadApp("demo", { root: f.root, env: {} }), /template .* not a plain file name/);
  });
});

test("the real assistant entry loads", () => {
  const app = loadApp("assistant", { env: {} });
  assert.equal(app.name, "assistant");
  assert.equal(app.template, "step.system.txt");
  assert.deepEqual(app.axes.map((a) => a.selector), ["language", "output"]);
});
