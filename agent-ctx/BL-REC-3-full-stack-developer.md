# BL-REC-3 — full-stack-developer

Bilingual copilot layer (REAL-5 fix) untuk RekanKerja Recruitment AI.
Konteks: lihat worklog.md entri "BL-REC-AUDIT" (temuan REAL-5) + entri F6c.

## Apa yang dikerjakan

`lang: "id" | "en"` end-to-end untuk output AI yang menghadap recruiter:

1. **src/rekankerja/recruitment/services/ai-search-service.ts** (file besar)
   - Helper modul: `L(lang, id, en)` + `LANG_LINE(lang)` ("Jawab dalam Bahasa Indonesia." / "Answer in English.").
   - `aiSearch` input + `lang?` → `describeFilter` bilingual (label interpreted, ID branch identik dengan teks lama).
   - `copilotAction` input + `lang?` → di-thread ke 6 subfungsi (draft-jd / summarize-candidate / interview-questions / outreach / pipeline-qa / check-bias).
   - (a) mode AI: satu baris LANG_LINE ditambahkan ke system prompt tiap subfungsi (termasuk check-bias — suggestion JSON ikut bahasa; pipeline-qa & summarize juga).
   - (b) mode simulasi: SEMUA template user-visible dwibahasa via L() — draf JD (duties fallback, "Tentang Peran"/"Tanggung Jawab"/"Kualifikasi", gaji, cara melamar, footer), ringkasan 5 poin + rekomendasi, pertanyaan interview (generic comps + indikator), outreach WA/email penuh, pipeline-qa (header, agregat, per-PR, closing), check-bias (clean note + caveat + footer ai/simulated + header + baris temuan + ringkasan).
   - BIAS_RULES: `phrases` TETAP Indonesia by design (pola deteksi iklan); hanya `suggestion` yang dwibahasa (field baru `suggestionEn`, via L() — thread ke staticBiasFindings + regex usia). Label kategori temuan EN via `BIAS_ISSUE_LABEL_EN` (usia→age, fisik→physical, dll — hanya tampilan, internal tetap key ID).
   - `fmtDateId(d, lang)` — bulan singkat EN (May/Aug/Oct) untuk outreach; `buildPipelineData(db, lang)` — "Belum ada tahap"→"No stage yet".
2. **src/rekankerja/recruitment/services/ai-score-service.ts**
   - `generateAiScore` input + `lang?`; system prompt AI ditambah baris L("Jawab dalam Bahasa Indonesia.", "Answer in English. Write each evidence in English.").
   - Evidence heuristik simulasi dwibahasa: eduScore/expScore/skillScore/salaryScore/simulateFactor — semua menerima lang.
3. **src/rekankerja/recruitment/api/ai.ts**
   - GET ?q= baca `lang` dari searchParams; POST `score` dan `copilot*` baca `b.lang` → di-thread. parse-text/parse-document/save-rubric/latest-scores TIDAK disentuh (data JSON terstruktur — sesuai brief).
4. **Frontend callers** (useI18n `lang`):
   - `copilot-panel.tsx` — body POST `action:"copilot"` + `lang`.
   - `ai-search-bar.tsx` — GET `?q=...&lang=${lang}` (surface `interpreted` kini bilingual).
   - `ai-score-dialogs.tsx` — POST `action:"score"` + `lang`.
   - `ai-cv-service.ts` SKIPPED sepenuhnya (output JSON pre-fill form — sesuai brief).

## Verifikasi

- `bunx tsc --noEmit` = 0 error.
- `bun run lint` = 0 error / 6 warning baseline (pre-existing).
- `bun scripts/audit-bilingual.ts`: ai-search-service 28 → 14 (aturan lama; sisa 14 = by-design: COPILOT_ACTIONS keys teknis + SEARCH_SYSTEM_PROMPT + frasa deteksi BIAS). Catatan: BL-REC-1 paralel mengubah audit script (+aturan FP) → TOTAL_GAP kini 165 (perubahan gabungan, bukan milik task ini).
- Runtime smoke (bun, script /home/z/.tmp-bl-rec3/bl-rec3-smoke*.ts — di luar repo): check-bias dieksekusi NYATA di kedua bahasa × kedua mode: mode AI (builtin LLM live, prompt + LANG_LINE → JSON valid parse → mode=ai) dan mode simulasi (Z_AI_BASE_URL unroutable → footer "mode simulasi") — output ID byte-identik dengan perilaku lama, EN natural; suggestion BIAS_RULES terverifikasi kedua bahasa via eksekusi nyata (bukan hanya review).
- Code review penuh diff kedua cabang untuk semua blok yang tidak bisa di-smoke offline (draft-jd/summarize/interview/outreach/pipeline-qa butuh baris DB): setiap string Indonesia lama muncul VERBATIM sebagai argumen pertama L() (tidak ada rewording ID); EN natural.
- dev.log: 0 error setelah hot-reload.

## Catatan untuk task lain

- Jangan reword string ID di argumen pertama L() — itu kontrak byte-identik dengan perilaku pra-BL-REC-3.
- Skrip smoke ada di /home/z/.tmp-bl-rec3/ (di luar repo — mungkin hilang saat rollback sandbox).
- TIDAK commit/push (urusan koordinator BL-REC-CORE).
