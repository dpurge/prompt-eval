const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const DATA_MAP = {
  "cmn-pol": {
    sourceLanguage: "Mandarin Chinese",
    targetLanguage: "Polish",
    grammarPrompt: "cmn-grammar.txt",
    transcriptionPrompt: "cmn-transcription.txt",
  },
  "deu-pol": {
    sourceLanguage: "German",
    targetLanguage: "Polish",
    grammarPrompt: "deu-grammar.txt",
    transcriptionPrompt: null,
  },
  "spa-pol": {
    sourceLanguage: "Spanish",
    targetLanguage: "Polish",
    grammarPrompt: "spa-grammar.txt",
    transcriptionPrompt: null,
  },
};

// readSection returns a prompt section file's text, or "" when the language
// has none — phraseforge renders a missing section as "" too.
function readSection(promptDir, file) {
  if (!file) return "";
  return fs.readFileSync(path.join(promptDir, file), 'utf8').replace(/\r\n/g, '\n');
}

module.exports = async function () {
  const dataDir = path.join(__dirname, 'data');
  const promptDir = path.join(__dirname, 'prompts');

  const files = fs
    .readdirSync(dataDir)
    .filter(f => f.endsWith('.yaml'));

  return files.flatMap(file => {
    const name = path.basename(file, '.yaml');
    const cfg = DATA_MAP[name];

    const sourceLanguage = cfg['sourceLanguage'];
    const targetLanguage = cfg['targetLanguage'];
    // Sections are rendered exactly as phraseforge stores them (Admin > LLM >
    // Language sections keeps LF line endings), so normalize CRLF here.
    const grammarPrompt = readSection(promptDir, cfg['grammarPrompt']);
    const transcriptionPrompt = readSection(promptDir, cfg['transcriptionPrompt']);

    const rows = yaml.parse(
      fs.readFileSync(path.join(dataDir, file), 'utf8')
    );

    return rows.map(row => ({
      description: `${name}/${row.id}`,
      vars: {
        ...Object.fromEntries(
          Object.entries(row).filter(([, value]) => value !== null)
        ),
        sourceLanguage,
        targetLanguage,
        grammarPrompt,
        transcriptionPrompt,
      },
    }));

    // const tests = rows.map(row => ({
    //   description: `${name}/${row.id}`,
    //   vars: {
    //     ...Object.fromEntries(
    //       Object.entries(row).filter(([, value]) => value !== null)
    //     ),
    //     sourceLanguage,
    //     targetLanguage,
    //   },
    // }));

    // console.log(
    //   'Generated tests:',
    //   JSON.stringify(tests, null, 2)
    // );

    // return tests;
  });
};
