const test = require("node:test");
const assert = require("node:assert/strict");
const { checkGenerate } = require("../lib/generate-checks");

const translationVars = { content: "Ich möchte einen Kaffee bestellen.\nDie Lektion beginnt um acht Uhr.", contains: [["kaw"], ["lekcj"]] };

test("translation: a good reply passes", () => {
  const r = checkGenerate("translation", "Chciałbym zamówić kawę.\nLekcja zaczyna się o ósmej.", translationVars);
  assert.equal(r.pass, true, r.reason);
});

test("translation: chatter, fences, wrong line count, untranslated and missing words fail", () => {
  assert.match(checkGenerate("translation", "Here is the translation:\nkawę\nlekcja", translationVars).reason, /noPreamble/);
  assert.match(checkGenerate("translation", "```\nkawę\nlekcja\n```", translationVars).reason, /noFence/);
  assert.match(checkGenerate("translation", "Chciałbym zamówić kawę. Lekcja zaczyna się o ósmej.", translationVars).reason, /lineCount/);
  assert.match(checkGenerate("translation", translationVars.content, translationVars).reason, /notUntranslated/);
  assert.match(checkGenerate("translation", "Chcę herbatę.\nSzkoła zaczyna się o ósmej.", translationVars).reason, /expectedWords/);
  assert.equal(checkGenerate("translation", "", translationVars).pass, false);
});

test("translation: accents and case are ignored when matching expected words", () => {
  const r = checkGenerate("translation", "KAWĘ proszę\nLEKCJA", { ...translationVars, content: "a\nb" });
  assert.equal(r.pass, true, r.reason);
});

const transcriptionVars = { content: "你好，我叫小明。", reference: "Nǐ hǎo, wǒ jiào Xiǎomíng." };

test("transcription: pinyin close to the reference passes; tone marks and punctuation are ignored", () => {
  assert.equal(checkGenerate("transcription", "Nǐ hǎo, wǒ jiào Xiǎomíng.", transcriptionVars).pass, true);
  assert.equal(checkGenerate("transcription", "ni hao wo jiao xiaoming", transcriptionVars).pass, true);
});

test("transcription: leftover Chinese characters, the wrong text and extra lines fail", () => {
  assert.match(checkGenerate("transcription", "Nǐ hǎo 小明", transcriptionVars).reason, /romanized/);
  assert.match(checkGenerate("transcription", "Good morning everybody", transcriptionVars).reason, /similarToReference/);
  assert.match(checkGenerate("transcription", "Nǐ hǎo, wǒ jiào Xiǎomíng.\nExtra line", transcriptionVars).reason, /lineCount/);
});

const titleVars = { content: "El restaurante de la calle principal abrió ayer." };

test("title: a plain one-line title passes", () => {
  assert.equal(checkGenerate("title", "Apertura de un restaurante en la calle principal", titleVars).pass, true);
});

test("title: quotes, trailing punctuation, several lines, length and the whole text fail", () => {
  assert.match(checkGenerate("title", '"Apertura del restaurante"', titleVars).reason, /noWrappingQuotes/);
  assert.match(checkGenerate("title", "«Apertura del restaurante»", titleVars).reason, /noWrappingQuotes/);
  assert.match(checkGenerate("title", "Apertura del restaurante.", titleVars).reason, /noTrailingPunctuation/);
  assert.match(checkGenerate("title", "Apertura\ndel restaurante", titleVars).reason, /singleLine/);
  assert.match(checkGenerate("title", "x".repeat(101), titleVars).reason, /short/);
  assert.match(checkGenerate("title", titleVars.content, titleVars).reason, /notTheText/);
  assert.match(checkGenerate("title", "Title: Apertura del restaurante", titleVars).reason, /noPreamble/);
});

test("title: reusing a word of the text passes; a title in another language fails", () => {
  const german = { content: "Das Wetter in Berlin war gestern sehr schön. Viele Menschen gingen im Park spazieren." };
  assert.equal(checkGenerate("title", "Das Wetter in Berlin", german).pass, true);
  assert.match(checkGenerate("title", "O tempo em Berlim", german).reason, /sourceLanguage/);
  const chinese = { content: "昨天北京的天气很好。" };
  assert.equal(checkGenerate("title", "北京的好天气", chinese).pass, true);
  assert.match(checkGenerate("title", "Beijing weather", chinese).reason, /sourceLanguage/);
});

test("an unknown kind is an error, not a silent pass", () => {
  assert.throws(() => checkGenerate("nonsense", "x", {}), /no checks for generate kind/);
});

const cleanVars = { keep: ["neue Bibliothek eröffnet", "100.000 Bücher"], drop: ["Cookie", "Newsletter"], forbid: ["^#"] };

test("processText: clean content passes; lost content, leftover boilerplate and invented headings fail", () => {
  const good = "Berlin hat eine neue Bibliothek eröffnet. Sie bietet Platz für 100.000 Bücher.";
  assert.equal(checkGenerate("processText", good, cleanVars).pass, true);
  assert.match(checkGenerate("processText", "Berlin hat eine Bibliothek.", cleanVars).reason, /keepsContent/);
  assert.match(checkGenerate("processText", good + "\nNewsletter abonnieren", cleanVars).reason, /dropsBoilerplate/);
  assert.match(checkGenerate("processText", "# Bibliothek\n" + good, cleanVars).reason, /noForbiddenPattern/);
  assert.match(checkGenerate("processText", "Here is the cleaned text:\n" + good, cleanVars).reason, /noPreamble/);
});

test("processDialog: one line per turn, with the same keep/drop rules", () => {
  const vars = { keep: ["Guten Tag", "Einen Kaffee"], drop: ["Impressum"], turns: 2 };
  assert.equal(checkGenerate("processDialog", "Kellnerin: Guten Tag!\nGast: Einen Kaffee, bitte.", vars).pass, true);
  assert.match(checkGenerate("processDialog", "Kellnerin: Guten Tag! Gast: Einen Kaffee, bitte.", vars).reason, /turnPerLine/);
  assert.match(checkGenerate("processDialog", "Impressum\nKellnerin: Guten Tag!\nGast: Einen Kaffee, bitte.", vars).reason, /dropsBoilerplate|turnPerLine/);
});

const vocabVars = { content: "Ich möchte einen Kaffee bestellen. Der Koffer ist schwer.", minItems: 3 };

test("generateVocabulary: item lines pass; chatter, list markers, empty parts and invented phrases fail", () => {
  const good = "Kaffee {N m} = kawa\nKoffer {N m} = walizka\nbestellen {V} = zamawiać";
  assert.equal(checkGenerate("generateVocabulary", good, vocabVars).pass, true);
  assert.match(checkGenerate("generateVocabulary", "1. Kaffee = kawa\n2. Koffer = walizka\n3. bestellen = zamawiać", vocabVars).reason, /noListMarkers/);
  assert.match(checkGenerate("generateVocabulary", "Kaffee {} = kawa\nKoffer = walizka\nbestellen = zamawiać", vocabVars).reason, /lineFormat/);
  assert.match(checkGenerate("generateVocabulary", "Kaffee = kawa", vocabVars).reason, /enoughItems/);
  assert.match(checkGenerate("generateVocabulary", "Hund = pies\nKatze = kot\nHaus = dom", vocabVars).reason, /phrasesFromText/);
  assert.match(checkGenerate("generateVocabulary", "Here are the items:\n" + good, vocabVars).reason, /noPreamble/);
  assert.equal(checkGenerate("generateVocabulary", "名字 {N} [míngzi] = imię\n学生 [xuéshēng] = uczeń\n好 = dobry", { content: "名字 学生 好", minItems: 3 }).pass, true);
});

const modelVars = { content: "Ich möchte einen Kaffee bestellen. Die Lektion beginnt um acht Uhr.", minItems: 3 };

test("generateModels: progressively longer item lines pass; braces, shrinking phrases and unrelated phrases fail", () => {
  const good = "Ich möchte = chcę\nIch möchte einen Kaffee = chcę kawę\nIch möchte einen Kaffee bestellen = chcę zamówić kawę";
  assert.equal(checkGenerate("generateModels", good, modelVars).pass, true);
  assert.match(checkGenerate("generateModels", "Ich möchte einen Kaffee bestellen = a\nIch möchte einen Kaffee = b\nIch möchte = c", modelVars).reason, /progressivelyLonger/);
  assert.match(checkGenerate("generateModels", "Ich möchte {V} = chcę\nIch möchte einen Kaffee = x\nIch möchte einen Kaffee bestellen = y", modelVars).reason, /noGrammarBraces/);
  assert.match(checkGenerate("generateModels", "Der Hund = pies\nDer Hund bellt = pies szczeka\nDer Hund bellt laut = pies szczeka głośno", modelVars).reason, /usesTextVocabulary/);
});

test("list expectations arrive as JSON strings (promptfoo fans arrays out) and are parsed", () => {
  const vars = { keep: JSON.stringify(["neue Bibliothek", "100.000 Bücher"]), drop: JSON.stringify(["Cookie"]), forbid: JSON.stringify(["^#"]) };
  assert.equal(checkGenerate("processText", "Eine neue Bibliothek mit 100.000 Bücher.", vars).pass, true);
  assert.match(checkGenerate("processText", "Eine neue Bibliothek.", vars).reason, /keepsContent/);
  const translation = { content: "a", contains: JSON.stringify([["kaw"], ["lekcj"]]) };
  assert.match(checkGenerate("translation", "kawa", translation).reason, /expectedWords/);
});

test("generateTests never hands promptfoo an array var other than the messages", () => {
  const { generateTests } = require("../lib/tests");
  const kinds = ["translation", "transcription", "title", "processText", "processDialog", "generateVocabulary", "generateModels"];
  for (const kind of kinds) {
    const tests = generateTests(kind);
    assert.ok(tests.length > 0, kind);
    for (const t of tests) {
      for (const [name, value] of Object.entries(t.vars)) {
        if (name !== "messages") assert.equal(Array.isArray(value), false, `${t.description}: var "${name}" is an array`);
      }
      assert.equal(t.vars.messages.length, 2, "system + user");
    }
  }
});

test("generateModels: Chinese phrases are matched to the text by character", () => {
  const vars = { content: "我想点一杯咖啡。学生在学校学习。", minItems: 3 };
  const reply = "我 [wǒ] = I\n我想 [wǒ xiǎng] = I want\n我想点一杯咖啡 [wǒ xiǎng diǎn yī bēi kāfēi] = I want to order a cup of coffee";
  assert.equal(checkGenerate("generateModels", reply, vars).pass, true);
  const unrelated = "天 [tiān] = sky\n天空 [tiānkōng] = the sky\n天空很蓝 [tiānkōng hěn lán] = the sky is blue";
  assert.match(checkGenerate("generateModels", unrelated, vars).reason, /usesTextVocabulary/);
});
