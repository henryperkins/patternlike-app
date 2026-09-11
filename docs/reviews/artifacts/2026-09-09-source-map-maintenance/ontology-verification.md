# Task 1 report — source corrections

Date: 2026-09-09. Worktree: `/home/henry/patternlike-app-source-map`; base `d338b86c9444ebe2f372f2a2f3990f4a1270bc80`. No commits or remote actions performed.

Changed exactly the four existing files authorized by Task 1 and created `docs/architecture/source-map/source-corrections.md`. Pre-edit hashes, correction meanings, evidence links, verification limits, and offline hashes are in that record. The two TypeScript changes are comments only. Historical evidence-ledger rows and the raw August 27 observation are byte-identical. Existing documentation changes were preserved. Full gate and map capture/check belong to root's integration; this report claims only the checks below.

## Before hashes

```text
dc4e975cc3aaa6295dc8ed5b3cf4f55ecf30d31e06632f2202a6e401f969d959  apps/api/scripts/build-internal-ontology.ts
44b43c96cbc18a219208426aa37eb623eca39f86c4131c353cb9bab5f473f637  apps/api/src/services/ontology-signing-client.ts
fe0dd5a5952197d4751fafbac02e5d1f3ac33e24f67b06145713d6e547ff46fa  docs/deploy/openai-pattern-rollout.md
b2431d360cd28750e95c56c9735d374ab92eabd396d30764da1c4cc8717d9925  CLAUDE.md
```

## Offline build

Exact shell setup and build commands (all from the named worktree):

```bash
source /home/henry/.nvm/nvm.sh
nvm use 22
TASK_ONTOLOGY_TMP=$(mktemp -d /tmp/patternlike-ontology-source-corrections.XXXXXX)
printf '%s\n' "$TASK_ONTOLOGY_TMP" > /tmp/patternlike-source-corrections-temp-path
node_modules/.bin/tsx apps/api/scripts/prepare-ontology-corpus.ts --input pattern-corpus/fragments.json --release-id pattern-ontology-source-manual-en-us-0.1.0 --output "$TASK_ONTOLOGY_TMP/corpus.json"
ONTOLOGY_VERSION=pattern-ontology-en-us-internal-0.1.0 node_modules/.bin/tsx apps/api/scripts/build-internal-ontology.ts "$TASK_ONTOLOGY_TMP/corpus.json" "$TASK_ONTOLOGY_TMP/bundle.json"
TASK_ONTOLOGY_TMP="$TASK_ONTOLOGY_TMP" node_modules/.bin/tsx --eval 'import {readFileSync} from "node:fs"; import {computeOntologyBundleHash} from "./apps/api/src/services/pattern-ontology-verify.ts"; const root=process.env.TASK_ONTOLOGY_TMP; const corpus=JSON.parse(readFileSync(root+"/corpus.json","utf8")); const bundle=JSON.parse(readFileSync(root+"/bundle.json","utf8")); computeOntologyBundleHash(bundle).then(hash=>{ const counts={fragments:corpus.fragments.length,records:bundle.records.length,skipped:corpus.fragments.length-bundle.records.length}; if(hash!=="sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84" || corpus.corpus_hash!=="sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c" || counts.fragments!==60 || counts.records!==40 || counts.skipped!==20) process.exit(1); console.log(JSON.stringify({status:"verified",node:process.version,...counts,corpus_hash:corpus.corpus_hash,bundle_hash:hash})); });'
```

Observed output; all three ontology commands succeeded:

```text
Now using node v22.23.2 (npm v10.9.8)
PASS corpus_release_id=pattern-ontology-source-manual-en-us-0.1.0 corpus_hash=sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c fragments=60
ok: 40 records, 20 fragments skipped (no predicate), locale en-US
{"status":"verified","node":"v22.23.2","fragments":60,"records":40,"skipped":20,"corpus_hash":"sha256:5d5e46af054c722e9ced6c596bc912983fad8eaf6a62b85b8b52103e40088f5c","bundle_hash":"sha256:7e947bc43ef38dec705aae668c95f37a56396b88de1c940e03216754c2490d84"}
```

No builder placeholder hash was used as canonical identity. No provider calls, signing, ingestion, activation, or production access occurred.

## Scanner / historical preservation

Initial naive `ts.createScanner` iteration falsely included comments in template literal tokens because a scanner needs parser context for template continuations and regex rescans; that verification attempt failed, not the application. A parser-guided scanner harness then required excluding JSDoc AST nodes and allowing contextual keywords to retain scanner kinds. No source change was made to make the check pass. The final harness uses the parser only for token boundaries, scans every executable token, rescans regex and template continuations, and compares scanner kind/text sequences. Failures are bounded messages rather than source dumps. The first naive assertion emitted a source diff; subsequent harness diagnostics were bounded.

Exact final harness saved at `/tmp/patternlike-source-corrections-verify.mjs`:

```js
import ts from '/home/henry/patternlike-app-source-map/node_modules/typescript/lib/typescript.js';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const files=['apps/api/scripts/build-internal-ontology.ts','apps/api/src/services/ontology-signing-client.ts'];
const manifest=JSON.parse(readFileSync('apps/api/pattern-creation-sources.json','utf8'));
function tokens(text){
 const source=ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if(source.parseDiagnostics.length) throw new Error('parse_failed');
 const result=[];
 function walk(node){
  if(node.kind>=ts.SyntaxKind.FirstJSDocNode && node.kind<=ts.SyntaxKind.LastJSDocNode) return;
  const children=node.getChildren(source);
  if(children.length){children.forEach(walk);return;}
  if(node.kind===ts.SyntaxKind.EndOfFileToken || node.kind===ts.SyntaxKind.SyntaxList) return;
  const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,text,undefined,node.getStart(source),node.getWidth(source));
  let kind=scanner.scan();
  if(node.kind===ts.SyntaxKind.RegularExpressionLiteral) kind=scanner.reScanSlashToken();
  if(node.kind===ts.SyntaxKind.TemplateMiddle || node.kind===ts.SyntaxKind.TemplateTail) kind=scanner.reScanTemplateToken(false);
  if(scanner.getTokenText()!==node.getText(source)) throw new Error('scanner_context_mismatch_'+ts.SyntaxKind[node.kind]+'_'+ts.SyntaxKind[kind]);
  result.push([kind,scanner.getTokenText()]);
 }
 walk(source);return result;
}
for(const path of files){const before=tokens(execFileSync('git',['show','HEAD:'+path],{encoding:'utf8'}));const after=tokens(readFileSync(path,'utf8'));if(JSON.stringify(before)!==JSON.stringify(after)||manifest.sources.includes(path))throw new Error('token_or_manifest_mismatch');console.log(JSON.stringify({path,non_trivia_tokens:after.length,tokens_unchanged:true,outside_pattern_manifest:true}));}
const path='docs/deploy/openai-pattern-rollout.md';const before=execFileSync('git',['show','HEAD:'+path],{encoding:'utf8'});const after=readFileSync(path,'utf8');
if(after.slice(after.indexOf('## Evidence ledger'))!==before.slice(before.indexOf('## Evidence ledger')))throw new Error('ledger_changed');
const observation=s=>s.slice(s.indexOf('## Production observation — 2026-08-27'),s.indexOf('### What this means for the account-wide deploy'));
if(observation(after)!==observation(before)) throw new Error('observation_changed');
console.log('PASS historical evidence ledger and August 27 raw observation unchanged');

```

Command: `node /tmp/patternlike-source-corrections-verify.mjs` under Node 22.23.2. Exit 0:

```text
{"path":"apps/api/scripts/build-internal-ontology.ts","non_trivia_tokens":1135,"tokens_unchanged":true,"outside_pattern_manifest":true}
{"path":"apps/api/src/services/ontology-signing-client.ts","non_trivia_tokens":961,"tokens_unchanged":true,"outside_pattern_manifest":true}
PASS historical evidence ledger and August 27 raw observation unchanged
```

`npm run check:pattern-source -w @patternlike/api` exited 0:

```text
> @patternlike/api@0.2.0 check:pattern-source
> tsx scripts/generate-pattern-source-fingerprint.ts --check

PASS pattern_source_fingerprint_current
```

## Diff and links

`git diff --check -- apps/api/scripts/build-internal-ontology.ts apps/api/src/services/ontology-signing-client.ts docs/deploy/openai-pattern-rollout.md CLAUDE.md` exited 0 with no output. Reviewed the scoped diff retained in `/tmp/patternlike-source-corrections.diff`. Markdown link-target existence check for runbook/correction record emitted `PASS relative Markdown link targets in runbook and correction record` (exit 0):

```python
from pathlib import Path
import re
for path in ['docs/deploy/openai-pattern-rollout.md','docs/architecture/source-map/source-corrections.md']:
 p=Path(path)
 for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if not target.startswith(('https:','http:','#')) and not (p.parent/target.split('#')[0]).exists():raise SystemExit('missing_link_target')
print('PASS relative Markdown link targets in runbook and correction record')
```

## Integration concerns

ST-08–ST-12 are Task 3-owned map dispositions. Reviewed the authored 42-topic/97-leaf draft and identified a signature-versus-signed-release wording detail for root; Task 3 also identified optional canary POST geocoding effects beyond readbacks. Awaiting final confirmation before closing correction-record dispositions. Root owns published-snapshot validation and full `ci:local`; no full-suite result is claimed here. The old runbook narrative is explicitly historical/superseded and requires current-source reconciliation before any operational use.

## Requested Slice 2 preparation review

Read-only review of `docs/superpowers/plans/2026-09-09-release-preflight-implementation.md` against `docs/superpowers/specs/2026-09-08-release-preflight-design.md` and current `scripts/pattern-release/release-evidence.mjs` found no actual interface contradiction. The exported helpers, 131,072-character capture tail, source exclusions, and fourteen-lane contract match the preparation text. The plan correctly leaves exact-summary sidecars, release:gate, candidate-tree mapping, PR observations, and release:preflight prospective. No Slice 2 implementation or passing preflight is claimed.

## Final maintained-map disposition

Task 3 confirmed all ST-08–ST-12 topics and both wording refinements. Re-read `map.json` and checked every referenced topic ID exists. Internal signing now says it returns a signature; the canary explicitly includes optional authenticated POST place search that can exercise geocoding. All ST-01–ST-12 authored dispositions are closed in the correction record; fresh snapshot structural/identity verification remains root integration work.

Additional offline omission check (`node --input-type=module` with the saved temporary corpus/bundle):

```js
import {readFileSync} from 'node:fs';
const root=process.env.TASK_ONTOLOGY_TMP;
const corpus=JSON.parse(readFileSync(root+'/corpus.json','utf8'));
const bundle=JSON.parse(readFileSync(root+'/bundle.json','utf8'));
const used=new Set(bundle.records.flatMap(r=>r.source_fragment_ids));
const omitted=corpus.fragments.filter(f=>!used.has(f.id));
const sections={};for(const f of omitted){const section=f.location.replace(/^§/,'').split('.')[0];sections[section]=(sections[section]??0)+1;}
if(JSON.stringify(sections)!==JSON.stringify({'2':12,'8':8})||!bundle.records.every(r=>r.meaning_class==='source_supported'&&r.source_fragment_ids.length===1))process.exit(1);
console.log(JSON.stringify({omitted_sections:sections,source_supported_records:bundle.records.length,one_fragment_per_record:true}));
```

Exit 0: `{"omitted_sections":{"2":12,"8":8},"source_supported_records":40,"one_fragment_per_record":true}`.

## Integration P2 fix — preserve the dated August 27 decision

Read `integration-review.md` and verified its P2 finding against the baseline: the original explicitly dated August 27 decision block had been removed, despite the raw ledger/observation checks passing. Restored the exact two-paragraph block from `HEAD:docs/deploy/openai-pattern-rollout.md` in a clearly superseded historical section. Added stable explicit anchors and a link to the September 9 current-source explanation. The corrected current opening and admission table remain intact. Updated source-corrections.md to record the preservation fix. No map, application, earlier eight documentation files, or historical record bytes were changed.

Verification command: `python3 /tmp/patternlike-source-corrections-history-check.py` (exact harness below), exit 0:

```text
{"status": "verified", "historical_decision_bytes": 1637, "historical_decision_sha256": "0948a5961d9fea08105ce66aff7fd732529c8d1c6ed9258efc4d64362dedc3f0", "ledger_unchanged": true, "raw_august_27_observation_unchanged": true}
```

```python
from pathlib import Path
from hashlib import sha256
import subprocess
import json
p=Path('docs/deploy/openai-pattern-rollout.md')
base=subprocess.check_output(['git','show','HEAD:docs/deploy/openai-pattern-rollout.md'])
after=p.read_bytes()
start=b'**Superseding decision (2026-08-27):**'
end=b'The dated failed-candidate history below is preserved deliberately:'
original=base[base.index(start):base.index(end)]
restored=after[after.index(start):after.index('## Production observation — 2026-08-27'.encode())]
if original!=restored:raise SystemExit('historical_decision_changed')
ledger=b'## Evidence ledger'
if base[base.index(ledger):]!=after[after.index(ledger):]:raise SystemExit('ledger_changed')
observation='## Production observation — 2026-08-27'.encode()
interpretation=b'### What this means for the account-wide deploy'
if base[base.index(observation):base.index(interpretation)]!=after[after.index(observation):after.index(interpretation)]:raise SystemExit('raw_observation_changed')
if after.count(start)!=1:raise SystemExit('duplicate_historical_decision')
print(json.dumps({'status':'verified','historical_decision_bytes':len(original),'historical_decision_sha256':sha256(original).hexdigest(),'ledger_unchanged':True,'raw_august_27_observation_unchanged':True}))

```

`git diff --check -- docs/deploy/openai-pattern-rollout.md docs/architecture/source-map/source-corrections.md` exited 0 without output. Checked both added explicit fragment links against their destination IDs. No application/code tests were run for this documentation-only restoration. The optional P3 map licensing citation remains outside this task's ownership. Files frozen for root's scoped re-review.
