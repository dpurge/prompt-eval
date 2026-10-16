const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { main } = require("../scripts/sync-app");
const { loadApp } = require("../lib/app-registry");
const { planSync, managedPromptFiles } = require("../lib/app-sync");
const { makeFixture, ENTRY, write } = require("./helpers/app-fixture");

function run(f, args) {
  const out = [];
  const err = [];
  const code = main(args, { root: f.root, env: {}, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function withFixture(opts, fn) {
  const f = makeFixture(opts);
  try {
    return fn(f);
  } finally {
    f.cleanup();
  }
}

test("sync copies the template and every snippet, creating directories", () => {
  withFixture({}, (f) => {
    const r = run(f, ["demo"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(f.appPath("internal/prompts/system.txt"), "utf8"), "Base {{languageRules}} {{outputRules}}\n");
    assert.equal(fs.readFileSync(f.appPath("internal/prompts/lang/xaa/rules.txt"), "utf8"), "Rules A\n");
    assert.equal(fs.readFileSync(f.appPath("internal/prompts/lang/xbb/rules.txt"), "utf8"), "Rules B\n");
    assert.equal(fs.readFileSync(f.appPath("internal/prompts/output/quiz/rules.txt"), "utf8"), "Quiz\n");
    assert.match(r.out, /4 change\(s\)/);
  });
});

test("a second sync changes nothing", () => {
  withFixture({}, (f) => {
    run(f, ["demo"]);
    const r = run(f, ["demo"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /already in sync \(4 files managed\)/);
  });
});

test("check passes once synced and fails before", () => {
  withFixture({}, (f) => {
    const before = run(f, ["demo", "--check"]);
    assert.equal(before.code, 1);
    assert.match(before.err, /system\.txt is missing/);
    assert.match(before.err, /4 difference\(s\)/);
    run(f, ["demo"]);
    const after = run(f, ["demo", "--check"]);
    assert.equal(after.code, 0, after.err);
    assert.match(after.out, /in sync \(4 files\)/);
  });
});

test("check never writes", () => {
  withFixture({}, (f) => {
    run(f, ["demo", "--check"]);
    assert.equal(fs.existsSync(f.appPath("internal")), false);
  });
});

test("check reports a changed file, byte for byte", () => {
  withFixture({}, (f) => {
    run(f, ["demo"]);
    fs.writeFileSync(f.appPath("internal/prompts/lang/xaa/rules.txt"), "Rules A\r\n");
    const r = run(f, ["demo", "--check"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /lang\/xaa\/rules\.txt differs/);
    assert.doesNotMatch(r.err, /xbb/);
  });
});

test("sync repairs a changed file", () => {
  withFixture({}, (f) => {
    run(f, ["demo"]);
    fs.writeFileSync(f.appPath("internal/prompts/system.txt"), "edited in the application\n");
    const r = run(f, ["demo"]);
    assert.match(r.out, /updated .*system\.txt/);
    assert.equal(run(f, ["demo", "--check"]).code, 0);
  });
});

test("a managed file with no source is reported by check and removed by sync", () => {
  withFixture({}, (f) => {
    run(f, ["demo"]);
    fs.rmSync(path.join(f.root, "prompt/demo/lang/xbb"), { recursive: true });
    const check = run(f, ["demo", "--check"]);
    assert.equal(check.code, 1);
    assert.match(check.err, /lang\/xbb\/rules\.txt has no source any more/);
    assert.ok(fs.existsSync(f.appPath("internal/prompts/lang/xbb/rules.txt")), "check must not remove anything");

    const sync = run(f, ["demo"]);
    assert.match(sync.out, /removed .*lang\/xbb\/rules\.txt/);
    assert.equal(fs.existsSync(f.appPath("internal/prompts/lang/xbb")), false, "the emptied directory is pruned");
    assert.ok(fs.existsSync(f.appPath("internal/prompts/lang/xaa/rules.txt")));
    assert.equal(run(f, ["demo", "--check"]).code, 0);
  });
});

test("unmanaged files are neither copied nor deleted", () => {
  withFixture({ files: { "prompt/demo/NOTES.md": "author notes\n", "prompt/demo/lang/xaa/notes.md": "more notes\n" } }, (f) => {
    write(f.appPath("internal/prompts/handwritten.go"), "package prompts\n");
    write(f.appPath("internal/prompts/lang/xaa/keep.txt"), "kept\n");
    run(f, ["demo"]);
    assert.equal(fs.existsSync(f.appPath("internal/prompts/NOTES.md")), false);
    assert.equal(fs.existsSync(f.appPath("internal/prompts/lang/xaa/notes.md")), false);
    assert.equal(fs.readFileSync(f.appPath("internal/prompts/handwritten.go"), "utf8"), "package prompts\n");
    assert.equal(fs.readFileSync(f.appPath("internal/prompts/lang/xaa/keep.txt"), "utf8"), "kept\n");
    assert.equal(run(f, ["demo", "--check"]).code, 0, "unmanaged files are not differences");
  });
});

test("a language directory without its rules file is ignored", () => {
  withFixture({ files: { "prompt/demo/lang/xcc/draft.txt": "no rules yet\n" } }, (f) => {
    run(f, ["demo"]);
    assert.equal(fs.existsSync(f.appPath("internal/prompts/lang/xcc")), false);
  });
});

test("extra files are synced and checked too", () => {
  withFixture({ entry: ENTRY + "files:\n  - { from: vectors/v.json, to: testdata/v.json }\n", files: { "vectors/v.json": '{"a":1}\n' } }, (f) => {
    assert.equal(run(f, ["demo", "--check"]).code, 1);
    run(f, ["demo"]);
    assert.equal(fs.readFileSync(f.appPath("testdata/v.json"), "utf8"), '{"a":1}\n');
    f.write("vectors/v.json", '{"a":2}\n');
    const r = run(f, ["demo", "--check"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /testdata\/v\.json differs/);
  });
});

test("a snippet directory name that is not plain is an error, not a copy", () => {
  withFixture({ files: { "prompt/demo/lang/bad name/rules.txt": "x\n" } }, (f) => {
    const r = run(f, ["demo"]);
    assert.equal(r.code, 2);
    assert.match(r.err, /name must be letters, digits and "-" only/);
    assert.equal(fs.existsSync(f.appPath("internal")), false, "nothing is written when the plan fails");
  });
});

test("planSync lists managed files in a stable order", () => {
  withFixture({}, (f) => {
    const app = loadApp("demo", { root: f.root, env: {} });
    assert.deepEqual(managedPromptFiles(app, app.promptDir), [
      "lang/xaa/rules.txt", "lang/xbb/rules.txt", "output/quiz/rules.txt", "system.txt",
    ]);
    const plan = planSync(app);
    assert.equal(plan.copies.every((c) => c.status === "missing"), true);
    assert.deepEqual(plan.stale, []);
  });
});

test("usage errors exit 2 with the usage line", () => {
  withFixture({}, (f) => {
    for (const args of [[], ["demo", "other"], ["demo", "--force"], ["--check"]]) {
      const r = run(f, args);
      assert.equal(r.code, 2, JSON.stringify(args));
      assert.match(r.err, /usage: node scripts\/sync-app\.js <app> \[--check\]/);
    }
  });
});

test("a broken registry entry exits 2 with the reason", () => {
  withFixture({}, (f) => {
    assert.equal(run(f, ["nope"]).code, 2);
    assert.match(run(f, ["nope"]).err, /no registry entry for "nope"/);
    assert.match(run(f, ["../x"]).err, /invalid application name/);
  });
});

test("the environment variable redirects the sync to another application directory", () => {
  withFixture({}, (f) => {
    const elsewhere = path.join(f.base, "elsewhere");
    const out = [];
    const code = main(["demo"], { root: f.root, env: { DEMO_DIR: elsewhere }, out: (s) => out.push(s), err: () => {} });
    assert.equal(code, 0);
    assert.ok(fs.existsSync(path.join(elsewhere, "internal/prompts/system.txt")));
    assert.equal(fs.existsSync(f.appPath("internal")), false);
  });
});

test("the generic modules name no application", () => {
  for (const file of ["scripts/sync-app.js", "lib/app-registry.js", "lib/app-sync.js"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(text, /assistant|phraseforge|knowledge|dictionary/i, `${file} must stay application agnostic`);
  }
});
