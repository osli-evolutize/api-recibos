const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const destino = process.env.SQLITE_FILE || path.join(__dirname, "..", "migracao-sqlite", "app.db");
const servidor = process.env.DB_SERVER || "localhost";
const banco = process.env.DB_DATABASE || "AutoGestao";

const camposRecibo = [
  "ReciboRendaNumero",
  "ReciboRendaDataEmissao",
  "ReciboRendaEmitente",
  "ReciboRendaLocador",
  "ReciboRendaSubLocador",
  "ReciboRendaLocatario",
  "ReciboRendaLocatarioNIF",
  "ReciboRendaLocatarioNIFEstrangeiro",
  "ReciboRendaLocatarioNIFPais",
  "ReciboRendaSubLocatario",
  "ReciboRendaSubLocatarioNIF",
  "ReciboRendaSubLocatarioNIFEstrangeiro",
  "ReciboRendaSubLocatarioNIFPais",
  "ReciboRendaTipoContrato",
  "ReciboRendaFreguesia",
  "ReciboRendaTipo",
  "ReciboRendaArtigo",
  "ReciboRendaFracao",
  "ReciboRendaLocalizacao",
  "ReciboRendaPeriodoDe",
  "ReciboRendaPeriodoAte",
  "ReciboRendaValor",
  "ReciboRendaRetencaoIRS",
  "ReciboRendaTituloDe",
  "ReciboRendaDataRecebimento",
  "ReciboRendaInfComplementar",
  "ReciboRendaEmitenteNIF",
  "ReciboRendaLocadorNIF",
  "ReciboRendaSubLocadorNIF",
];

const camposTextoRecibo = new Set(camposRecibo.filter((campo) => ![
  "ReciboRendaNumero",
  "ReciboRendaDataEmissao",
  "ReciboRendaPeriodoDe",
  "ReciboRendaPeriodoAte",
  "ReciboRendaValor",
  "ReciboRendaRetencaoIRS",
  "ReciboRendaDataRecebimento",
].includes(campo)));

function selectRecibos() {
  return camposRecibo.map((campo) => {
    if (campo === "ReciboRendaNumero") return "CAST(ReciboRendaNumero AS int) AS ReciboRendaNumero";
    if (["ReciboRendaDataEmissao", "ReciboRendaPeriodoDe", "ReciboRendaPeriodoAte", "ReciboRendaDataRecebimento"].includes(campo)) {
      return `CONVERT(varchar(10), ${campo}, 23) AS ${campo}`;
    }
    if (["ReciboRendaValor", "ReciboRendaRetencaoIRS"].includes(campo)) {
      return `CAST(${campo} AS decimal(18,2)) AS ${campo}`;
    }
    if (camposTextoRecibo.has(campo)) return `LTRIM(RTRIM(${campo})) AS ${campo}`;
    return campo;
  }).join(", ");
}

function executarJson(query, propriedades) {
  const seletor = propriedades.map((campo) => `@{n='${campo}';e={$_.${campo}}}`).join(",");
  const comando = `
    $ErrorActionPreference = 'Stop';
    $dados = Invoke-Sqlcmd -ServerInstance '${servidor.replace(/'/g, "''")}' -Database '${banco.replace(/'/g, "''")}' -Query @"
${query}
"@;
    @($dados | Select-Object ${seletor}) | ConvertTo-Json -Compress -Depth 4
  `;
  const saida = execFileSync("powershell", ["-NoProfile", "-Command", comando], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const texto = saida.trim();
  if (!texto) return [];
  const parsed = JSON.parse(texto);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizarData(valor) {
  if (!valor) return "";
  return String(valor).slice(0, 10);
}

fs.mkdirSync(path.dirname(destino), { recursive: true });
for (const arquivo of [destino, `${destino}-wal`, `${destino}-shm`]) {
  if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
}

const recibos = executarJson(`SET NOCOUNT ON; SELECT ${selectRecibos()} FROM dbo.ReciboRenda ORDER BY ReciboRendaNumero;`, camposRecibo);
const usuarios = executarJson(`
SET NOCOUNT ON;
SELECT LTRIM(RTRIM(usucod)) AS usucod,
       LTRIM(RTRIM(usunome)) AS usunome,
       LTRIM(RTRIM(ususenha)) AS ususenha,
       usuperfil,
       ISNULL(usuemail, '') AS usuemail
FROM dbo.Usuario
ORDER BY usucod;
`, ["usucod", "usunome", "ususenha", "usuperfil", "usuemail"]);

const db = new Database(destino);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE Usuario (
  usucod TEXT PRIMARY KEY,
  usunome TEXT NOT NULL,
  ususenha TEXT NOT NULL,
  usuperfil INTEGER NOT NULL,
  usuemail TEXT
);

CREATE TABLE ReciboRenda (
  ReciboRendaNumero INTEGER PRIMARY KEY,
  ReciboRendaDataEmissao TEXT NOT NULL,
  ReciboRendaEmitente TEXT NOT NULL,
  ReciboRendaLocador TEXT NOT NULL,
  ReciboRendaSubLocador TEXT NOT NULL,
  ReciboRendaLocatario TEXT NOT NULL,
  ReciboRendaLocatarioNIF TEXT NOT NULL,
  ReciboRendaLocatarioNIFEstrangeiro TEXT NOT NULL,
  ReciboRendaLocatarioNIFPais TEXT NOT NULL,
  ReciboRendaSubLocatario TEXT NOT NULL,
  ReciboRendaSubLocatarioNIF TEXT NOT NULL,
  ReciboRendaSubLocatarioNIFEstrangeiro TEXT NOT NULL,
  ReciboRendaSubLocatarioNIFPais TEXT NOT NULL,
  ReciboRendaTipoContrato TEXT NOT NULL,
  ReciboRendaFreguesia TEXT NOT NULL,
  ReciboRendaTipo TEXT NOT NULL,
  ReciboRendaArtigo TEXT NOT NULL,
  ReciboRendaFracao TEXT NOT NULL,
  ReciboRendaLocalizacao TEXT NOT NULL,
  ReciboRendaPeriodoDe TEXT NOT NULL,
  ReciboRendaPeriodoAte TEXT NOT NULL,
  ReciboRendaValor REAL NOT NULL,
  ReciboRendaRetencaoIRS REAL NOT NULL,
  ReciboRendaTituloDe TEXT NOT NULL,
  ReciboRendaDataRecebimento TEXT NOT NULL,
  ReciboRendaInfComplementar TEXT NOT NULL,
  ReciboRendaEmitenteNIF TEXT NOT NULL,
  ReciboRendaLocadorNIF TEXT NOT NULL,
  ReciboRendaSubLocadorNIF TEXT NOT NULL
);
`);

const insertUsuario = db.prepare(`
  INSERT INTO Usuario (usucod, usunome, ususenha, usuperfil, usuemail)
  VALUES (@usucod, @usunome, @ususenha, @usuperfil, @usuemail)
`);

const insertRecibo = db.prepare(`
  INSERT INTO ReciboRenda (${camposRecibo.join(", ")})
  VALUES (${camposRecibo.map((campo) => `@${campo}`).join(", ")})
`);

const transacao = db.transaction(() => {
  for (const usuario of usuarios) insertUsuario.run(usuario);
  for (const recibo of recibos) {
    for (const campo of ["ReciboRendaDataEmissao", "ReciboRendaPeriodoDe", "ReciboRendaPeriodoAte", "ReciboRendaDataRecebimento"]) {
      recibo[campo] = normalizarData(recibo[campo]);
    }
    insertRecibo.run(recibo);
  }
});

transacao();
db.close();

console.log(`SQLite gerado em ${destino}`);
console.log(`${recibos.length} recibos e ${usuarios.length} usuarios migrados.`);

