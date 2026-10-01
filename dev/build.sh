#!/bin/sh
# Builds dev/bundle.js: fake profile + the extension's content scripts + highlight CSS,
# for injecting into a job page served through dev/proxy.py.
DEV="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DEV")"
{
  echo "delete globalThis.__jobscriptFill;"
  cat "$DEV/stub.js" "$ROOT/lib/storage.js" "$ROOT/lib/fieldMap.js" "$ROOT/lib/dateRules.js"
  # Let the proxied site's rules apply on 127.0.0.1 (the proxy sets window.__jsTargetSite).
  echo '(FieldMap.sites.find(function(s){return s.name===window.__jsTargetSite})||{hosts:[]}).hosts.push(/^127\.0\.0\.1$/);'
  cat "$ROOT/content/panel.js" "$ROOT/content/bank.js" "$ROOT/content/autofill.js"
  printf '\n(function(){var s=document.getElementById("jobscript-test-css")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"jobscript-test-css"}));s.textContent=%s;})();\n' \
    "$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' "$ROOT/content/autofill.css")"
} > "$DEV/bundle.js"
echo "Built $DEV/bundle.js"
