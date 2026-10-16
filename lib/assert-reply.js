// Checks a model's reply to one evaluation case: it must be a JSON object, it
// must satisfy the case's JSON Schema, and it must meet the case's
// expectations. Nothing here knows which application the reply is for.
//
// A case has:
//   schema:  a JSON Schema (2020-12) the parsed reply must satisfy
//   expect:  a list of checks, each on a dotted path into the reply
//            ("action.payload.question", array items by number: "a.0.b"):
//              { path, exists: true|false }
//              { path, equals: value }        deep equality
//              { path, in: [values] }
//              { path, type: "string"|"number"|"integer"|"boolean"|"object"|"array"|"null" }
//              { path, matches: "regex" }     on a string, case-insensitive with "flags: i"
//              { path, contains: "text" }     on a string or an array
//              { path, notEmpty: true }       a non-blank string, or a non-empty array/object
//              { path, minItems: n }          on an array
//            or { anyOf: [ [checks], [checks] ] }: at least one list passes completely.
//
// Score: 0 when the reply is not JSON or breaks the schema; otherwise the
// share of expectations met. A reply passes only when it scores 1.
const Ajv2020 = require("ajv/dist/2020");

const ajv = new Ajv2020({ allErrors: true, strict: false });

// stripCodeFence removes one surrounding markdown code fence, with or without
// a language tag. The assistant's engine does the same before parsing.
function stripCodeFence(text) {
  const t = String(text).trim();
  if (!t.startsWith("```") || !t.endsWith("```") || t.length < 6) return t;
  let inner = t.slice(3, -3);
  const newline = inner.indexOf("\n");
  if (newline >= 0 && !/[{[]/.test(inner.slice(0, newline))) inner = inner.slice(newline + 1);
  return inner.trim();
}

// getPath reads a dotted path. A missing step gives { found: false }.
function getPath(root, dotted) {
  let node = root;
  if (dotted === "" || dotted === "$") return { found: true, value: node };
  for (const key of dotted.split(".")) {
    if (node !== null && typeof node === "object" && Object.hasOwn(node, key)) {
      node = node[key];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: node };
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function deepEqual(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

function show(value) {
  const text = JSON.stringify(value);
  return text === undefined ? "nothing" : text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

const CHECK_KEYS = ["exists", "equals", "in", "type", "matches", "contains", "notEmpty", "minItems"];

// runCheck returns null when the check passes, otherwise why it failed.
function runCheck(reply, check) {
  if (Array.isArray(check.anyOf)) {
    const reasons = [];
    for (const group of check.anyOf) {
      const failed = group.map((c) => runCheck(reply, c)).filter(Boolean);
      if (failed.length === 0) return null;
      reasons.push(failed.join(" and "));
    }
    return `none of the alternatives held: (${reasons.join(") or (")})`;
  }
  if (typeof check.path !== "string") throw new Error(`a check needs a "path" or "anyOf": ${JSON.stringify(check)}`);
  const keys = CHECK_KEYS.filter((k) => Object.hasOwn(check, k));
  if (keys.length !== 1) throw new Error(`a check on "${check.path}" needs exactly one of ${CHECK_KEYS.join(", ")}: ${JSON.stringify(check)}`);

  const { found, value } = getPath(reply, check.path);
  const key = keys[0];
  if (key === "exists") {
    if (check.exists === found) return null;
    return check.exists ? `expected ${check.path} to be present` : `expected ${check.path} to be absent, got ${show(value)}`;
  }
  if (!found) return `expected ${check.path} to be present`;

  switch (key) {
    case "equals":
      return deepEqual(value, check.equals) ? null : `expected ${check.path} to equal ${show(check.equals)}, got ${show(value)}`;
    case "in":
      return check.in.some((v) => deepEqual(v, value)) ? null : `expected ${check.path} to be one of ${show(check.in)}, got ${show(value)}`;
    case "type": {
      const actual = typeOf(value);
      const ok = actual === check.type || (check.type === "number" && actual === "integer");
      return ok ? null : `expected ${check.path} to be a ${check.type}, got ${actual}`;
    }
    case "matches":
      if (typeof value !== "string") return `expected ${check.path} to be a string matching /${check.matches}/, got ${typeOf(value)}`;
      return new RegExp(check.matches, check.flags ?? "").test(value) ? null : `expected ${check.path} to match /${check.matches}/, got ${show(value)}`;
    case "contains":
      if (typeof value === "string") return value.includes(check.contains) ? null : `expected ${check.path} to contain ${show(check.contains)}, got ${show(value)}`;
      if (Array.isArray(value)) return value.some((v) => deepEqual(v, check.contains)) ? null : `expected ${check.path} to contain ${show(check.contains)}, got ${show(value)}`;
      return `expected ${check.path} to be a string or an array, got ${typeOf(value)}`;
    case "notEmpty": {
      const empty = typeof value === "string" ? value.trim() === ""
        : Array.isArray(value) ? value.length === 0
          : value !== null && typeof value === "object" ? Object.keys(value).length === 0
            : value === null;
      return empty ? `expected ${check.path} not to be empty` : null;
    }
    case "minItems":
      if (!Array.isArray(value)) return `expected ${check.path} to be an array, got ${typeOf(value)}`;
      return value.length >= check.minItems ? null : `expected ${check.path} to have at least ${check.minItems} items, got ${value.length}`;
    default:
      throw new Error(`unreachable check key ${key}`);
  }
}

function schemaProblems(validate) {
  return (validate.errors ?? []).slice(0, 5).map((e) => `${e.instancePath || "(reply)"} ${e.message}`).join("; ");
}

// assertReply scores a raw model reply against a case. Throws when the case
// itself is malformed (a bad schema or check), so a broken case is never
// mistaken for a model failure.
function assertReply(raw, testCase) {
  const validate = ajv.compile(testCase.schema ?? {});
  const text = stripCodeFence(raw ?? "");

  let reply;
  try {
    reply = JSON.parse(text);
  } catch (err) {
    return { pass: false, score: 0, reason: `reply is not valid JSON: ${err.message}` };
  }
  if (reply === null || typeof reply !== "object" || Array.isArray(reply)) {
    return { pass: false, score: 0, reason: `reply must be a JSON object, got ${typeOf(reply)}` };
  }
  if (!validate(reply)) {
    return { pass: false, score: 0, reason: `reply breaks the schema: ${schemaProblems(validate)}` };
  }

  const checks = testCase.expect ?? [];
  const failures = checks.map((c) => runCheck(reply, c)).filter(Boolean);
  if (failures.length === 0) return { pass: true, score: 1, reason: "reply meets the schema and all expectations" };
  return { pass: false, score: (checks.length - failures.length) / checks.length, reason: failures.join("; ") };
}

module.exports = { assertReply, stripCodeFence, getPath };
