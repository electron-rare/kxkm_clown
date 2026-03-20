#!/usr/bin/env bash
# E2E test: connects to real WS, sends messages, verifies responses
set -e
PORT=${1:-3333}
PASS=0
FAIL=0
TOTAL=0

check() {
  TOTAL=$((TOTAL+1))
  if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  OK: $2"
  else FAIL=$((FAIL+1)); echo "  FAIL: $2"; fi
}

echo "=== E2E Chat Tests (localhost:$PORT) ==="

# Test 1: Health endpoint
code=$(curl -sf -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/v2/health)
check $([ "$code" = "200" ] && echo 0 || echo 1) "Health endpoint returns 200"

# Test 2: Login
result=$(curl -sf -X POST http://localhost:$PORT/api/session/login -H 'Content-Type: application/json' -d '{"username":"e2e_test","role":"viewer"}')
check $(echo "$result" | grep -q '"ok":true' && echo 0 || echo 1) "Login returns ok:true"

# Test 3: Perf endpoint
code=$(curl -sf -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/v2/perf)
check $([ "$code" = "200" ] && echo 0 || echo 1) "Perf endpoint returns 200"

# Test 4: Media images list
code=$(curl -sf -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/v2/media/images)
check $([ "$code" = "200" ] && echo 0 || echo 1) "Media images returns 200"

# Test 5: SearXNG search
results=$(curl -sf 'http://localhost:8080/search?q=test&format=json' | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("results",[])))' 2>/dev/null || echo 0)
check $([ "$results" -gt 0 ] 2>/dev/null && echo 0 || echo 1) "SearXNG returns results ($results)"

# Test 6: WebSocket connect + MOTD
source ~/.nvm/nvm.sh
motd=$(cd ~/KXKM_Clown && timeout 5 node -e "
const ws=new(require('ws'))('ws://localhost:$PORT/ws?nick=e2e');
ws.on('message',d=>{const m=JSON.parse(d);if(m.type==='system'&&m.text&&m.text.includes('KXKM')){console.log('MOTD_OK');ws.close();process.exit(0)}});
setTimeout(()=>{console.log('TIMEOUT');process.exit(1)},4000);
" 2>/dev/null || echo TIMEOUT)
check $([ "$motd" = "MOTD_OK" ] && echo 0 || echo 1) "WebSocket receives MOTD"

# Test 7: Chat response (persona answers)
response=$(cd ~/KXKM_Clown && timeout 20 node -e "
const ws=new(require('ws'))('ws://localhost:$PORT/ws?nick=e2e_chat');
let got=false;
ws.on('open',()=>setTimeout(()=>ws.send(JSON.stringify({type:'message',text:'test'})),500));
ws.on('message',d=>{const m=JSON.parse(d);if((m.type==='message'||m.type==='chunk')&&m.nick&&m.nick!=='e2e_chat'){console.log('RESPONSE_OK');got=true;ws.close();process.exit(0)}});
setTimeout(()=>{console.log(got?'RESPONSE_OK':'TIMEOUT');ws.close();process.exit(got?0:1)},18000);
" 2>/dev/null || echo TIMEOUT)
check $([ "$response" = "RESPONSE_OK" ] && echo 0 || echo 1) "Persona responds to message"

# Test 8: Ollama loaded
models=$(ollama ps 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
check $([ "$models" -gt 0 ] 2>/dev/null && echo 0 || echo 1) "Ollama has $models models loaded"

# Test 9: Docling health
code=$(curl -sf -o /dev/null -w '%{http_code}' http://localhost:9400/health 2>/dev/null || echo 000)
check $([ "$code" = "200" ] && echo 0 || echo 1) "Docling healthy"

# Test 10: Reranker health
code=$(curl -sf -o /dev/null -w '%{http_code}' http://localhost:9500/health 2>/dev/null || echo 000)
check $([ "$code" = "200" ] && echo 0 || echo 1) "Reranker healthy"

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
exit $FAIL
