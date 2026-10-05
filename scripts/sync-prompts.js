// Keeps the eval's item prompts and reply schemas identical to what
// phraseforge ships.
//
//   node scripts/sync-prompts.js          write prompts/system.txt of each suite
//                                         from phraseforge's Go defaults
//   node scripts/sync-prompts.js --check  compare instead of writing; also
//                                         compares the deployed Helm values and
//                                         each suite's reply schema; exits 1 on
//                                         any difference
//
// The generate/ suites (translation, transcription, title, processText,
// processDialog, generateVocabulary, generateModels) test the prompts prod
// actually runs: the Helm values, which tune them well beyond phraseforge's Go
// defaults. Without the Helm file the Go defaults are used, with a warning.
// A difference between the two is reported as a note, not as drift.
//
// Paths (override with env vars when the repos live elsewhere):
//   PHRASEFORGE_DIR  default ../k8s-lab/phraseforge
//   HELM_VALUES      default ../jdp-helm/jdp-frontend/values.yaml (skipped with a
//                    warning when the file is absent)
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const root = path.join(__dirname, "..");
const phraseforgeDir = path.resolve(root, process.env.PHRASEFORGE_DIR || "../k8s-lab/phraseforge");
const helmValues = path.resolve(root, process.env.HELM_VALUES || "../jdp-helm/jdp-frontend/values.yaml");

// One entry per suite: the Go constants/vars it must match and the Helm
// values key holding the deployed prompt.
const SUITES = [
  { dir: "vocabulary-translation", goPrompt: "DefaultVocabularyItemPrompt", goSchema: "VocabularyItemSchema", helmKey: "vocabularyItem" },
  { dir: "models-item", goPrompt: "DefaultModelsItemPrompt", goSchema: "ModelsItemSchema", helmKey: "modelsItem" },
];

const SCHEMA_ONLY = [
  { config: "correction/vocabulary.yaml", goSchema: "VocabularyItemSchema" },
  { config: "correction/models.yaml", goSchema: "ModelsItemSchema" },
];

// Purposes called through ai.Service.Generate: the system prompt is a file
// under generate/prompts/<key>.txt, num_ctx comes from the purpose's numCtx.
const GENERATE_PURPOSES = [
  { key: "translation", goField: "Translation" },
  { key: "transcription", goField: "Transcription" },
  { key: "title", goField: "Title" },
  { key: "processText", goField: "ProcessText" },
  { key: "processDialog", goField: "ProcessDialog" },
  { key: "generateVocabulary", goField: "GenerateVocabulary" },
  { key: "generateModels", goField: "GenerateModels" },
];

const lf = (text) => text.replace(/\r\n/g, "\n");
// Helm block scalars are compared line-ending- and whitespace-insensitively
// (YAML yields LF); the eval's own prompt files must match byte for byte,
// since promptfoo sends them to the model exactly as stored — a CRLF file
// would send \r\n where phraseforge sends \n.
const sameText = (a, b) => lf(a).trim() === lf(b).trim();

function goString(file, declaration, name) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(new RegExp(`${declaration}\\s+${name}\\s*=\\s*(?:json\\.RawMessage\\()?\`([^\`]*)\``));
  if (!match) throw new Error(`${name} not found in ${file}`);
  return match[1];
}

// goPurpose reads a purpose's default prompt and numCtx from defaultFileConfig
// in config.go (an interpreted Go string with simple escapes is valid JSON).
function goPurpose(file, field) {
  const source = fs.readFileSync(file, "utf8");
  const block = source.match(new RegExp(`f\\.${field} = purposeFileConfig\\{([\\s\\S]*?)\\n\\t\\}`));
  if (!block) throw new Error(`purpose ${field} not found in ${file}`);
  const literal = block[1].match(/Prompt: ("(?:[^"\\]|\\.)*")/);
  // or a named constant (const DefaultXPrompt = `...`), as the longer prompts are
  const constant = block[1].match(/Prompt: (Default\w+),/);
  if (!literal && !constant) throw new Error(`purpose ${field} has no Prompt string or Default constant in ${file}`);
  const numCtx = block[1].match(/NumCtx: (\d+)/);
  const prompt = literal ? JSON.parse(literal[1]) : goString(file, "const", constant[1]);
  return { prompt, numCtx: numCtx ? Number(numCtx[1]) : 0 };
}

function schemaOf(configFile) {
  const config = yaml.parse(fs.readFileSync(path.join(root, configFile), "utf8"));
  return config.providers[0].config.format;
}

const check = process.argv.includes("--check");
const problems = [];
const notes = [];
const collapse = (text) => text.split(/\s+/).filter(Boolean).join(" ");
const configGo = path.join(phraseforgeDir, "internal", "config", "config.go");
const responseGo = path.join(phraseforgeDir, "internal", "ai", "itemresponse.go");
const helm = fs.existsSync(helmValues) ? yaml.parse(fs.readFileSync(helmValues, "utf8")).phraseforge : null;
if (check && !helm) console.warn(`warning: ${helmValues} not found — deployed Helm prompts not compared`);

for (const suite of SUITES) {
  const goText = goString(configGo, "const", suite.goPrompt);
  const file = path.join(root, suite.dir, "prompts", "system.txt");

  if (!check) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== goText) {
      fs.writeFileSync(file, goText);
      console.log(`wrote ${path.relative(root, file)}`);
    } else {
      console.log(`unchanged ${path.relative(root, file)}`);
    }
    continue;
  }

  if (!fs.existsSync(file)) problems.push(`${suite.dir}/prompts/system.txt is missing`);
  else if (fs.readFileSync(file, "utf8") !== goText) problems.push(`${suite.dir}/prompts/system.txt differs from ${suite.goPrompt} in config.go (byte for byte, line endings included; run npm run sync-prompts)`);

  if (helm && !sameText(helm[suite.helmKey].prompt, goText)) problems.push(`Helm values phraseforge.${suite.helmKey}.prompt differs from ${suite.goPrompt} in config.go`);

  checkSchema(`${suite.dir}/promptfooconfig.yaml`, suite.goSchema);
}

// Generate purposes: the prompt prod runs (Helm) and the context window.
for (const purpose of GENERATE_PURPOSES) {
  const goDefault = goPurpose(configGo, purpose.goField);
  const deployed = helm && helm[purpose.key] && typeof helm[purpose.key].prompt === "string" ? helm[purpose.key].prompt : null;
  const wanted = deployed ?? goDefault.prompt;
  const file = path.join(root, "generate", "prompts", `${purpose.key}.txt`);

  if (!check) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== wanted) {
      fs.writeFileSync(file, wanted);
      console.log(`wrote ${path.relative(root, file)}${deployed ? " (Helm)" : " (Go default)"}`);
    } else {
      console.log(`unchanged ${path.relative(root, file)}`);
    }
    continue;
  }

  if (!fs.existsSync(file)) problems.push(`generate/prompts/${purpose.key}.txt is missing (run npm run sync-prompts)`);
  else if (fs.readFileSync(file, "utf8") !== wanted) {
    problems.push(`generate/prompts/${purpose.key}.txt differs from the ${deployed ? "Helm values" : "Go default"} (byte for byte; run npm run sync-prompts)`);
  }
  if (deployed !== null && !sameText(deployed, goDefault.prompt)) {
    notes.push(`${purpose.key}: the Helm prompt differs from the Go default${sameText(collapse(deployed), collapse(goDefault.prompt)) ? " (line breaks only)" : " (wording)"}; the eval uses the Helm one`);
  }

  const configFile = path.join(root, "generate", `${purpose.key}.yaml`);
  if (fs.existsSync(configFile)) {
    const configured = yaml.parse(fs.readFileSync(configFile, "utf8")).providers[0].config.num_ctx ?? 0;
    const expected = (helm && helm[purpose.key] && helm[purpose.key].numCtx) ?? goDefault.numCtx;
    if (configured !== expected) problems.push(`generate/${purpose.key}.yaml num_ctx is ${configured}, the ${helm && helm[purpose.key] && helm[purpose.key].numCtx !== undefined ? "Helm values say" : "Go default is"} ${expected}`);
  }
}

// Suites that embed a reply schema without owning a prompt file.
for (const extra of SCHEMA_ONLY) checkSchema(extra.config, extra.goSchema);

function checkSchema(configFile, goSchemaName) {
  const goSchema = JSON.parse(goString(responseGo, "var", goSchemaName));
  if (JSON.stringify(sortKeys(schemaOf(configFile))) !== JSON.stringify(sortKeys(goSchema))) {
    problems.push(`${configFile} reply schema differs from ${goSchemaName} in itemresponse.go`);
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
}

if (check) {
  // The follow-up turn the correction suites send must be the one phraseforge sends.
  const retryGo = path.join(phraseforgeDir, "internal", "ai", "retry.go");
  const templateMatch = fs.readFileSync(retryGo, "utf8").match(/const correctionTemplate = ("(?:[^"\\]|\\.)*")/);
  if (!templateMatch) throw new Error(`correctionTemplate not found in ${retryGo}`);
  const goTemplate = JSON.parse(templateMatch[1]); // a Go interpreted string with only \n escapes is valid JSON
  if (require("../lib/correction").CORRECTION_TEMPLATE !== goTemplate) {
    problems.push("lib/correction.js CORRECTION_TEMPLATE differs from correctionTemplate in retry.go");
  }
  for (const note of notes) console.log("note: " + note);
  if (problems.length) {
    console.error("prompt drift found:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("prompts and schemas match phraseforge" + (helm ? " and the Helm values" : ""));
}
