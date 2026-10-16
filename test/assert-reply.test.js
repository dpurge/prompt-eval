const test = require("node:test");
const assert = require("node:assert/strict");
const { assertReply, stripCodeFence, getPath } = require("../lib/assert-reply");
const chatPrompt = require("../lib/promptfoo-chat-prompt");
const promptfooAssert = require("../lib/promptfoo-assert-reply");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["state_patch", "action"],
  properties: {
    state_patch: { type: "object" },
    action: {
      oneOf: [
        { type: "object", required: ["type", "tool"], properties: { type: { const: "tool" }, tool: { enum: ["rag_search", "memory_search"] }, args: { type: "object" } } },
        { type: "object", required: ["type", "payload"], properties: { type: { const: "ask_user" }, payload: { type: "object" } } },
      ],
    },
  },
};

const toolReply = JSON.stringify({ state_patch: { goal: "Arabic" }, action: { type: "tool", tool: "rag_search", args: { query: "program" } } });
const askReply = JSON.stringify({ state_patch: {}, action: { type: "ask_user", payload: { question: "What is your goal?" } } });

test("a reply meeting the schema and every expectation passes with full score", () => {
  const r = assertReply(toolReply, {
    schema,
    expect: [
      { path: "action.type", in: ["tool", "ask_user"] },
      { path: "action.tool", equals: "rag_search" },
      { path: "state_patch.goal", exists: true },
    ],
  });
  assert.deepEqual([r.pass, r.score], [true, 1]);
});

test("a case without expectations passes on the schema alone", () => {
  assert.equal(assertReply(askReply, { schema }).pass, true);
});

test("a reply that is not JSON scores zero and says why", () => {
  for (const raw of ["", "I would call rag_search", "{broken", undefined, null]) {
    const r = assertReply(raw, { schema });
    assert.deepEqual([r.pass, r.score], [false, 0], String(raw));
    assert.match(r.reason, /not valid JSON/);
  }
});

test("JSON that is not an object is refused", () => {
  for (const raw of ["[]", "3", '"text"', "null", "true"]) {
    const r = assertReply(raw, { schema });
    assert.equal(r.pass, false, raw);
    assert.match(r.reason, /must be a JSON object|not valid JSON/);
  }
});

test("a reply wrapped in a code fence is accepted, as the engine accepts it", () => {
  assert.equal(assertReply("```json\n" + askReply + "\n```", { schema }).pass, true);
  assert.equal(assertReply("```\n" + askReply + "\n```", { schema }).pass, true);
});

test("prose around the JSON is not accepted", () => {
  assert.equal(assertReply("Sure! " + askReply, { schema }).pass, false);
});

test("a reply that breaks the schema scores zero and names the problem", () => {
  const bad = JSON.stringify({ state_patch: [], action: { type: "tool", tool: "delete_all" } });
  const r = assertReply(bad, { schema });
  assert.deepEqual([r.pass, r.score], [false, 0]);
  assert.match(r.reason, /breaks the schema: .*\/state_patch/);
});

test("extra keys are caught by the schema, not by the expectations", () => {
  const r = assertReply(JSON.stringify({ state_patch: {}, action: { type: "ask_user", payload: {} }, why: "x" }), { schema });
  assert.equal(r.score, 0);
  assert.match(r.reason, /additional properties/);
});

test("the score is the share of expectations met", () => {
  const r = assertReply(toolReply, {
    schema,
    expect: [
      { path: "action.type", equals: "tool" },
      { path: "action.tool", equals: "memory_search" },
      { path: "state_patch.goal", exists: true },
      { path: "state_patch.level", exists: true },
    ],
  });
  assert.equal(r.pass, false);
  assert.equal(r.score, 0.5);
  assert.match(r.reason, /expected action\.tool to equal "memory_search", got "rag_search"/);
  assert.match(r.reason, /expected state_patch\.level to be present/);
});

test("each kind of check passes and fails with a clear message", () => {
  const reply = JSON.stringify({
    state_patch: { goal: "read news", n: 2, list: ["a", "b"], nested: { x: 1 }, blank: "  ", flag: false },
    action: { type: "ask_user", payload: { question: "Why Arabic?" } },
  });
  const run = (check) => assertReply(reply, { schema, expect: [check] });
  const cases = [
    [{ path: "state_patch.goal", equals: "read news" }, null],
    [{ path: "state_patch.goal", equals: "other" }, /to equal "other", got "read news"/],
    [{ path: "state_patch.nested", equals: { x: 1 } }, null],
    [{ path: "state_patch.list", equals: ["a", "b"] }, null],
    [{ path: "state_patch.list", equals: ["b", "a"] }, /to equal/],
    [{ path: "state_patch.n", in: [1, 2] }, null],
    [{ path: "state_patch.n", in: [5] }, /to be one of \[5\], got 2/],
    [{ path: "state_patch.n", type: "integer" }, null],
    [{ path: "state_patch.n", type: "number" }, null],
    [{ path: "state_patch.n", type: "string" }, /to be a string, got integer/],
    [{ path: "state_patch.flag", type: "boolean" }, null],
    [{ path: "state_patch.list", type: "array" }, null],
    [{ path: "state_patch.nested", type: "object" }, null],
    [{ path: "action.payload.question", matches: "arabic" }, /to match/],
    [{ path: "action.payload.question", matches: "arabic", flags: "i" }, null],
    [{ path: "state_patch.n", matches: "2" }, /to be a string matching/],
    [{ path: "state_patch.goal", contains: "news" }, null],
    [{ path: "state_patch.goal", contains: "weather" }, /to contain "weather"/],
    [{ path: "state_patch.list", contains: "b" }, null],
    [{ path: "state_patch.list", contains: "z" }, /to contain "z"/],
    [{ path: "state_patch.n", contains: "2" }, /to be a string or an array/],
    [{ path: "state_patch.goal", notEmpty: true }, null],
    [{ path: "state_patch.blank", notEmpty: true }, /not to be empty/],
    [{ path: "state_patch.nested", notEmpty: true }, null],
    [{ path: "state_patch.list", minItems: 2 }, null],
    [{ path: "state_patch.list", minItems: 3 }, /at least 3 items, got 2/],
    [{ path: "state_patch.goal", minItems: 1 }, /to be an array, got string/],
    [{ path: "state_patch.list.1", equals: "b" }, null],
    [{ path: "state_patch.nested.x", equals: 1 }, null],
    [{ path: "state_patch.missing", exists: false }, null],
    [{ path: "state_patch.goal", exists: false }, /to be absent, got "read news"/],
    [{ path: "state_patch.missing", equals: 1 }, /to be present/],
    [{ path: "state_patch.flag", exists: true }, null],
  ];
  for (const [check, wantFailure] of cases) {
    const r = run(check);
    if (wantFailure === null) assert.equal(r.pass, true, `${JSON.stringify(check)}: ${r.reason}`);
    else {
      assert.equal(r.pass, false, JSON.stringify(check));
      assert.match(r.reason, wantFailure, JSON.stringify(check));
    }
  }
});

test("anyOf passes when one alternative holds completely", () => {
  const check = {
    anyOf: [
      [{ path: "action.type", equals: "tool" }, { path: "action.tool", equals: "memory_search" }],
      [{ path: "action.type", equals: "ask_user" }],
    ],
  };
  assert.equal(assertReply(askReply, { schema, expect: [check] }).pass, true);
  const r = assertReply(toolReply, { schema, expect: [check] });
  assert.equal(r.pass, false);
  assert.match(r.reason, /none of the alternatives held: \(.*action\.tool to equal "memory_search".*\) or \(.*action\.type to equal "ask_user".*\)/);
});

test("malformed cases throw instead of failing the model", () => {
  assert.throws(() => assertReply(askReply, { schema, expect: [{ equals: 1 }] }), /needs a "path" or "anyOf"/);
  assert.throws(() => assertReply(askReply, { schema, expect: [{ path: "a" }] }), /needs exactly one of/);
  assert.throws(() => assertReply(askReply, { schema, expect: [{ path: "a", exists: true, equals: 1 }] }), /needs exactly one of/);
  assert.throws(() => assertReply(askReply, { schema: { type: "banana" } }), /schema|type/i);
});

test("getPath reads objects and array items, and reports what is missing", () => {
  const root = { a: { b: [{ c: 1 }, { c: 2 }] }, n: null };
  assert.deepEqual(getPath(root, "a.b.1.c"), { found: true, value: 2 });
  assert.deepEqual(getPath(root, "n"), { found: true, value: null });
  assert.deepEqual(getPath(root, "a.x"), { found: false, value: undefined });
  assert.deepEqual(getPath(root, "a.b.9"), { found: false, value: undefined });
  assert.deepEqual(getPath(root, "n.x"), { found: false, value: undefined });
  assert.equal(getPath(root, "$").value, root);
  assert.equal(getPath(root, "").value, root);
  assert.equal(getPath(root, "constructor").found, false, "inherited properties are not paths");
});

test("stripCodeFence follows the same rules as the engine", () => {
  const cases = {
    '{"a":1}': '{"a":1}',
    '```json\n{"a":1}\n```': '{"a":1}',
    '```\n{"a":1}\n```': '{"a":1}',
    '```{"a":1}```': '{"a":1}',
    "```": "```",
    "``````": "",
    'text ```json\n{}\n```': 'text ```json\n{}\n```',
    '```json\n{}\n``` trailing': '```json\n{}\n``` trailing',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(stripCodeFence(input), want, JSON.stringify(input));
});

test("the promptfoo glue reads the case from the test vars", async () => {
  const vars = { schema: JSON.stringify(schema), expect: JSON.stringify([{ path: "action.type", equals: "ask_user" }]) };
  assert.equal((await promptfooAssert(askReply, { vars })).pass, true);
  assert.equal((await promptfooAssert(toolReply, { vars })).pass, false);
  const parsedVars = { schema, expect: [] };
  assert.equal((await promptfooAssert(askReply, { vars: parsedVars })).pass, true);
});

test("the chat prompt is one system and one user message", () => {
  assert.deepEqual(chatPrompt({ vars: { system: "S", input: "{}" } }), [
    { role: "system", content: "S" },
    { role: "user", content: "{}" },
  ]);
});
