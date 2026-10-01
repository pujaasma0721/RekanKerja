# Task 45-a — full-stack-developer — Money Vault backend core

> Lihat worklog.md (append "Task ID: 45-a") untuk catatan lengkap.
> Ringkasan kontrak & artefak utk agen berikutnya (45-b / 45-c).

## Artefak

- **BARU**
  - `scripts/migrate-money-vault.ts` — DDL idempoten MoneyVault + MoneyViewGrant per schema (CLI + parity-runner in-process).
  - `src/rekankerja/shared/lib/money-vault.ts` — kripto vault (PBKDF2 210k → KEK/verifierKey; verifier `vrf:v1:`; wrappedKey `vlt:v1:iv:tag:ct` = AES-256-GCM(KEK, tenantDataKey)), state memori symbol-keyed (openKeys/configCache 60s/grantCache 60s/fails lockout), VaultError {code,status}.
  - `src/rekankerja/shared/lib/money-view.ts` — `getMoneyView(db, {userId, membershipRole})` → `{canSee, reason, dec, dec0, json}`. OPT-IN — belum ada call site.
  - `src/rekankerja/shared/api/money-vault.ts` — GET/POST handler + `requireVaultSession` (sesi tanpa menu key) + audit ActivityLog inline.
  - `src/app/api/rekankerja/money-vault/route.ts`, `src/app/api/rekankerja/money-vault/members/route.ts` — route tipis.
- **DIUBAH**
  - `prisma/schema-tenant.prisma` (+MoneyVault, +MoneyViewGrant — openUntil/openByUserId informatif; open otoritatif di memori).
  - `src/rekankerja/shared/lib/tenant-db.ts` (cache key globalThis `rekankerjaTenantClientsT45A`).
  - `src/rekankerja/shared/lib/field-crypto.ts` (+`tenantDataKey`, `decryptTextWithKey`, `decryptMoneyWithKey` — backward compat).
  - `src/rekankerja/shared/lib/parity-runner.ts` (langkah `money-vault`, append-only).

## API contract

- `GET /api/rekankerja/money-vault` → `{configured, open, openUntil, openBy, canManage, myView: "admin"|"granted"|"none"|"legacy", grantsCount, lockoutUntil, serverNow}`
- `POST /api/rekankerja/money-vault` `{action}` → `setup|unlock|lock|change-password|grant|revoke` (canManage OWNER/ADMIN; grant/revoke validasi member → 404)
- `GET /api/rekankerja/money-vault/members` (canManage) → `{members:[{userId,name,email,role,granted}]}` urut nama
- Error: `{error, code}` — 400 WEAK_PASSWORD/UNKNOWN_ACTION, 403 INVALID_PASSWORD/NOT_ADMIN, 404 NOT_MEMBER, 409 ALREADY_CONFIGURED/VAULT_LOCKED/NOT_CONFIGURED, 429 LOCKOUT

## Deviasi spesifikasi (kecil, terdokumentasi)

1. NOT_CONFIGURED → **409** (peta status eksplisit menang atas komentar "400").
2. `unlockVault(db, password, actor?)` — actor opsional agar openByUserId akurat.
3. `memberList(db, tenantId)` — tenantId eksplisit dari route (lebih bersih).
4. Masked walker t-kind → jalur env (identik `decryptTextWithKey(dek)`; PII tak tergantung vault).
5. Audit unlock/lock diputuskan di route (bandingkan status sebelum/sesudah).

## Untuk 45-b (threading serializer)

- Ganti `tenantCryptoForDb(db).decryptJson(...)` di batas respons uang dengan `await getMoneyView(db, actor).json(...)`; legacy mode = perilaku lama persis → aman bertahap.
- `json` walker: n→angka (open) / null (masked); t→teks selalu; non-enc lewat.
- JANGAN ganti jalur service/engine (payroll/loan tetap tenantCryptoForDb); tanpa agregasi SQL atas ciphertext.
- Demo MII dikembalikan ke unconfigured (legacy-visible); kata sandi uji: vault-demo-123 → 456 (E2E), baris dihapus.
