const estado = {
  autenticado: false,
  recibos: [],
  selecionado: null,
  pagina: 1,
  porPagina: 10,
};

let reciboInicial = new URLSearchParams(window.location.search).get("recibo");

const els = {
  busca: document.querySelector("#busca"),
  ano: document.querySelector("#ano"),
  buscar: document.querySelector("#buscar"),
  limpar: document.querySelector("#limpar"),
  lista: document.querySelector("#lista"),
  detalhe: document.querySelector("#detalhe"),
  login: document.querySelector("#login"),
  logout: document.querySelector("#logout"),
  novo: document.querySelector("#novo"),
  loginDialog: document.querySelector("#loginDialog"),
  loginForm: document.querySelector("#loginForm"),
  usuario: document.querySelector("#usuario"),
  senha: document.querySelector("#senha"),
  loginStatus: document.querySelector("#loginStatus"),
};

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatarData(valor) {
  if (!valor) return "";
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(valor);
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

function formatarValorEuro(valor) {
  return Number(valor || 0).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function numeroRecibo(valor) {
  return String(Number(valor || 0)).padStart(10, "0");
}

const icones = {
  editar: '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
  imprimir: '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5"></path><path d="M7 17H5a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2"></path><path d="M7 14h10v7H7z"></path><path d="M17 11h.01"></path></svg>',
  excluir: '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
};

async function buscarJson(url, opcoes = {}) {
  const resposta = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opcoes.headers || {}) },
    ...opcoes,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || "Erro ao processar a requisicao");
  return dados;
}

async function enviarJson(url, dados, metodo = "POST") {
  return buscarJson(url, {
    method: metodo,
    body: JSON.stringify(dados),
  });
}

function renderizarAuth() {
  els.login.hidden = estado.autenticado;
  els.logout.hidden = !estado.autenticado;
  els.novo.hidden = !estado.autenticado;
  document.body.classList.toggle("auth-locked", !estado.autenticado);
}

function abrirLoginObrigatorio() {
  els.loginStatus.textContent = "";
  els.senha.value = "";
  if (!els.loginDialog.open) els.loginDialog.showModal();
  els.usuario.focus();
}

function bloquearAteLogin() {
  estado.recibos = [];
  estado.selecionado = null;
  estado.pagina = 1;
  els.lista.innerHTML = "";
  els.detalhe.innerHTML = '<div class="empty-state"><h2>Login necessario</h2><p>Informe usuario e senha para acessar os recibos.</p></div>';
  abrirLoginObrigatorio();
}

function renderizarLista() {
  if (estado.recibos.length === 0) {
    els.lista.innerHTML = '<p class="muted">Nenhum recibo encontrado.</p>';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(estado.recibos.length / estado.porPagina));
  estado.pagina = Math.min(Math.max(estado.pagina, 1), totalPaginas);
  const inicio = (estado.pagina - 1) * estado.porPagina;
  const pagina = estado.recibos.slice(inicio, inicio + estado.porPagina);

  els.lista.innerHTML = `
    ${pagina.map((recibo) => `
    <button type="button" class="receipt-item ${estado.selecionado === recibo.numero ? "active" : ""}" data-numero="${recibo.numero}">
      <strong>${escaparHtml(recibo.numero)}</strong>
      <span class="receipt-name">${escaparHtml(recibo.locatario)}</span>
      <span class="receipt-period">${escaparHtml(formatarData(recibo.periodoDe))} a ${escaparHtml(formatarData(recibo.periodoAte))}</span>
      <em>${escaparHtml(formatarMoeda(recibo.valor))}</em>
    </button>
    `).join("")}
    <div class="pager">
      <button type="button" class="secondary-button pager-prev" ${estado.pagina === 1 ? "disabled" : ""}>Anterior</button>
      <span>${estado.pagina} / ${totalPaginas}</span>
      <button type="button" class="secondary-button pager-next" ${estado.pagina === totalPaginas ? "disabled" : ""}>Proxima</button>
    </div>
  `;

  els.lista.querySelectorAll(".receipt-item").forEach((botao) => {
    botao.addEventListener("click", () => carregarDetalhe(botao.dataset.numero));
  });
  els.lista.querySelector(".pager-prev")?.addEventListener("click", () => {
    estado.pagina -= 1;
    renderizarLista();
  });
  els.lista.querySelector(".pager-next")?.addEventListener("click", () => {
    estado.pagina += 1;
    renderizarLista();
  });
}

function resumoTipo(codigo, mapa) {
  const valor = String(codigo || "").trim();
  return valor ? `${valor} - ${mapa[valor] || "Nao identificado"}` : "";
}

function renderizarDetalhe(recibo) {
  estado.selecionado = recibo.ReciboRendaNumero;
  renderizarLista();

  els.detalhe.innerHTML = `
    <section class="receipt-detail">
      <div class="receipt-head">
        <div>
          <p class="eyebrow">RECIBO ${escaparHtml(recibo.ReciboRendaNumero)}</p>
          <h2>${escaparHtml(recibo.ReciboRendaLocatario)}</h2>
          <p>${escaparHtml(recibo.ReciboRendaLocalizacao)}</p>
        </div>
        <div class="detail-actions">
          <a class="secondary-button" href="recibo.html?numero=${encodeURIComponent(recibo.ReciboRendaNumero)}">${icones.editar} Editar</a>
          <button type="button" class="secondary-button" id="imprimir">${icones.imprimir} Imprimir</button>
          <button type="button" class="danger-button" id="excluir">${icones.excluir} Excluir</button>
        </div>
      </div>
      <div class="amount-panel">
        <span>Valor recebido</span>
        <strong>${escaparHtml(formatarMoeda(recibo.ReciboRendaValor))}</strong>
        <small>Retencao IRS: ${escaparHtml(formatarMoeda(recibo.ReciboRendaRetencaoIRS))}</small>
      </div>
      <div class="info-grid">
        <div><span>Emissao</span><strong>${escaparHtml(formatarData(recibo.ReciboRendaDataEmissao))}</strong></div>
        <div><span>Recebimento</span><strong>${escaparHtml(formatarData(recibo.ReciboRendaDataRecebimento))}</strong></div>
        <div><span>Periodo</span><strong>${escaparHtml(formatarData(recibo.ReciboRendaPeriodoDe))} a ${escaparHtml(formatarData(recibo.ReciboRendaPeriodoAte))}</strong></div>
        <div><span>Titulo de</span><strong>${escaparHtml(resumoTipo(recibo.ReciboRendaTituloDe, { C: "Contrato", R: "Renda" }))}</strong></div>
      </div>
      <div class="section-block">
        <h3>Partes</h3>
        <dl class="definition-list">
          <dt>Emitente</dt><dd>${escaparHtml(recibo.ReciboRendaEmitente)} - ${escaparHtml(recibo.ReciboRendaEmitenteNIF)}</dd>
          <dt>Locador</dt><dd>${escaparHtml(recibo.ReciboRendaLocador)} - ${escaparHtml(recibo.ReciboRendaLocadorNIF)}</dd>
          <dt>Sub locador</dt><dd>${escaparHtml(recibo.ReciboRendaSubLocador)} ${recibo.ReciboRendaSubLocadorNIF ? `- ${escaparHtml(recibo.ReciboRendaSubLocadorNIF)}` : ""}</dd>
          <dt>Locatario</dt><dd>${escaparHtml(recibo.ReciboRendaLocatario)} - ${escaparHtml(recibo.ReciboRendaLocatarioNIF)}</dd>
          <dt>Sub locatario</dt><dd>${escaparHtml(recibo.ReciboRendaSubLocatario)} ${recibo.ReciboRendaSubLocatarioNIF ? `- ${escaparHtml(recibo.ReciboRendaSubLocatarioNIF)}` : ""}</dd>
        </dl>
      </div>
      <div class="section-block">
        <h3>Imovel</h3>
        <dl class="definition-list">
          <dt>Tipo contrato</dt><dd>${escaparHtml(recibo.ReciboRendaTipoContrato)}</dd>
          <dt>Freguesia</dt><dd>${escaparHtml(recibo.ReciboRendaFreguesia)}</dd>
          <dt>Tipo</dt><dd>${escaparHtml(recibo.ReciboRendaTipo)}</dd>
          <dt>Artigo / fracao</dt><dd>${escaparHtml(recibo.ReciboRendaArtigo)} / ${escaparHtml(recibo.ReciboRendaFracao)}</dd>
          <dt>Complemento</dt><dd>${escaparHtml(recibo.ReciboRendaInfComplementar)}</dd>
        </dl>
      </div>
    </section>
  `;

  document.querySelector("#imprimir").addEventListener("click", () => imprimirRecibo(recibo));
  document.querySelector("#excluir").addEventListener("click", () => excluirRecibo(recibo));
  els.detalhe.focus({ preventScroll: true });
}

async function carregarDetalhe(numero) {
  if (!estado.autenticado) return;
  const recibo = await buscarJson(`api/recibos/${encodeURIComponent(numero)}`);
  renderizarDetalhe(recibo);
}

async function carregarLista() {
  if (!estado.autenticado) return;
  const params = new URLSearchParams();
  if (els.busca.value.trim()) params.set("busca", els.busca.value.trim());
  if (els.ano.value.trim()) params.set("ano", els.ano.value.trim());
  estado.recibos = await buscarJson(`api/recibos?${params.toString()}`);
  estado.pagina = 1;
  renderizarLista();
  if (reciboInicial) {
    const numero = reciboInicial;
    reciboInicial = "";
    await carregarDetalhe(numero).catch(() => {});
  }
}

async function carregarAuth() {
  const status = await buscarJson("api/auth/status");
  estado.autenticado = status.autenticado;
  renderizarAuth();
  if (!estado.autenticado) bloquearAteLogin();
  else if (!estado.selecionado) {
    els.detalhe.innerHTML = '<div class="empty-state"><h2>Selecione um recibo</h2><p>Use a pesquisa ao lado para encontrar um recibo do acervo.</p></div>';
  }
}

async function excluirRecibo(recibo) {
  if (!confirm(`Excluir o recibo ${recibo.ReciboRendaNumero}?`)) return;
  await buscarJson(`api/recibos/${encodeURIComponent(recibo.ReciboRendaNumero)}`, { method: "DELETE" });
  estado.selecionado = null;
  els.detalhe.innerHTML = '<div class="empty-state"><h2>Recibo excluido</h2><p>Selecione outro recibo para visualizar.</p></div>';
  await carregarLista();
}

function imprimirRecibo(recibo) {
  const janela = window.open("", "_blank", "width=820,height=900");
  if (!janela) return;

  const tipoContrato = String(recibo.ReciboRendaTipoContrato || "").trim().toUpperCase();
  const tipoImovel = String(recibo.ReciboRendaTipo || "").trim().toUpperCase();
  const tituloDe = String(recibo.ReciboRendaTituloDe || "").trim().toUpperCase();
  const importanciaRecebida = Number(recibo.ReciboRendaValor || 0) - Number(recibo.ReciboRendaRetencaoIRS || 0);
  const checkbox = (marcado) => `<span class="box">${marcado ? "X" : ""}</span>`;
  const opcao = (texto, marcado) => `<span class="print-option"><span>${texto}</span>${checkbox(marcado)}</span>`;

  janela.document.write(`
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>Recibo ${escaparHtml(recibo.ReciboRendaNumero)}</title>
      <style>
        @page { size: A4 portrait; margin: 8mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.25; }
        .paper { width: 100%; min-height: 280mm; border: 1px solid #cfcfcf; padding: 5px 7px 18px; }
        .top { display: grid; grid-template-columns: 250px 1fr 120px; gap: 12px; align-items: start; }
        .company { line-height: 1.35; }
        .title { text-align: center; padding-top: 14px; }
        .title h1 { margin: 0 0 16px; font-size: 20px; font-weight: 400; }
        .title-row { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 12px; align-items: center; white-space: nowrap; }
        .copy { padding-top: 16px; font-size: 14px; }
        .bar { margin-top: 10px; padding: 5px 6px; background: #cfcfcf; font-weight: 700; font-size: 12px; text-transform: uppercase; }
        .grid { display: grid; gap: 6px; padding: 7px 6px; }
        .two { grid-template-columns: 1fr 120px; }
        .four { grid-template-columns: 1.2fr 120px 150px 80px; }
        .contract { grid-template-columns: 1fr 1.25fr; gap: 18px; }
        .rent { grid-template-columns: 1.2fr 90px 20px 90px 1fr 90px 18px; align-items: center; }
        .label { font-size: 10px; font-weight: 400; text-transform: uppercase; }
        .value { font-weight: 700; min-height: 16px; }
        .right { text-align: right; }
        .box { display: inline-grid; place-items: center; width: 20px; height: 20px; border: 1px solid #333; margin: 0; font-weight: 700; vertical-align: middle; }
        .option-line { margin: 8px 0; }
        .option-line.tight { display: flex; align-items: center; gap: 14px; }
        .print-options { display: flex; align-items: center; gap: 24px; white-space: nowrap; }
        .print-option { display: inline-flex; align-items: center; gap: 6px; }
        .small { font-size: 10px; }
        .info { min-height: 34px; padding: 8px 6px; }
        .signature-row { display: grid; grid-template-columns: 325px 1fr; align-items: end; gap: 4px; margin-top: 28px; padding-left: 66px; }
        .signature-box { height: 50px; border: 1px solid #555; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="paper">
        <div class="top">
          <div class="company">
            <strong>${escaparHtml(recibo.ReciboRendaEmitente)}</strong><br>
            NIPC ${escaparHtml(recibo.ReciboRendaEmitenteNIF)}<br>
            Rua Professor Bernardino Almeida Ferro 3 - 3&ordm; Dt&ordm;<br>
            2005-164 Santar&eacute;m, Portugal<br>
            M: +351 939 498 574<br>
            paulo.grunwald@outlook.com
          </div>
          <div class="title">
            <h1>Recibo de Renda Eletr&oacute;nico</h1>
            <div class="title-row">
              <span>RECIBO DE RENDA N.&ordm;</span>
              <strong>${escaparHtml(numeroRecibo(recibo.ReciboRendaNumero))}</strong>
              <span>DATA DE EMISS&Atilde;O</span>
              <strong>${escaparHtml(recibo.ReciboRendaDataEmissao)}</strong>
            </div>
          </div>
          <div class="copy">Original</div>
        </div>

        <div class="bar">Emitente</div>
        <div class="grid two">
          <div class="label">Nome</div><div class="label">NIF</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaEmitente)}</div><div class="value">${escaparHtml(recibo.ReciboRendaEmitenteNIF)}</div>
        </div>

        <div class="bar">Locador/Sublocador (Senhorio) Cedente</div>
        <div class="grid two">
          <div class="label">Nome</div><div class="label">NIF</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaLocador)}</div><div class="value">${escaparHtml(recibo.ReciboRendaLocadorNIF)}</div>
        </div>

        <div class="bar">Locat&aacute;rio/Sublocat&aacute;rio (Inquilino) Cession&aacute;rio</div>
        <div class="grid four">
          <div class="label">Nome</div><div class="label">NIF</div><div class="label">NIF Estrangeiro/Outro Doc. Identifica&ccedil;&atilde;o</div><div class="label">Pa&iacute;s</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaLocatario)}</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaLocatarioNIF)}</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaLocatarioNIFEstrangeiro)}</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaLocatarioNIFPais)}</div>
        </div>

        <div class="grid contract">
          <div>
            <div class="bar">Tipo de Contrato</div>
            <div class="option-line tight">
              ${opcao("Arrendamento", tipoContrato === "A")}
              ${opcao("Subarrendamento", tipoContrato === "S")}
            </div>
            <div class="option-line">${opcao("Ced&ecirc;ncia de uso do pr&eacute;dio ou parte dele, que n&atilde;o arrendamento", tipoContrato === "C")}</div>
            <div class="option-line">${opcao("Aluguer de maquinismos e mobili&aacute;rio instalados no im&oacute;vel locado", tipoContrato === "M")}</div>
          </div>
          <div>
            <div class="bar">Identifica&ccedil;&atilde;o do Im&oacute;vel</div>
            <div class="grid four">
              <div class="label">Freguesia</div><div class="label">Tipo</div><div class="label">Artigo</div><div class="label">Fra&ccedil;&atilde;o/Parte</div>
              <div class="value">${escaparHtml(recibo.ReciboRendaFreguesia)}</div>
              <div class="value">${escaparHtml(tipoImovel === "U" ? "Urbano" : recibo.ReciboRendaTipo)}</div>
              <div class="value">${escaparHtml(recibo.ReciboRendaArtigo)}</div>
              <div class="value">${escaparHtml(recibo.ReciboRendaFracao)}</div>
            </div>
            <div class="label">Localiza&ccedil;&atilde;o/Morada</div>
            <div class="value">${escaparHtml(recibo.ReciboRendaLocalizacao)}</div>
          </div>
        </div>

        <div class="bar">Renda</div>
        <div class="grid rent">
          <div>Per&iacute;odo a que respeita a renda</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaPeriodoDe)}</div>
          <div>a</div>
          <div class="value">${escaparHtml(recibo.ReciboRendaPeriodoAte)}</div>
          <div class="right">Valor</div>
          <div class="value right">${escaparHtml(formatarValorEuro(recibo.ReciboRendaValor))}</div>
          <div>&euro;</div>
          <div></div><div></div><div></div><div></div>
          <div class="right small">Reten&ccedil;&atilde;o de IRS (Sem reten&ccedil;&atilde;o - artigo 101.&ordm;, n.&ordm; 1, do CIRS)</div>
          <div class="value right">${escaparHtml(formatarValorEuro(recibo.ReciboRendaRetencaoIRS))}</div>
          <div>&euro;</div>
          <div>IMPORT&Acirc;NCIA RECEBIDA A T&Iacute;TULO DE:</div>
          <div class="print-options" style="grid-column: span 3;">
            ${opcao("Renda", tituloDe === "R")}
            ${opcao("Cau&ccedil;&atilde;o", tituloDe === "C")}
            ${opcao("Adiantamento", tituloDe === "A")}
          </div>
          <div class="right">Import&acirc;ncia Recebida</div>
          <div class="value right">${escaparHtml(formatarValorEuro(importanciaRecebida))}</div>
          <div>&euro;</div>
        </div>
        <div class="grid two">
          <div>Data de recebimento: <strong>${escaparHtml(recibo.ReciboRendaDataRecebimento)}</strong></div>
          <div></div>
        </div>

        <div class="bar">Informa&ccedil;&otilde;es Complementares</div>
        <div class="info">${escaparHtml(recibo.ReciboRendaInfComplementar)}</div>
        <div class="signature-row">
          <div>Assinatura do Locador/Sublocador (Senhorio)/Cedente:</div>
          <div class="signature-box"></div>
        </div>
      </div>
      <script>window.print();<\/script>
    </body>
    </html>
  `);
  janela.document.close();
}

els.buscar.addEventListener("click", carregarLista);
els.limpar.addEventListener("click", () => {
  els.busca.value = "";
  els.ano.value = "";
  carregarLista();
});
els.busca.addEventListener("keydown", (event) => {
  if (event.key === "Enter") carregarLista();
});
els.ano.addEventListener("keydown", (event) => {
  if (event.key === "Enter") carregarLista();
});
els.login.addEventListener("click", abrirLoginObrigatorio);
els.loginDialog.addEventListener("cancel", (event) => {
  if (!estado.autenticado) event.preventDefault();
});
els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginStatus.textContent = "Entrando...";
  try {
    await enviarJson("api/auth/login", { usuario: els.usuario.value, senha: els.senha.value });
    els.loginDialog.close();
    await carregarAuth();
    await carregarLista();
  } catch (err) {
    els.loginStatus.textContent = err.message;
  }
});
els.logout.addEventListener("click", async () => {
  await enviarJson("api/auth/logout", {});
  await carregarAuth();
});

carregarAuth()
  .then(() => {
    if (estado.autenticado) return carregarLista();
    return null;
  })
  .catch((err) => {
    els.lista.innerHTML = `<p class="muted">${escaparHtml(err.message)}</p>`;
  });
