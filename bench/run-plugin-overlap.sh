#!/usr/bin/env bash
set -euo pipefail

: "${TEMPLATE:?TEMPLATE required}"
: "${ASSETS:?ASSETS required}"
: "${RESULTS:?RESULTS required}"
: "${NOTE_COUNT:?NOTE_COUNT required}"
: "${XDG_CONFIG_HOME:?XDG_CONFIG_HOME required}"

mkdir -p "$XDG_CONFIG_HOME/obsidian" "$RESULTS"

measure_case () {
  CASE="$1"
  CANDIDATE="$2"
  INDEX="$3"
  VAULT="$RUNNER_TEMP/mdse-overlap-$CASE"
  rm -rf "$VAULT"
  cp -a "$TEMPLATE" "$VAULT"

  if [ -n "$CANDIDATE" ]; then
    mkdir -p "$VAULT/.obsidian/plugins/$CANDIDATE"
    cp -a "$ASSETS/$CANDIDATE/." "$VAULT/.obsidian/plugins/$CANDIDATE/"
    node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1]+"/.obsidian/community-plugins.json",JSON.stringify(["mdse-workbench",process.argv[2]],null,2)+"\n")' "$VAULT" "$CANDIDATE"
  else
    printf '%s\n' '["mdse-workbench"]' > "$VAULT/.obsidian/community-plugins.json"
  fi

  export VAULT CANDIDATE CASE
  node -e 'const fs=require("fs"),p=require("path");const out=p.join(process.env.XDG_CONFIG_HOME,"obsidian","obsidian.json");fs.writeFileSync(out,JSON.stringify({vaults:{mdseoverlap:{path:process.env.VAULT,ts:Date.now(),open:true}}},null,2))'

  xvfb-run -a bash -euo pipefail -c '
    /usr/bin/obsidian --no-sandbox --disable-gpu --remote-debugging-port=9222 >"$RUNNER_TEMP/overlap-$CASE-setup.log" 2>&1 &
    PID=$!
    trap "kill $PID 2>/dev/null || true" EXIT
    node bench/obsidian-e2e-setup.mjs "$VAULT" "$CANDIDATE"
    sleep 1
  '

  rm -rf "$VAULT/.obsidian/plugins/mdse-workbench/cache"
  rm -f "$VAULT/.mdse_integration_result.json" "$VAULT/.mdse_integration_metadata.json" "$VAULT/.mdse_integration_readable.json"
  cat > "$VAULT/.obsidian/plugins/mdse-workbench/data.json" <<'EOF'
{"settings":{"warmCachePreview":false}}
EOF

  PORT=$((9230 + INDEX))
  export PORT
  node -e 'const fs=require("fs");fs.writeFileSync(process.env.VAULT+"/.mdse_integration_probe.json",JSON.stringify({launchStartedAt:Date.now(),noteCount:Number(process.env.NOTE_COUNT),label:"overlap-"+(process.env.CANDIDATE||"baseline")},null,2)+"\n")'

  xvfb-run -a bash -euo pipefail -c '
    /usr/bin/obsidian --no-sandbox --disable-gpu --remote-debugging-port="$PORT" >"$RUNNER_TEMP/overlap-$CASE-measured.log" 2>&1 &
    PID=$!
    trap "kill $PID 2>/dev/null || true" EXIT
    node bench/obsidian-e2e-activate.mjs "$VAULT" "$PORT" >"$RUNNER_TEMP/overlap-$CASE-activate.log" 2>&1
    for i in $(seq 1 360); do
      if [ -f "$VAULT/.mdse_integration_result.json" ] && node -e '"'"'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.env.VAULT+"/.mdse_integration_result.json","utf8"));process.exit(Number.isFinite(r.occurrenceReadyAt)?0:1)'"'"'; then
        break
      fi
      sleep 0.5
    done
    test -f "$VAULT/.mdse_integration_result.json"
    node bench/obsidian-plugin-overlap-probe.mjs "$VAULT" "$PORT" "$CANDIDATE" >"$RESULTS/$CASE-capability.json"
  '

  node <<'NODE'
const fs=require("fs"), cp=require("child_process");
const vault=process.env.VAULT, candidate=process.env.CANDIDATE || "", caseName=process.env.CASE;
const result=JSON.parse(fs.readFileSync(vault+"/.mdse_integration_result.json","utf8"));
const capability=JSON.parse(fs.readFileSync(process.env.RESULTS+"/"+caseName+"-capability.json","utf8"));
const fail=(m)=>{throw new Error(caseName+": "+m)};
if(result.mode!=="full") fail("expected full cold rebuild");
if(result.files!==Number(process.env.NOTE_COUNT)) fail("file count mismatch");
if(result.elements!==Number(process.env.NOTE_COUNT)) fail("element count mismatch");
if(!Number.isFinite(result.launchToReadableMs)||!Number.isFinite(result.launchToCoreReadyMs)||!Number.isFinite(result.launchToOccurrenceReadyMs)) fail("startup milestone missing");
if(!capability.workbenchEnabled||!capability.workbenchCoreReady||!capability.commandsReady) fail("Workbench capability unavailable");
if(candidate && !capability.candidateEnabled) fail("candidate plugin not enabled");
const after=cp.execSync('(cd "$VAULT" && find . -type f \\( -name \'*.md\' -o -name \'*.yaml\' \\) -print0 | sort -z | xargs -0 sha256sum | sha256sum)',{env:process.env,shell:"/bin/bash",encoding:"utf8"}).trim();
const before=fs.readFileSync(process.env.RUNNER_TEMP+"/model-template.sha256","utf8").trim();
if(after!==before) fail("governed Markdown/YAML model was mutated");
fs.copyFileSync(vault+"/.mdse_integration_result.json",process.env.RESULTS+"/"+caseName+"-startup.json");
console.log("Validated isolated overlap case",caseName,{readable:result.launchToReadableMs,core:result.launchToCoreReadyMs,occurrence:result.launchToOccurrenceReadyMs,elements:result.elements,links:result.links});
NODE
}

# Sacrificial first case absorbs runner/filesystem/Obsidian first-pass effects.
measure_case warmup "" 0
measure_case baseline-start "" 1
measure_case nodian nodian 2
measure_case breadcrumbs breadcrumbs 3
measure_case dataview dataview 4
measure_case fileclass fileclass 5
measure_case advanced-canvas advanced-canvas 6
measure_case baseline-end "" 7
