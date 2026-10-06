// Keeps phraseforge's embedded copy of the default prompts, its reply schemas
// and its context windows identical to what the eval tests. prompt/default is
// the source of truth for the default system prompts and snippets.
//
//   node scripts/sync-prompts.js          copy prompt/default into phraseforge's
//                                         internal/config/prompts/default
//   node scripts/sync-prompts.js --check  compare instead of writing: the
//                                         embedded copy, each suite's reply
//                                         schema and each purpose's num_ctx;
//                                         exits 1 on any difference
//
// A Helm prompt overrides the default in production. --check prints a note
// where the deployed Helm prompt differs from the default the eval tests;
// updating the Helm values is a separate change in the jdp-helm repo, so a
// difference is not drift.
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

const promptDefaultDir = path.join(root, "prompt", "default");
const embeddedDir = path.join(phraseforgeDir, "internal", "config", "prompts", "default");
const promptFile = (name) => path.join(promptDefaultDir, "system", `${name}.txt`);

// One entry per item suite: its prompt, the Go reply schema it must match and
// the Helm values key holding the deployed prompt.
const SUITES = [
  { dir: "vocabulary-translation", promptName: "generate-vocabulary-item", goSchema: "VocabularyItemSchema", helmKey: "vocabularyItem" },
  { dir: "models-item", promptName: "generate-models-item", goSchema: "ModelsItemSchema", helmKey: "modelsItem" },
];

const SCHEMA_ONLY = [
  { config: "correction/vocabulary.yaml", goSchema: "VocabularyItemSchema" },
  { config: "correction/models.yaml", goSchema: "ModelsItemSchema" },
];

// Purposes called through ai.Service.Generate: the system prompt is
// prompt/default/system/<promptName>.txt, num_ctx comes from the purpose's numCtx.
const GENERATE_PURPOSES = [
  { key: "translation", promptName: "generate-translation", goField: "Translation" },
  { key: "transcription", promptName: "generate-transcription", goField: "Transcription" },
  { key: "title", promptName: "generate-title", goField: "Title" },
  { key: "processText", promptName: "process-text", goField: "ProcessText" },
  { key: "processDialog", promptName: "process-dialog", goField: "ProcessDialog" },
  { key: "generateVocabulary", promptName: "generate-vocabulary", goField: "GenerateVocabulary" },
  { key: "generateModels", promptName: "generate-models", goField: "GenerateModels" },
];

const lf = (text) => text.replace(/\r\n/g, "\n");
// Helm block scalars are compared line-ending- and whitespace-insensitively
// (YAML yields LF); the prompt files themselves, and the embedded copy, must
// match byte for byte, since promptfoo and phraseforge send them to the model
// exactly as stored.
const sameText = (a, b) => lf(a).trim() === lf(b).trim();

function goString(file, declaration, name) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(new RegExp(`${declaration}\\s+${name}\\s*=\\s*(?:json\\.RawMessage\\()?\`([^\`]*)\``));
  if (!match) throw new Error(`${name} not found in ${file}`);
  return match[1];
}

// goNumCtx reads a purpose's default numCtx from defaultFileConfig in
// config.go (0 when the purpose leaves it unset).
function goNumCtx(file, field) {
  const source = fs.readFileSync(file, "utf8");
  const block = source.match(new RegExp(`f\\.${field} = purposeFileConfig\\{([\\s\\S]*?)\\n\\t\\}`));
  if (!block) throw new Error(`purpose ${field} not found in ${file}`);
  const numCtx = block[1].match(/NumCtx: (\d+)/);
  return numCtx ? Number(numCtx[1]) : 0;
}

function schemaOf(configFile) {
  const config = yaml.parse(fs.readFileSync(path.join(root, configFile), "utf8"));
  return config.providers[0].config.format;
}

// filesUnder lists every file below dir as sorted paths relative to it.
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory()
      ? filesUnder(path.join(dir, entry.name)).map((f) => path.join(entry.name, f))
      : [entry.name]))
    .sort();
}

const check = process.argv.includes("--check");
const problems = [];
const notes = [];
const configGo = path.join(phraseforgeDir, "internal", "config", "config.go");
const responseGo = path.join(phraseforgeDir, "internal", "ai", "itemresponse.go");
const helm = fs.existsSync(helmValues) ? yaml.parse(fs.readFileSync(helmValues, "utf8")).phraseforge : null;
if (check && !helm) console.warn(`warning: ${helmValues} not found — deployed Helm prompts not compared`);

// The embedded copy in phraseforge.
const sourceFiles = filesUnder(promptDefaultDir);
if (!check) {
  fs.rmSync(embeddedDir, { recursive: true, force: true });
  for (const file of sourceFiles) {
    fs.mkdirSync(path.dirname(path.join(embeddedDir, file)), { recursive: true });
    fs.copyFileSync(path.join(promptDefaultDir, file), path.join(embeddedDir, file));
  }
  console.log(`copied ${sourceFiles.length} files from ${path.relative(root, promptDefaultDir)} to ${embeddedDir}`);
} else {
  const embeddedFiles = filesUnder(embeddedDir);
  for (const file of sourceFiles) {
    const copy = path.join(embeddedDir, file);
    if (!fs.existsSync(copy)) problems.push(`${embeddedDir}/${file} is missing (run npm run sync-prompts)`);
    else if (!fs.readFileSync(copy).equals(fs.readFileSync(path.join(promptDefaultDir, file)))) {
      problems.push(`${embeddedDir}/${file} differs from prompt/default/${file} (byte for byte; run npm run sync-prompts)`);
    }
  }
  for (const file of embeddedFiles.filter((f) => !sourceFiles.includes(f))) {
    problems.push(`${embeddedDir}/${file} has no counterpart in prompt/default (run npm run sync-prompts)`);
  }
}

// checkPrompt: the default exists, and says so when the deployed Helm prompt differs.
function checkPrompt(promptName, helmEntry, label) {
  const file = promptFile(promptName);
  if (!fs.existsSync(file)) {
    problems.push(`prompt/default/system/${promptName}.txt is missing`);
    return;
  }
  const deployed = helmEntry && typeof helmEntry.prompt === "string" ? helmEntry.prompt : null;
  if (deployed !== null && !sameText(deployed, fs.readFileSync(file, "utf8"))) {
    notes.push(`${label}: the deployed Helm prompt differs from prompt/default/system/${promptName}.txt; production uses the Helm one`);
  }
}

if (check) {
  for (const suite of SUITES) {
    checkPrompt(suite.promptName, helm && helm[suite.helmKey], suite.helmKey);
    checkSchema(`${suite.dir}/promptfooconfig.yaml`, suite.goSchema);
  }

  for (const purpose of GENERATE_PURPOSES) {
    checkPrompt(purpose.promptName, helm && helm[purpose.key], purpose.key);

    const configFile = path.join(root, "generate", `${purpose.key}.yaml`);
    if (fs.existsSync(configFile)) {
      const configured = yaml.parse(fs.readFileSync(configFile, "utf8")).providers[0].config.num_ctx ?? 0;
      const helmNumCtx = helm && helm[purpose.key] && helm[purpose.key].numCtx;
      const expected = helmNumCtx ?? goNumCtx(configGo, purpose.goField);
      if (configured !== expected) problems.push(`generate/${purpose.key}.yaml num_ctx is ${configured}, the ${helmNumCtx !== undefined ? "Helm values say" : "Go default is"} ${expected}`);
    }
  }

  // Suites that embed a reply schema without owning a prompt file.
  for (const extra of SCHEMA_ONLY) checkSchema(extra.config, extra.goSchema);

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
  console.log("embedded prompts, schemas and context windows match phraseforge");
}

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
