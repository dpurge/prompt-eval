#!/bin/sh
# A quick run of the suites the prompt work touches, on a few languages, with
# per-check pass rates at the end:
#   scripts/quick.sh <tag>            results go to out/<tag>-<suite>.json
#   LANGS=arb,deu scripts/quick.sh x  other languages (default arb,heb,jpn,deu)
#   SUITES="processText" scripts/quick.sh x   only some suites
cd "$(dirname "$0")/.." || exit 1
tag=${1:-quick}
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1
langs=${LANGS:-arb,heb,jpn,deu}
suites=${SUITES:-"vocabulary-translation models-item transcription generateVocabulary generateModels processText processDialog"}
mkdir -p out
for suite in $suites; do
  case $suite in
    vocabulary-translation|models-item) config=$suite/promptfooconfig.yaml; env_langs=$langs; smoke=1 ;;
    processText|processDialog) config=generate/$suite.yaml; env_langs=; smoke=1 ;;
    *) config=generate/$suite.yaml; env_langs=$langs; smoke= ;;
  esac
  file=out/$tag-$suite.json
  LANGS=$env_langs SMOKE=$smoke npx promptfoo eval -c "$config" -o "$file" --no-cache --no-progress-bar > "out/$tag-$suite.log" 2>&1
  printf '%s: ' "$suite"; grep -E "Duration" "out/$tag-$suite.log" | tr '\n' ' '; echo
done
node scripts/summarize.js $(for s in $suites; do echo out/$tag-$s.json; done)
