import { PrismaClient } from "@/generated/tenant";
const db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_BASE_URL! + "?schema=tenant_pt_mitra_industri_internasional" } } } as never);
const TERMINAL = ["Passed", "Failed", "Cancelled"];
// kandidat aktif per PR + tahap
const cands = await db.jobCandidate.findMany({
  select: { fullName: true, status: true, pr: { select: { prNo: true, position: { select: { title: true } }, status: true } },
    selectionSteps: { select: { status: true, selectionProcess: { select: { name: true } } }, orderBy: { seqNo: "asc" } } },
  orderBy: { pr: { prNo: "asc" } },
});
for (const c of cands) {
  const cur = c.selectionSteps.find((s) => !TERMINAL.includes(s.status));
  console.log(c.pr.prNo, "|", c.pr.position?.title, "|", c.fullName, "|", c.status, "| tahap:", cur ? `${cur.selectionProcess.name} (${cur.status})` : "SELESAI/terminal");
}
const [openSlots, pending, hired] = await Promise.all([
  db.jobOpening.count({ where: { status: "Open" } }),
  db.publicApplication.count({ where: { status: "Pending" } }),
  db.jobCandidate.count({ where: { status: "Hired" } }),
]);
console.log("openSlots:", openSlots, "| stagingPending:", pending, "| hired:", hired);
const activePrs = await db.personnelRequisition.findMany({ where: { status: { in: ["Submitted","Approved","OnHold"] } }, select: { prNo: true, status: true, position: { select: { title: true } } }, orderBy: { prNo: "asc" } });
console.log("PR aktif:", activePrs.map(p => `${p.prNo} ${p.status}`).join(", "));
await db.$disconnect();
