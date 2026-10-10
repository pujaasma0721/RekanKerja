# Task adv-a — full-stack-developer — Advance Search wiring LEAVE & TRAVEL

> Lihat worklog.md (append "Task ID: adv-a") untuk catatan lengkap.
> Ringkasan kontrak & artefak utk agen berikutnya (adv-b dst).

## Artefak

- **DIUBAH (9 file, wiring client-side AdvSearchButton — pola infra Task adv-search):**
  - `src/rekankerja/leave/components/leave-requests.tsx` — ADV_FIELDS 11 field (RequestRowUI; status dari STATUS_FILTERS/_EN; saldo = key `remainingAtRequest`).
  - `src/rekankerja/leave/components/leave-approval.tsx` — ADV_FIELDS 7 field (status dari LEAVE_STATUS_LABEL/_EN).
  - `src/rekankerja/leave/components/leave-balances.tsx` — ADV_FIELDS 10 field (BalanceRowUI; useTableSort tetap di atas hasil adv).
  - `src/rekankerja/leave/components/leave-encashment.tsx` — ADV_FIELDS 9 field (status = STATUS_FILTERS/_EN + Cancelled dari LEAVE_STATUS_LABEL/_EN; + paymentDate date).
  - `src/rekankerja/leave/components/leave-templates.tsx` — ADV_FIELDS 6 field (`active` boolean → sel "true"/"false" via getter `String(ty.active)`; unit = DAY/MONTH).
  - `src/rekankerja/travel/components/travel-requests.tsx` — ADV_FIELDS 12 field (status dari STATUS_FILTERS + TRAVEL_STATUS_LABEL_EN; + settlementDue date).
  - `src/rekankerja/travel/components/travel-claims.tsx` — ADV_FIELDS 10 field (uang nullable → getter `?? undefined` agar masked ≠ 0).
  - `src/rekankerja/travel/components/travel-approval.tsx` — ADV_FIELDS 10 field (antrean Submitted; `recent` tak tersentuh).
  - `src/rekankerja/travel/components/travel-reports.tsx` — ADV_FIELDS 11 field (`type ReportRow = ReportData["rows"][number]`); tombol Reset juga `setAdv(null)`.
- **TIDAK DIUBAH**: infra `shared/lib/adv-search.ts`, `shared/components/adv-search.tsx`, `leave-types.ts`, `travel-types.ts`, semua API/service.

## Pola wiring (identik semua file)

```tsx
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, dt, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";

const ADV_FIELDS: AdvFieldDef<Row>[] = [ /* label dwibahasa ikut header tabel */ ];

const [adv, setAdv] = useState<AdvSearch | null>(null);
const rows = useMemo(() => filterRowsByAdv(/* filter query lama */, adv, ADV_FIELDS), [/* deps lama */, adv]);

<AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} /> // satu flex container dgn Input search lama
```

- Filter lama TIDAK tersentuh — adv murni ADDITIONAL.
- Status select: opsi/label dari peta yang sudah ada di file (STATUS_FILTERS/_EN, LEAVE_STATUS_LABEL(_EN), TRAVEL_STATUS_LABEL(_EN)) — JANGAN hardcode baru.

## Catatan utk agen berikutnya

1. Leave requests/approval: field saldo memakai key `remainingAtRequest` (nama properti asli), bukan `remaining`.
2. Leave encashment: opsi status + Cancelled (aksi cancel ada di tabel); ada field paymentDate (dt).
3. Travel claims/reports: kolom uang nullable (Brankas Uang) pakai getter `(r) => r.xxx ?? undefined` — Number(null)=0 tanpa getter, jadi nilai ter-mask akan salah cocok dgn `= 0`.
4. travel-reports: baris = klaim (claimDate), tidak ada dateFrom; Reset button harus ikut `setAdv(null)`.
5. Verifikasi task ini: `bunx tsc --noEmit` bersih; `bun run lint` 0 error (7 warning pre-existing di file lain).
