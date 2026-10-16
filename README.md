# prompt-eval

Evaluates prompts with [promptfoo](https://www.promptfoo.dev/) and hands the approved prompts to the applications that send them. Run all tests with `npm test`; they never call a model.

## Applications

phraseforge has its own sync script (`npm run sync-prompts`, `npm run check-sync`). Every other application is described by a file in `apps/` and handled by one generic command, so prompt-eval itself knows nothing about any application.

```sh
node scripts/sync-app.js <app>          # copy the prompts, and any extra files, into the application
node scripts/sync-app.js <app> --check  # compare only; exit 1 and list every difference
```

Everything flows from prompt-eval to the application. Only files the entry manages are written, compared or removed: the template, each axis's snippet files and the extra files. Anything else in either tree is left alone. Files are compared byte for byte.

### `apps/<name>.yaml`

```yaml
name: assistant                    # equals the file name
promptDir: prompt/assistant        # the prompt tree here, relative to prompt-eval
target:
  root: ../k8s-lab/assistant       # the application's directory, relative to prompt-eval
  env: ASSISTANT_DIR               # setting this variable overrides root
  prompts: internal/workflow/prompts   # where the tree lands, relative to root
template: step.system.txt          # the system prompt template inside promptDir
axes:                              # snippet axes: promptDir/<dir>/<name>/<file> fills {{placeholder}}
  - { dir: lang, file: rules.txt, placeholder: languageRules, selector: language }
  - { dir: output, file: rules.txt, placeholder: outputRules, selector: output }
files:                             # optional extra files: from (relative to prompt-eval) to (relative to root)
  - { from: vectors/template-render.json, to: internal/workflow/testdata/prompt-eval/render-vectors.json }
```

No path may leave its root. The variable named by `selector` chooses the snippet (`language: arb` picks `lang/arb/rules.txt`). A template may use the axes' placeholders and the selector variables; a snippet may use only the selector variables.

### Rendering

`lib/template-render.js` renders a prompt the way an application does, so a suite can send exactly what the application will. Each chosen snippet is trimmed, a missing snippet renders empty, three or more newlines collapse to a blank line, and an unknown placeholder is an error. The application has its own implementation; `vectors/template-render.json` holds hand-written cases that both are tested against, so they cannot drift apart.

### Evaluation suites

`lib/prompt-cases.js` builds promptfoo tests from a cases file (format in its header), `lib/assert-reply.js` scores a reply (JSON, then a JSON Schema, then expectations on paths) and `lib/promptfoo-chat-prompt.js` sends one system and one user message. A case carries an `example` reply that must pass, so a case no reply can satisfy is caught without a model.

`assistant-step/` is the suite for the assistant:

```sh
npm run assistant-step:validate   # check the promptfoo config, no model
npm run assistant-step:smoke      # one case against a local model (SMOKE=1)
npm run assistant-step            # all cases; CASES=id,id selects some
npm run check-sync-assistant      # prompts, vectors, cases and schemas match the assistant
npm run sync-assistant            # copy them into the assistant
```

### Adding an application

1. Put its prompts under `prompt/<name>/` (a template, plus snippet directories if it has axes).
2. Add `apps/<name>.yaml` as above.
3. Run `node scripts/sync-app.js <name> --check` to see what a sync would do, then without `--check`.
4. For an evaluation suite, add a directory with `promptfooconfig.yaml`, a cases file and schemas, and a `generate-tests.js` that calls `buildTests`.
