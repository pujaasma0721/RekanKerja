// ============================================================================
// JasperRunner — bridge engine iReport/JasperReports untuk SPT 1721-A1 ======
// ============================================================================
// Dijalankan via single-file source launch (JDK 11+):
//
//   java -Djava.awt.headless=true \
//        -Duser.language=id -Duser.country=ID \
//        -cp "lib/*" JasperRunner.java \
//        <templates/SPT1721A1.jrxml> <cache/SPT1721A1.jasper> \
//        <data.txt> <realPathDir> <output.pdf>
//
// Peran tiap argumen:
//   1. jrxml   — template sumber (VERSI ASLI DJP-era e-Bupot, tidak diubah
//                layout-nya; hanya diisi data).
//   2. cache   — .jasper hasil kompilasi (dipakai ulang selama jrxml lebih
//                tua dari cache — kompilasi ECJ hanya sekali).
//   3. data    — data baris (satu baris = satu record detail; pemisah kolom
//                \u0001; urutan kolom = FIELD_ORDER di bawah — HARUS identik
//                dgn adapter TS di
//                src/rekankerja/payroll/services/spt1721a1-jrxml.ts).
//   4. realPath— direktori berisi images/pajak.png (logo DJP header form).
//   5. out.pdf — berkas PDF hasil (folio 612x936pt, 1 halaman per karyawan
//                via group iEmployeeId isStartNewPage).
//
// Locale id_ID dipaksakan lewat flag JVM agar DecimalFormat().format() pada
// ekspresi template memakai pemisah ribuan "." (konvensi Indonesia), sama
// dgn perilaku legacy sistem HRIS aslinya.
// ============================================================================
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import net.sf.jasperreports.engine.JasperCompileManager;
import net.sf.jasperreports.engine.JasperExportManager;
import net.sf.jasperreports.engine.JasperFillManager;
import net.sf.jasperreports.engine.JasperPrint;
import net.sf.jasperreports.engine.JasperReport;
import net.sf.jasperreports.engine.util.JRLoader;
import net.sf.jasperreports.engine.util.JRSaver;
import net.sf.jasperreports.engine.data.JRMapCollectionDataSource;

public class JasperRunner {

    // ==== URUTAN KOLOM data.txt (SINGLE SOURCE OF TRUTH — mirror TS adapter) ====
    static final String[] FIELD_ORDER = {
        "iEmployeeId", "iSequenceNo", "iCompanyCompulsionNo", "iEmployeeName",
        "iCompanyAddress", "iCompanyName", "iEmployeeCompulsionNo", "iSptYear",
        "iEmployeeAddress", "iPosition", "iPtkpStatus", "iGender",
        "iCitizenship", "iD2", "iD10", "iD11", "iD15", "iD16", "iD17",
        "iD19", "iD20", "iD21", "iD22", "iLeaderName", "iCityOfSign",
        "iWageType", "iNominalAmount", "iTaxMethod", "iDeductionType",
        "iPaidNetTax", "iPaidGrossTax", "iParameterValue", "iD26", "iD26a",
        "iLeaderNPWP", "iIncomePeriod", "iBasicIncome", "iPeriodFrom",
        "iPeriodTo", "iAdjNet", "iAdjGross", "iD18", "iSPTReference", "iID",
        "iDate", "iPic", "iTaxBefore", "iNITKU", "iCompanyNITKU", "iInsGov",
    };

    // ==== Field bertipe java.lang.Double di JRXML (sisanya String) ====
    static final Set<String> DOUBLE_FIELDS = new HashSet<>(Set.of(
        "iSptYear", "iD2", "iD10", "iD11", "iD15", "iD16", "iD17", "iD19",
        "iD20", "iD21", "iD22", "iNominalAmount", "iPaidNetTax",
        "iPaidGrossTax", "iParameterValue", "iD26a", "iAdjNet", "iAdjGross",
        "iD18", "iTaxBefore"
    ));

    public static void main(String[] args) {
        if (args.length < 5) {
            System.err.println("usage: JasperRunner <jrxml> <cache.jasper> <data.txt> <realPathDir> <out.pdf>");
            System.exit(2);
        }
        String jrxmlPath = args[0];
        String cachePath = args[1];
        String dataPath = args[2];
        String realPath = args[3];
        String outPath = args[4];

        try {
            // ---------- 1. load / compile report ----------
            JasperReport report;
            File jf = new File(jrxmlPath);
            File cf = new File(cachePath);
            if (!cf.exists() || cf.lastModified() < jf.lastModified()) {
                long t0 = System.currentTimeMillis();
                report = JasperCompileManager.compileReport(jrxmlPath);
                // tulis cache (atomic-ish: tulis tmp lalu rename)
                File tmp = new File(cachePath + ".tmp");
                JRSaver.saveObject(report, tmp);
                if (!tmp.renameTo(cf)) {
                    // rename gagal (cross-device/dll) — fallback salinan langsung
                    JRSaver.saveObject(report, cf);
                }
                System.err.println("[jasper] compiled template in " + (System.currentTimeMillis() - t0) + " ms");
            } else {
                report = (JasperReport) JRLoader.loadObject(cf);
            }

            // ---------- 2. baca data baris ----------
            List<Map<String, ?>> rows = new ArrayList<>();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(new FileInputStream(dataPath), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    String[] parts = line.split("\u0001", -1);
                    Map<String, Object> m = new HashMap<>();
                    for (int i = 0; i < FIELD_ORDER.length; i++) {
                        String v = i < parts.length ? parts[i] : "";
                        if (DOUBLE_FIELDS.contains(FIELD_ORDER[i])) {
                            double d;
                            try { d = v.isEmpty() ? 0.0 : Double.parseDouble(v); }
                            catch (NumberFormatException e) { d = 0.0; }
                            m.put(FIELD_ORDER[i], d);
                        } else {
                            m.put(FIELD_ORDER[i], v);
                        }
                    }
                    rows.add(m);
                }
            }
            if (rows.isEmpty()) {
                System.err.println("[jasper] no data rows");
                System.exit(3);
            }

            // ---------- 3. parameter template ----------
            Map<String, Object> params = new HashMap<>();
            params.put("pRealPath", realPath);
            params.put("pPrintDate", new SimpleDateFormat("dd/MM/yyyy").format(new Date()));

            // ---------- 4. fill ----------
            JasperPrint print = JasperFillManager.fillReport(
                report, params, new JRMapCollectionDataSource(rows));

            // ---------- 5. export PDF ----------
            JasperExportManager.exportReportToPdfFile(print, outPath);

            System.out.println("OK pages=" + print.getPages().size()
                + " rows=" + rows.size());
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }
}
