#!/bin/bash
# P8-PERF API E2E — overview + katalog pf11–pf44 + riwayat karyawan + ESS.
set -u
BASE="http://localhost:3000"
JAR=/home/z/my-project/.e2e/p8-cookies.txt
rm -f "$JAR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
req() { # method path [json-body]
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then curl -s -X "$m" -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' -d "$b" "$BASE$p"; else curl -s -X "$m" -b "$JAR" -c "$JAR" "$BASE$p"; fi
}

echo "===== LOGIN ====="
TENANT=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"email":"hrd@mii.co.id","password":"onevity123"}' "$BASE/api/auth/login" -c "$JAR" | python3 -c "import sys,json; d=json.load(sys.stdin); ws=d.get('workspaces') or []; print(ws[0]['id'] if ws else '')" 2>/dev/null)
if [ -z "$TENANT" ]; then
  TENANT=$(req GET /api/auth/me | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tenantId') or d.get('session',{}).get('tenantId',''))" 2>/dev/null)
fi
echo "tenant: $TENANT"
if [ -n "$TENANT" ]; then req POST /api/auth/select-tenant "{\"tenantId\":\"$TENANT\"}" > /dev/null; fi

echo "===== 1. OVERVIEW ====="
O=$(req GET /api/rekankerja/performance/overview)
echo "$O" | python3 -c "
import sys, json
d = json.load(sys.stdin)
c = d.get('counts', {})
assert 'cycles' in c and 'activeParticipants' in c and 'kpi' in c and 'competency' in c, 'counts shape'
assert len(d.get('ratingDist', [])) == 5, 'ratingDist must have 5'
assert 'statusDist' in d and 'pip' in d
print(f\"  counts={c} rating={[r['count'] for r in d['ratingDist']]} pip={d['pip']}\")
" && ok "overview payload shape" || bad "overview payload shape"

echo "===== 2. _params ====="
req GET "/api/rekankerja/performance/reports/documents?id=_params" > /home/z/my-project/.e2e/p8-params.json
python3 -c "
import json
d = json.load(open('/home/z/my-project/.e2e/p8-params.json'))
assert 'cycles' in d and 'units' in d and 'employees' in d
n = len(d['cycles']); e = len(d['employees'])
assert n >= 1, 'cycles non-empty'
print(f'  cycles={n} units={len(d[\"units\"])} employees={e}')
open('/home/z/my-project/.e2e/p8-ids.txt','w').write(d['cycles'][0]['id'] + '\n' + (d['employees'][0]['id'] if e else '') + '\n')
" && ok "_params cycles/units/employees" || bad "_params"
CYCLE_ID=$(sed -n 1p /home/z/my-project/.e2e/p8-ids.txt)
EMP_ID=$(sed -n 2p /home/z/my-project/.e2e/p8-ids.txt)

echo "===== 3. 14 laporan JSON render ====="
for R in pf11 pf12 pf13; do
  Q="id=$R"
  [ "$R" = "pf12" ] || [ "$R" = "pf13" ] && Q="$Q&cycle=$CYCLE_ID"
  if [ "$R" = "pf13" ]; then Q="id=$R&cycle=$CYCLE_ID"; fi
  RES=$(req GET "/api/rekankerja/performance/reports/documents?$Q")
  CODE=$(echo "$RES" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    assert 'data' in d and 'meta' in d and 'periodLabel' in d['meta']
    print('OK')
except Exception as ex:
    print('ERR ' + str(ex)[:90])
")
  if [ "$CODE" = "OK" ]; then ok "$R render"; else bad "$R → $CODE"; fi
done
for R in pf21 pf22 pf24 pf31 pf32 pf43; do
  RES=$(req GET "/api/rekankerja/performance/reports/documents?id=$R&cycle=$CYCLE_ID")
  CODE=$(echo "$RES" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    assert 'data' in d and 'meta' in d and 'periodLabel' in d['meta']
    print('OK')
except Exception as ex:
    print('ERR ' + str(ex)[:90])
")
  if [ "$CODE" = "OK" ]; then ok "$R render (cycle)"; else bad "$R → $CODE"; fi
done
RES=$(req GET "/api/rekankerja/performance/reports/documents?id=pf23&cycle=$CYCLE_ID&employee=$EMP_ID")
CODE=$(echo "$RES" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    assert 'data' in d and d['data'].get('employee'), 'employee scorecard'
    print('OK')
except Exception as ex:
    print('ERR ' + str(ex)[:90])
")
[ "$CODE" = "OK" ] && ok "pf23 scorecard (cycle+employee)" || bad "pf23 → $CODE"
for R in pf33 pf41 pf42 pf44; do
  RES=$(req GET "/api/rekankerja/performance/reports/documents?id=$R")
  CODE=$(echo "$RES" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    assert 'data' in d and 'meta' in d and 'periodLabel' in d['meta']
    print('OK')
except Exception as ex:
    print('ERR ' + str(ex)[:90])
")
  if [ "$CODE" = "OK" ]; then ok "$R render (tanpa cycle)"; else bad "$R → $CODE"; fi
done

echo "===== 4. Isi data kunci ====="
req GET "/api/rekankerja/performance/reports/documents?id=pf41" > /home/z/my-project/.e2e/p8-r41.json
python3 -c "
import json
d = json.load(open('/home/z/my-project/.e2e/p8-r41.json'))
rows = d['data']['rows']; s = d['data']['summary']
print(f\"  pf41: {len(rows)} rows; sumBonus={s['sumBonus']}; sumRaise={s['sumRaise']}\")
assert len(rows) >= 1, 'merit rows (P5 demo)'
assert s['sumBonus'] and s['sumBonus'] > 0, 'decrypted nominal > 0'
" && ok "pf41 merit nominal terdekripsi" || bad "pf41 merit"
req GET "/api/rekankerja/performance/reports/documents?id=pf42" > /home/z/my-project/.e2e/p8-r42.json
python3 -c "
import json
d = json.load(open('/home/z/my-project/.e2e/p8-r42.json'))
s = d['data']['summary']
print(f\"  pf42: total={s['total']} recovered={s['recovered']} notRec={s['notRecovered']} rate={s['recoveryRate']}\")
assert s['total'] >= 4, 'PIP demo (P6: 5)'
assert s['recoveryRate'] is not None and 0 <= s['recoveryRate'] <= 100
sp = [r['spSuggestion'] for r in d['data']['rows'] if r['spSuggestion']]
assert len(sp) >= 1, 'NotRecovered SP suggestion'
" && ok "pf42 PIP register + saran SP" || bad "pf42 PIP"
req GET "/api/rekankerja/performance/reports/documents?id=pf32&cycle=$CYCLE_ID" > /home/z/my-project/.e2e/p8-r32.json
python3 -c "
import json
d = json.load(open('/home/z/my-project/.e2e/p8-r32.json'))
rows = d['data']['rows']; comp = d['data']['company']
print(f\"  pf32: n={comp['n']} mean={comp['mean']} sigma={comp['sigma']}; managers={len(rows)} flags={[r['flag'] for r in rows]}\")
assert len(rows) >= 1
assert all(r['z'] is None or -5 <= r['z'] <= 5 for r in rows)
" && ok "pf32 bias z-flag" || bad "pf32 bias"
req GET "/api/rekankerja/performance/reports/documents?id=pf24&cycle=$CYCLE_ID" > /home/z/my-project/.e2e/p8-r24.json
python3 -c "
import json
d = json.load(open('/home/z/my-project/.e2e/p8-r24.json'))
print(f\"  pf24: groups={[(g['group'], g['count']) for g in d['data']['groups']]} excluded={d['data']['excluded']}\")
for g in d['data']['groups']:
    assert g['count'] >= 3
" && ok "pf24 anonimitas ≥3" || bad "pf24"

echo "===== 5. Guard & error path ====="
C1=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/rekankerja/performance/reports/documents?id=pf11")
[ "$C1" = "401" ] && ok "tanpa sesi → 401" || bad "guard 401 → got $C1"
C2=$(req GET "/api/rekankerja/performance/reports/documents?id=pf99" | head -c 120)
echo "$C2" | grep -q "tidak dikenal" && ok "id tak dikenal → pesan jelas" || bad "id tak dikenal: $C2"
C3=$(req GET "/api/rekankerja/performance/reports/documents?id=pf12" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','')[:70])" 2>/dev/null)
echo "$C3" | grep -q "wajib" && ok "pf12 tanpa cycle → pesan wajib" || bad "pf12 no cycle: $C3"
C4=$(req GET "/api/rekankerja/performance/reports/documents?id=employee-history" | head -c 80)
echo "$C4" | grep -q "wajib" && ok "employee-history tanpa employeeId → 400" || bad "eh guard: $C4"
C5=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" "$BASE/api/rekankerja/performance/reports/documents?id=employee-history&employeeId=x&export=xlsx")
[ "$C5" = "404" ] && ok "employee-history karyawan tak dikenal → 404" || bad "eh 404 → $C5"

echo "===== 6. Ekspor XLSX ====="
for Q in "id=pf11&export=xlsx&lang=en" "id=pf41&export=xlsx&lang=id" "id=pf23&cycle=$CYCLE_ID&employee=$EMP_ID&export=xlsx&lang=en"; do
  CT=$(curl -s -o /home/z/my-project/.e2e/p8-export.xlsx -w "%{content_type}" -b "$JAR" "$BASE/api/rekankerja/performance/reports/documents?$Q")
  SZ=$(stat -c%s /home/z/my-project/.e2e/p8-export.xlsx 2>/dev/null || echo 0)
  if echo "$CT" | grep -q "spreadsheet" && [ "$SZ" -gt 4000 ]; then ok "XLSX ($Q) ${SZ}B"; else bad "XLSX ($Q) ct=$CT sz=$SZ"; fi
done
CT=$(curl -s -o /home/z/my-project/.e2e/p8-eh.xlsx -w "%{content_type}" -b "$JAR" "$BASE/api/rekankerja/performance/reports/documents?id=employee-history&employeeId=$EMP_ID&export=xlsx&lang=en")
SZ=$(stat -c%s /home/z/my-project/.e2e/p8-eh.xlsx 2>/dev/null || echo 0)
if echo "$CT" | grep -q "spreadsheet" && [ "$SZ" -gt 4000 ]; then ok "XLSX employee-history (5 sheet) ${SZ}B"; else bad "XLSX eh ct=$CT sz=$SZ"; fi

echo "===== 7. ESS my-history ====="
rm -f /home/z/my-project/.e2e/p8-ess.txt
ELOGIN=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"email":"ayu.pip@mii.co.id","password":"EssDemo123!"}' "$BASE/api/auth/login" -c /home/z/my-project/.e2e/p8-ess.txt)
ET=$(echo "$ELOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); ws=d.get('workspaces') or []; print(ws[0]['id'] if ws else '')" 2>/dev/null)
if [ -n "$ET" ]; then curl -s -X POST -b /home/z/my-project/.e2e/p8-ess.txt -c /home/z/my-project/.e2e/p8-ess.txt -H 'Content-Type: application/json' -d "{\"tenantId\":\"$ET\"}" "$BASE/api/auth/select-tenant" > /dev/null; fi
ECT=$(curl -s -o /home/z/my-project/.e2e/p8-ess-hist.xlsx -w "%{content_type}" -b /home/z/my-project/.e2e/p8-ess.txt "$BASE/api/rekankerja/ess/my-history?export=xlsx&lang=id")
ESZ=$(stat -c%s /home/z/my-project/.e2e/p8-ess-hist.xlsx 2>/dev/null || echo 0)
if echo "$ECT" | grep -q "spreadsheet" && [ "$ESZ" -gt 4000 ]; then ok "ESS my-history XLSX ${ESZ}B"; else bad "ESS my-history ct=$ECT sz=$ESZ"; fi
E400=$(curl -s -o /dev/null -w "%{http_code}" -b /home/z/my-project/.e2e/p8-ess.txt "$BASE/api/rekankerja/ess/my-history")
[ "$E400" = "400" ] && ok "my-history tanpa export → 400" || bad "my-history guard → $E400"
E401=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/rekankerja/ess/my-history?export=xlsx")
[ "$E401" = "401" ] && ok "my-history tanpa sesi → 401" || bad "my-history 401 → $E401"
E403=$(curl -s -o /dev/null -w "%{http_code}" -b /home/z/my-project/.e2e/p8-ess.txt "$BASE/api/rekankerja/performance/reports/documents?id=pf11")
[ "$E403" = "403" ] && ok "ESS mencoba laporan admin → 403" || bad "ESS guard pf11 → $E403"

echo "===== 8. Kinerja tab data (employee-detail) ====="
req GET "/api/rekankerja/employee-detail?id=$EMP_ID" > /home/z/my-project/.e2e/p8-emp.json
python3 -c "
import json
d = json.load(open('/home/z/my-project/.e2e/p8-emp.json'))
perf = d.get('employee', {}).get('performance')
assert perf is not None, 'performance field present'
print(f\"  appraisals={len(perf['appraisals'])} pips={len(perf['pips'])}\")
a0 = perf['appraisals'][0] if perf['appraisals'] else None
if a0: print(f\"  row0: {a0['docNo']} {a0['cycleCode']} status={a0['status']} final={a0['finalScore']} kpi={a0['kpiCount']}\")
" && ok "employee-detail performance register" || bad "employee-detail performance"

echo ""
echo "======================================="
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
