require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const mssql = require("mssql");
const sqlite = require("./sqlite-db");

const dbClient = (process.env.DB_CLIENT || "sqlite").toLowerCase();
const sql = dbClient === "mssql" ? mssql : sqlite;
const host = process.env.APP_HOST || "127.0.0.1";
const port = Number(process.env.APP_PORT || 3003);
const publicDir = path.join(__dirname, "public");
const sessoes = new Map();

const dbConfig = dbClient === "sqlite"
  ? { filename: process.env.SQLITE_FILE || path.join(__dirname, "migracao-sqlite", "app.db") }
  : {
      server: process.env.DB_SERVER || "localhost",
      database: process.env.DB_DATABASE || "AutoGestao",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        encrypt: process.env.DB_ENCRYPT === "true",
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
      },
    };

let poolPromise;

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

const camposData = new Set([
  "ReciboRendaDataEmissao",
  "ReciboRendaPeriodoDe",
  "ReciboRendaPeriodoAte",
  "ReciboRendaDataRecebimento",
]);

const camposValor = new Set(["ReciboRendaValor", "ReciboRendaRetencaoIRS"]);

function obterPool() {
  if (!poolPromise) poolPromise = sql.connect(dbConfig);
  return poolPromise;
}

function trim(valor) {
  return String(valor ?? "").trim();
}

function dataInput(valor) {
  if (!valor) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function decimal(valor) {
  const numero = Number(String(valor ?? "0").replace(",", "."));
  return Number.isFinite(numero) ? numero : 0;
}

function normalizarRecibo(linha) {
  const recibo = {};
  for (const campo of camposRecibo) {
    if (campo === "ReciboRendaNumero") recibo[campo] = Number(linha[campo] || 0);
    else if (camposData.has(campo)) recibo[campo] = dataInput(linha[campo]);
    else if (camposValor.has(campo)) recibo[campo] = decimal(linha[campo]);
    else recibo[campo] = trim(linha[campo]);
  }
  return recibo;
}

function lerCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf("=");
      return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
    }));
}

function estaAutenticado(req) {
  const token = lerCookies(req).recibosSessao;
  return Boolean(token && sessoes.has(token));
}

function obterSessao(req) {
  const token = lerCookies(req).recibosSessao;
  return token ? sessoes.get(token) : null;
}

function usuarioAdmin(req) {
  const sessao = obterSessao(req);
  return String(sessao?.usuario || "").trim().toLowerCase() === "admin";
}

function exigirAutenticacao(req, res) {
  if (estaAutenticado(req)) return true;
  enviarJson(res, 401, { erro: "Login necessario" });
  return false;
}

function exigirAdmin(req, res) {
  if (usuarioAdmin(req)) return true;
  if (!estaAutenticado(req)) {
    enviarJson(res, 401, { erro: "Login necessario" });
    return false;
  }
  enviarJson(res, 403, { erro: "Acesso permitido apenas para o usuario admin" });
  return false;
}

function cookieSessao(token) {
  return [
    `recibosSessao=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

async function lerCorpoJson(req, limite = 1024 * 1024) {
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > limite) throw new Error("Requisicao muito grande");
    partes.push(parte);
  }
  const texto = Buffer.concat(partes).toString("utf8");
  return texto ? JSON.parse(texto) : {};
}

function enviarJson(res, status, dados) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(dados, null, 2));
}

async function login(req, res) {
  const dados = await lerCorpoJson(req, 16 * 1024);
  const usuario = trim(dados.usuario).toLowerCase();
  const senha = String(dados.senha || "");

  if (!usuario || !senha) {
    enviarJson(res, 400, { erro: "Informe usuario e senha" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("usuario", sql.VarChar(60), usuario)
    .input("senha", sql.VarChar(20), senha)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(usucod)) AS codigo,
        LTRIM(RTRIM(usunome)) AS nome,
        usuperfil AS perfil
      FROM dbo.Usuario
      WHERE (
          LOWER(LTRIM(RTRIM(usucod))) = @usuario
          OR LOWER(LTRIM(RTRIM(usunome))) = @usuario
          OR LOWER(ISNULL(usuemail, '')) = @usuario
        )
        AND LTRIM(RTRIM(ususenha)) = @senha;
    `);

  if (resultado.recordset.length === 0) {
    enviarJson(res, 401, { erro: "Usuario ou senha invalidos" });
    return;
  }

  const usuarioBanco = resultado.recordset[0];
  const token = crypto.randomBytes(24).toString("hex");
  sessoes.set(token, {
    usuario: usuarioBanco.codigo,
    nome: usuarioBanco.nome,
    perfil: usuarioBanco.perfil,
    criadoEm: Date.now(),
  });

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": cookieSessao(token),
  });
  res.end(JSON.stringify({ ok: true, usuario: usuarioBanco.codigo, nome: usuarioBanco.nome }));
}

async function logout(req, res) {
  const token = lerCookies(req).recibosSessao;
  if (token) sessoes.delete(token);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": "recibosSessao=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
  });
  res.end(JSON.stringify({ ok: true }));
}

async function listarUsuarios(res) {
  const pool = await obterPool();
  const resultado = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(usucod)) AS codigo,
      LTRIM(RTRIM(usunome)) AS nome,
      LTRIM(RTRIM(ISNULL(usuemail, ''))) AS email,
      usuperfil AS perfil
    FROM dbo.Usuario
    ORDER BY LTRIM(RTRIM(usucod));
  `);

  enviarJson(res, 200, resultado.recordset);
}

async function salvarUsuario(req, res) {
  const dados = await lerCorpoJson(req, 32 * 1024);
  const codigoOriginal = trim(dados.codigoOriginal);
  const codigo = trim(dados.codigo);
  const nome = trim(dados.nome);
  const email = trim(dados.email);
  const senha = String(dados.senha || "");
  const perfil = Number(dados.perfil || 0);

  if (!codigo || !nome) {
    enviarJson(res, 400, { erro: "Informe usuario e nome" });
    return;
  }

  if (!codigoOriginal && !senha) {
    enviarJson(res, 400, { erro: "Informe a senha" });
    return;
  }

  const pool = await obterPool();
  const existente = await pool.request()
    .input("codigo", sql.VarChar(60), codigo)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(usucod)) AS codigo
      FROM dbo.Usuario
      WHERE LTRIM(RTRIM(usucod)) = @codigo;
    `);

  if (existente.recordset.length && (!codigoOriginal || existente.recordset[0].codigo !== codigoOriginal)) {
    enviarJson(res, 409, { erro: "Ja existe um usuario com este codigo" });
    return;
  }

  if (codigoOriginal) {
    const request = pool.request()
      .input("codigoOriginal", sql.VarChar(60), codigoOriginal)
      .input("codigo", sql.VarChar(60), codigo)
      .input("nome", sql.VarChar(60), nome)
      .input("email", sql.VarChar(120), email)
      .input("perfil", sql.Int, perfil);

    if (senha) request.input("senha", sql.VarChar(20), senha);

    const resultado = await request.query(`
      UPDATE dbo.Usuario
      SET
        usucod = @codigo,
        usunome = @nome,
        usuemail = @email,
        usuperfil = @perfil
        ${senha ? ", ususenha = @senha" : ""}
      WHERE LTRIM(RTRIM(usucod)) = @codigoOriginal;
      SELECT @@ROWCOUNT AS alteradas;
    `);

    if (!resultado.recordset[0]?.alteradas) {
      enviarJson(res, 404, { erro: "Usuario nao encontrado" });
      return;
    }

    enviarJson(res, 200, { ok: true });
    return;
  }

  await pool.request()
    .input("codigo", sql.VarChar(60), codigo)
    .input("nome", sql.VarChar(60), nome)
    .input("email", sql.VarChar(120), email)
    .input("senha", sql.VarChar(20), senha)
    .input("perfil", sql.Int, perfil)
    .query(`
      INSERT INTO dbo.Usuario (usucod, usunome, usuemail, ususenha, usuperfil)
      VALUES (@codigo, @nome, @email, @senha, @perfil);
    `);

  enviarJson(res, 201, { ok: true });
}

async function excluirUsuario(req, res, url) {
  const codigo = trim(url.searchParams.get("codigo"));

  if (!codigo) {
    enviarJson(res, 400, { erro: "Informe o usuario" });
    return;
  }

  const pool = await obterPool();
  const resultado = await pool.request()
    .input("codigo", sql.VarChar(60), codigo)
    .query(`
      DELETE FROM dbo.Usuario
      WHERE LTRIM(RTRIM(usucod)) = @codigo;
      SELECT @@ROWCOUNT AS alteradas;
    `);

  if (!resultado.recordset[0]?.alteradas) {
    enviarJson(res, 404, { erro: "Usuario nao encontrado" });
    return;
  }

  enviarJson(res, 200, { ok: true });
}

async function listarRecibos(res, url) {
  const busca = trim(url.searchParams.get("busca"));
  const ano = trim(url.searchParams.get("ano"));
  const filtroAno = dbClient === "mssql"
    ? "CONVERT(varchar(4), YEAR(ReciboRendaPeriodoDe)) = @ano"
    : "substr(ReciboRendaPeriodoDe, 1, 4) = @ano";
  const filtroNumero = dbClient === "mssql"
    ? "CAST(ReciboRendaNumero AS varchar(20)) LIKE @busca"
    : "CAST(ReciboRendaNumero AS TEXT) LIKE @busca";
  const pool = await obterPool();
  const request = pool.request()
    .input("busca", sql.VarChar(120), `%${busca}%`)
    .input("ano", sql.VarChar(4), ano);

  const resultado = await request.query(`
    SELECT TOP 300
      ReciboRendaNumero,
      ReciboRendaDataEmissao,
      LTRIM(RTRIM(ReciboRendaLocatario)) AS ReciboRendaLocatario,
      LTRIM(RTRIM(ReciboRendaLocador)) AS ReciboRendaLocador,
      LTRIM(RTRIM(ReciboRendaLocalizacao)) AS ReciboRendaLocalizacao,
      ReciboRendaPeriodoDe,
      ReciboRendaPeriodoAte,
      ReciboRendaValor,
      ReciboRendaRetencaoIRS,
      LTRIM(RTRIM(ReciboRendaTituloDe)) AS ReciboRendaTituloDe
    FROM dbo.ReciboRenda
    WHERE (
      @busca = '%%'
      OR ${filtroNumero}
      OR ReciboRendaLocatario LIKE @busca
      OR ReciboRendaLocador LIKE @busca
      OR ReciboRendaLocalizacao LIKE @busca
    )
    AND (@ano = '' OR ${filtroAno})
    ORDER BY ReciboRendaNumero DESC;
  `);

  enviarJson(res, 200, resultado.recordset.map((linha) => ({
    numero: Number(linha.ReciboRendaNumero),
    emissao: dataInput(linha.ReciboRendaDataEmissao),
    locatario: trim(linha.ReciboRendaLocatario),
    locador: trim(linha.ReciboRendaLocador),
    localizacao: trim(linha.ReciboRendaLocalizacao),
    periodoDe: dataInput(linha.ReciboRendaPeriodoDe),
    periodoAte: dataInput(linha.ReciboRendaPeriodoAte),
    valor: decimal(linha.ReciboRendaValor),
    retencao: decimal(linha.ReciboRendaRetencaoIRS),
    tituloDe: trim(linha.ReciboRendaTituloDe),
  })));
}

async function obterRecibo(numero) {
  const pool = await obterPool();
  const resultado = await pool.request()
    .input("numero", sql.Int, Number(numero))
    .query(`
      SELECT ${camposRecibo.join(", ")}
      FROM dbo.ReciboRenda
      WHERE ReciboRendaNumero = @numero;
    `);
  return resultado.recordset[0] ? normalizarRecibo(resultado.recordset[0]) : null;
}

async function detalheRecibo(res, numero) {
  const recibo = await obterRecibo(numero);
  if (!recibo) {
    enviarJson(res, 404, { erro: "Recibo nao encontrado" });
    return;
  }
  enviarJson(res, 200, recibo);
}

function prepararRecibo(dados, numeroFixo = null) {
  const recibo = {};
  for (const campo of camposRecibo) {
    if (campo === "ReciboRendaNumero") recibo[campo] = numeroFixo ?? Number(dados[campo] || 0);
    else if (camposData.has(campo)) recibo[campo] = dataInput(dados[campo]) || "1900-01-01";
    else if (camposValor.has(campo)) recibo[campo] = decimal(dados[campo]);
    else recibo[campo] = trim(dados[campo]);
  }

  for (const campo of [
    "ReciboRendaEmitente",
    "ReciboRendaLocador",
    "ReciboRendaLocatario",
    "ReciboRendaLocalizacao",
  ]) {
    if (!recibo[campo]) throw new Error("Preencha os campos obrigatorios");
  }

  return recibo;
}

async function proximoNumeroRecibo() {
  const pool = await obterPool();
  const resultado = await pool.request().query("SELECT ISNULL(MAX(ReciboRendaNumero), 0) + 1 AS numero FROM dbo.ReciboRenda;");
  return Number(resultado.recordset[0]?.numero || 1);
}

async function enviarProximoNumero(res) {
  const numero = await proximoNumeroRecibo();
  enviarJson(res, 200, { numero });
}

async function criarRecibo(req, res) {
  if (!exigirAutenticacao(req, res)) return;
  const dados = await lerCorpoJson(req);
  const numero = Number(dados.ReciboRendaNumero || 0) || await proximoNumeroRecibo();
  const existente = await obterRecibo(numero);
  if (existente) {
    enviarJson(res, 409, { erro: "Ja existe um recibo com este numero" });
    return;
  }
  const recibo = prepararRecibo(dados, numero);
  const pool = await obterPool();
  const request = pool.request();
  vincularParametrosRecibo(request, recibo);
  await request.query(`
    INSERT INTO dbo.ReciboRenda (${camposRecibo.join(", ")})
    VALUES (${camposRecibo.map((campo) => `@${campo}`).join(", ")});
  `);
  enviarJson(res, 201, { ok: true, numero });
}

async function atualizarRecibo(req, res, numero) {
  if (!exigirAutenticacao(req, res)) return;
  const dados = await lerCorpoJson(req);
  const recibo = prepararRecibo(dados, Number(numero));
  const pool = await obterPool();
  const request = pool.request();
  vincularParametrosRecibo(request, recibo);
  const camposUpdate = camposRecibo
    .filter((campo) => campo !== "ReciboRendaNumero")
    .map((campo) => `${campo} = @${campo}`)
    .join(", ");
  const resultado = await request.query(`
    UPDATE dbo.ReciboRenda
    SET ${camposUpdate}
    WHERE ReciboRendaNumero = @ReciboRendaNumero;
    SELECT @@ROWCOUNT AS alteradas;
  `);
  if (Number(resultado.recordset[0]?.alteradas || 0) === 0) {
    enviarJson(res, 404, { erro: "Recibo nao encontrado" });
    return;
  }
  enviarJson(res, 200, { ok: true, numero: Number(numero) });
}

async function excluirRecibo(req, res, numero) {
  if (!exigirAutenticacao(req, res)) return;
  const pool = await obterPool();
  const resultado = await pool.request()
    .input("numero", sql.Int, Number(numero))
    .query(`
      DELETE FROM dbo.ReciboRenda WHERE ReciboRendaNumero = @numero;
      SELECT @@ROWCOUNT AS alteradas;
    `);
  if (Number(resultado.recordset[0]?.alteradas || 0) === 0) {
    enviarJson(res, 404, { erro: "Recibo nao encontrado" });
    return;
  }
  enviarJson(res, 200, { ok: true });
}

function vincularParametrosRecibo(request, recibo) {
  for (const campo of camposRecibo) {
    if (campo === "ReciboRendaNumero") request.input(campo, sql.Int, recibo[campo]);
    else if (camposValor.has(campo)) request.input(campo, sql.Decimal(18, 2), recibo[campo]);
    else if (camposData.has(campo)) request.input(campo, sql.VarChar(10), recibo[campo]);
    else request.input(campo, sql.VarChar(220), recibo[campo]);
  }
}

async function saude(res) {
  let banco = dbConfig.database || "sqlite";
  const arquivo = dbConfig.filename || "";
  try {
    const pool = await obterPool();
    await pool.request().query("SELECT 1 AS ok;");
  } catch (err) {
    enviarJson(res, 500, { ok: false, cliente: dbClient, banco, arquivo, erro: err.message });
    return;
  }
  enviarJson(res, 200, { ok: true, cliente: dbClient, banco, arquivo, dataHora: new Date().toISOString() });
}

async function tratarApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/saude") return saude(res);
    if (req.method === "GET" && url.pathname === "/api/auth/status") {
      const token = lerCookies(req).recibosSessao;
      const sessao = token ? sessoes.get(token) : null;
      return enviarJson(res, 200, { autenticado: Boolean(sessao), usuario: sessao?.usuario, nome: sessao?.nome });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/login") return login(req, res);
    if (req.method === "POST" && url.pathname === "/api/auth/logout") return logout(req, res);
    if (url.pathname === "/api/usuarios") {
      if (!exigirAdmin(req, res)) return;
      if (req.method === "GET") return listarUsuarios(res);
      if (req.method === "POST") return salvarUsuario(req, res);
      if (req.method === "DELETE") return excluirUsuario(req, res, url);
    }
    if (url.pathname === "/api/recibos" || url.pathname.startsWith("/api/recibos/")) {
      if (!exigirAutenticacao(req, res)) return;
    }

    if (req.method === "GET" && url.pathname === "/api/recibos/proximo") return enviarProximoNumero(res);
    if (req.method === "GET" && url.pathname === "/api/recibos") return listarRecibos(res, url);
    if (req.method === "POST" && url.pathname === "/api/recibos") return criarRecibo(req, res);

    const matchRecibo = url.pathname.match(/^\/api\/recibos\/(\d+)$/);
    if (matchRecibo && req.method === "GET") return detalheRecibo(res, matchRecibo[1]);
    if (matchRecibo && req.method === "PUT") return atualizarRecibo(req, res, matchRecibo[1]);
    if (matchRecibo && req.method === "DELETE") return excluirRecibo(req, res, matchRecibo[1]);

    enviarJson(res, 404, { erro: "Rota nao encontrada" });
  } catch (err) {
    console.error(err);
    enviarJson(res, 500, { erro: "Erro ao processar a requisicao", detalhe: err.message });
  }
}

const tipos = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function servirArquivo(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  if (req.method === "GET" && pathname === "/usuarios.html" && !usuarioAdmin(req)) {
    res.writeHead(302, { Location: "./" });
    res.end();
    return;
  }

  const caminho = path.normalize(path.join(publicDir, pathname));
  if (!caminho.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Acesso negado");
    return;
  }

  fs.readFile(caminho, (err, dados) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo nao encontrado");
      return;
    }
    res.writeHead(200, { "Content-Type": tipos[path.extname(caminho).toLowerCase()] || "application/octet-stream" });
    res.end(dados);
  });
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    tratarApi(req, res, url);
    return;
  }
  servirArquivo(req, res, url);
});

servidor.listen(port, host, () => {
  console.log(`api-recibos em http://${host}:${port}`);
});
