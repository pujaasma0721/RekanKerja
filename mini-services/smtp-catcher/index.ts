// mini-services/smtp-catcher — SMTP catch-all lokal untuk uji notifikasi email RekanKerja (Task 34).
// Server SMTP minimal (RFC 5321 subset): HELO/EHLO, MAIL FROM, RCPT TO, DATA, QUIT, RSET, NOOP.
// Semua email DITERIMA dan disimpan ke catch.jsonl (from/to/subject/body + timestamp).
// Port: 2525. Untuk pengujian sandbox — jangan dipakai produksi.
import net from "node:net";
import { appendFileSync } from "node:fs";
import path from "node:path";

const PORT = 2525;
const OUT = path.join(process.cwd(), "catch.jsonl");

interface Msg { at: string; from: string; to: string[]; data: string }

const server = net.createServer((socket) => {
  let from = "";
  const to: string[] = [];
  let inData = false;
  let buffer = "";

  const send = (line: string) => socket.write(line + "\r\n");
  send("220 rekankerja-smtp-catcher ready");

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf-8");
    if (inData) {
      // mode DATA: tunggu terminator <CR><LF>.<CR><LF>
      const end = buffer.indexOf("\r\n.\r\n");
      if (end !== -1) {
        const data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        const msg: Msg = { at: new Date().toISOString(), from, to: [...to], data };
        try { appendFileSync(OUT, JSON.stringify(msg) + "\n"); } catch { /* best-effort */ }
        console.log(`[smtp-catcher] ${from} → ${to.join(",")} (${data.length} B)`);
        inData = false; from = ""; to.length = 0;
        send("250 OK — diterima (dilihat di catch.jsonl)");
      }
      return;
    }

    // mode command — proses baris demi baris
    let idx: number;
    while ((idx = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        send("250-rekankerja-smtp-catcher");
        send("250 OK");
      } else if (upper.startsWith("MAIL FROM:")) {
        from = line.slice(10).trim().replace(/^<|>$/g, "");
        send("250 OK");
      } else if (upper.startsWith("RCPT TO:")) {
        to.push(line.slice(8).trim().replace(/^<|>$/g, ""));
        send("250 OK");
      } else if (upper === "DATA") {
        inData = true;
        send("354 End data with <CR><LF>.<CR><LF>");
      } else if (upper === "QUIT") {
        send("221 Bye");
        socket.end();
      } else if (upper === "RSET") {
        from = ""; to.length = 0; inData = false;
        send("250 OK");
      } else if (upper === "NOOP") {
        send("250 OK");
      } else {
        send("250 OK"); // permissif: terima apa pun biar uji tidak tersangkut
      }
    }
  });

  socket.on("error", (e) => console.error("[smtp-catcher] socket:", e.message));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[smtp-catcher] listening 127.0.0.1:${PORT} — email ditulis ke ${OUT}`);
});
