# Task adv-b — Advance Search wiring: MEDICAL, WHISTLEBLOWING, ESS

Agent: full-stack-developer (adv-b)
Task: Wiring `AdvSearchButton` (infra final Task adv-search) ke 11 view list modul MEDICAL, WHISTLEBLOWING & ESS — client-side, adv = filter TAMBAHAN di atas semua query/tab/status filter yang sudah ada.

## Infra yang dipakai (FINAL — tidak boleh diubah)
- `src/rekankerja/shared/lib/adv-search.ts` — `txt/num/dt/sel`, `filterRowsByAdv`, `AdvSearch`, `AdvFieldDef`.
- `src/rekankerja/shared/components/adv-search.tsx` — `<AdvSearchButton fields value onChange className>`.
- Contoh wiring: `employee-directory.tsx` (ADV_FIELDS module-level + tombol di toolbar flex sebelah search).

## Pola wiring yang dipakai di 11 file
```tsx
const ADV_FIELDS: AdvFieldDef<RowType>[] = [ txt(...), sel(..., opts dari peta label file) ];
const [adv, setAdv] = useState<AdvSearch | null>(null);
const rows = useMemo(() => filterRowsByAdv(previouslyFilteredArray, adv, ADV_FIELDS), [deps..., adv]);
<AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} />
```
- Filter lama (query/tab/regex) TIDAK tersentuh — adv dibungkus di luarnya.
- Opsi select di-reuse dari peta label yang sudah ada di tiap file (CLAIM_STATUS_LABEL(_EN), STATUS_META, WB_CATEGORIES, REQ_STATUS_LABEL, CATEGORY_EN, ASSET_CATEGORY_EN, ConditionPill values).
- Nested value (`r.asset.name`) & record dinamis ESS (`pickStr/pickNum`) pakai getter arg-4.

## File ter-wire (11/11, tidak ada skip)
| # | File | Field |
|---|------|-------|
| 1 | medical/components/medical-claims.tsx | docNo, employeeNo, fullName, orgUnitName, typeName, typeCode, claimDate(dt), totalBill, totalReimburse, totalApproved, state(sel), letterNo — tombol sebelah search |
| 2 | medical/components/medical-info.tsx | employeeNo, fullName, orgUnitName, typeCode, typeName, year(num), baseSalary, benefitAmount, usedAmount, remaining — adv di atas filter tahun/jenis/query |
| 3 | medical/components/medical-approval.tsx | sama dgn claims — adv ke DAFTAR PENUH (`advClaims`) SEBELUM dipotong pending/approved/settledHistory; tombol toolbar kanan-atas |
| 4 | medical/components/medical-providers.tsx | code, name, city, address, phone, kind(sel HOSPITAL/INSURANCE), active(sel true/false via getter) — tombol ml-auto baris tab |
| 5 | whistleblow/components/whistleblow-module.tsx (TriagePage) | ticketNo, category(sel), channel(sel ANONIM/ESS), description, incidentDate(dt), location, status(sel), assignedToName, reporterName — adv di atas filter q |
| 6 | ess/components/ess-payslips.tsx | periodName, status(sel Confirmed/Paid), gross, net, paidAt(dt) — useMemo dipindah ke ATAS early-return detail (rules-of-hooks) |
| 7 | ess/components/ess-claims.tsx | 2 set: MED (docNo, typeName, bill, approved, status sel 7 state, submittedAt) & TRV (docNo, destination, status sel 6 status, advance, settlement) — aksesor pickStr/pickNum sama dgn render tabel; 2 state adv |
| 8 | ess/components/ess-requests.tsx | docType(sel WorkOff/Overtime), docNo, status(sel via REQ_STATUS_LABEL), dateLabel(text — payload tanpa ISO) — var `historyRows`; latest* tetap dari recents penuh |
| 9 | ess/components/ess-letters.tsx | reqNo, templateName, purpose, status(sel Pending/Approved/Rejected/Issued), createdAt(dt), letterRefNo — pendingByTemplate tetap dari allRequests (state kartu) |
| 10 | ess/components/ess-announcements.tsx | title, category(sel via CATEGORY_EN), code, body, publishedAt(dt) — chip unread tetap dari counts server |
| 11 | ess/components/ess-assets.tsx | asset.code/name/category(sel)/serialNumber/value (getter bersarang), assignedAt, dueAt, returnedAt, returnCondition(sel Good/Damaged/Lost) — SATU adv utk 2 daftar (aktif+riwayat) |

## Deviasi dari spec (terdokumentasi)
1. ess-requests `dateLabel` = TEXT (payload ess/api/dashboard.ts hanya kirim label terformat, tanpa ISO).
2. Select status klaim medis ESS = 7 state penuh CLAIM_STATUS_LABEL (termasuk Returned/Settled).
3. ess-assets `returnCondition` = SELECT (peta ConditionPill ada di file), spec awal bilang text.
4. medical-providers + address & phone; ess-announcements + code & publishedAt (kolom/konten tabel-kartu).
5. medical-approval: tombol di toolbar kanan-atas tersendiri (view tanpa search box).
6. ess-payslips: useMemo harus dipindah sebelum early-return `if (lineId)` — fix rules-of-hooks.

## Verifikasi
- `bunx tsc --noEmit` → 0 error.
- `bun run lint` → 0 error, 7 warning pre-existing (file lain + 1 infra adv-search.tsx).
- dev.log bersih dari error kompilasi.
- Infra adv-search.ts/.tsx, medical-types.ts, ess-types.ts, ess-api.ts & semua API/service TIDAK diubah.
