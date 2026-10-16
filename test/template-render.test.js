const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRenderer, rendererFromApp } = require("../lib/template-render");
const { loadApp } = require("../lib/app-registry");
const { makeFixture } = require("./helpers/app-fixture");

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vectors", "template-render.json"), "utf8"));

test("the vector file describes the two axes the vectors use", () => {
  assert.deepEqual(vectors.axes.map((a) => [a.dir, a.placeholder, a.selector]), [
    ["lang", "languageRules", "language"],
    ["output", "outputRules", "output"],
  ]);
  assert.ok(vectors.vectors.length >= 15, "enough vectors to mean something");
  assert.ok(vectors.errors.length >= 6);
  const names = [...vectors.vectors, ...vectors.errors].map((v) => v.name);
  assert.equal(new Set(names).size, names.length, "vector names are unique");
});

for (const v of vectors.vectors) {
  test(`vector: ${v.name}`, () => {
    const renderer = createRenderer({ template: v.template, axes: vectors.axes, snippets: v.snippets });
    assert.equal(renderer.render(v.vars), v.expected);
  });
}

for (const v of vectors.errors) {
  test(`vector error: ${v.name}`, () => {
    assert.throws(() => createRenderer({ template: v.template, axes: vectors.axes, snippets: v.snippets }), (err) => {
      assert.ok(err.message.includes(v.error), `"${err.message}" should contain "${v.error}"`);
      return true;
    });
  });
}

test("errors name the file that holds the bad placeholder", () => {
  const axes = vectors.axes;
  assert.throws(() => createRenderer({ template: "{{x}}", templateName: "step.system.txt", axes }), /^Error: step\.system\.txt: unknown placeholder \{\{x\}\}/);
  assert.throws(
    () => createRenderer({ template: "ok", axes, snippets: { lang: { xaa: "{{x}}" } } }),
    /^Error: lang\/xaa\/rules\.txt: unknown placeholder \{\{x\}\}/,
  );
});

test("several unknown placeholders are all listed, once each, in order", () => {
  assert.throws(() => createRenderer({ template: "{{b}} {{a}} {{b}}", axes: [] }), /unknown placeholder \{\{a\}\}, \{\{b\}\}/);
});

test("rendering does not change the renderer: the same input gives the same output", () => {
  const renderer = createRenderer({
    template: "{{languageRules}}|{{language}}",
    axes: vectors.axes,
    snippets: { lang: { xaa: "A for {{language}}" } },
  });
  const first = renderer.render({ language: "xaa" });
  assert.equal(renderer.render({ language: "xbb" }), "|xbb");
  assert.equal(renderer.render({ language: "xaa" }), first);
});

test("inherited object keys are not snippet names", () => {
  const renderer = createRenderer({ template: "[{{languageRules}}]", axes: vectors.axes, snippets: { lang: { xaa: "A" } } });
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(renderer.render({ language: name }), `[]`, name);
  }
});

test("an app without axes renders just its template", () => {
  assert.equal(createRenderer({ template: "  plain  ", axes: [] }).render({ language: "xaa" }), "plain");
});

test("rendererFromApp reads the template and snippets from the prompt tree", () => {
  const f = makeFixture({});
  try {
    const app = loadApp("demo", { root: f.root, env: {} });
    const r = rendererFromApp(app);
    assert.equal(r.render({ language: "xaa", output: "quiz" }), "Base Rules A Quiz");
    assert.equal(r.render({ language: "xbb" }), "Base Rules B");
    assert.equal(r.render({}), "Base");
  } finally {
    f.cleanup();
  }
});

test("rendererFromApp refuses a snippet that uses an unknown placeholder", () => {
  const f = makeFixture({ files: { "prompt/demo/lang/xaa/rules.txt": "bad {{nope}}\n" } });
  try {
    assert.throws(() => rendererFromApp(loadApp("demo", { root: f.root, env: {} })), /lang\/xaa\/rules\.txt: unknown placeholder \{\{nope\}\}/);
  } finally {
    f.cleanup();
  }
});

test("the assistant's real prompt tree renders for every language and output kind it has", () => {
  const app = loadApp("assistant", { env: {} });
  const r = rendererFromApp(app);
  const langs = fs.existsSync(path.join(app.promptDir, "lang")) ? fs.readdirSync(path.join(app.promptDir, "lang")) : [];
  const outputs = fs.existsSync(path.join(app.promptDir, "output")) ? fs.readdirSync(path.join(app.promptDir, "output")) : [];
  for (const language of ["", ...langs]) {
    for (const output of ["", ...outputs]) {
      const text = r.render({ language, output });
      assert.doesNotMatch(text, /\{\{/, `unfilled placeholder for ${language}/${output}`);
    }
  }
});
