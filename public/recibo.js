const campos = [
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

const form = document.querySelector("#formRecibo");
const statusEl = document.querySelector("#status");
const titulo = document.querySelector("#titulo");
const importanciaRecebida = document.querySelector("[data-importancia-recebida]");
const params = new URLSearchParams(window.location.search);
const numeroEdicao = params.get("numero");

function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

async function buscarJson(url, opcoes = {}) {
  const resposta = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opcoes.headers || {}) },
    ...opcoes,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || "Erro ao processar a requisicao");
  return dados;
}

function preencherFormulario(recibo) {
  for (const campo of campos) {
    const input = form.elements[campo];
    if (!input) continue;
    input.value = recibo[campo] ?? "";
  }
  atualizarImportanciaRecebida();
}

function lerFormulario() {
  const dados = {};
  for (const campo of campos) {
    const input = form.elements[campo];
    if (!input) continue;
    dados[campo] = input.value;
  }
  return dados;
}

async function carregarRecibo() {
  if (!numeroEdicao) {
    const hoje = new Date().toISOString().slice(0, 10);
    const proximo = await buscarJson("api/recibos/proximo");
    form.elements.ReciboRendaNumero.value = proximo.numero;
    form.elements.ReciboRendaDataEmissao.value = hoje;
    form.elements.ReciboRendaDataRecebimento.value = hoje;
    form.elements.ReciboRendaRetencaoIRS.value = "0";
    form.elements.ReciboRendaTipoContrato.value = "A";
    form.elements.ReciboRendaTipo.value = "U";
    form.elements.ReciboRendaTituloDe.value = "R";
    atualizarImportanciaRecebida();
    return;
  }

  titulo.textContent = `Editar recibo ${numeroEdicao}`;
  form.elements.ReciboRendaNumero.readOnly = true;
  const recibo = await buscarJson(`api/recibos/${encodeURIComponent(numeroEdicao)}`);
  preencherFormulario(recibo);
}

function atualizarImportanciaRecebida() {
  if (!importanciaRecebida) return;
  const valor = Number(form.elements.ReciboRendaValor.value || 0);
  const retencao = Number(form.elements.ReciboRendaRetencaoIRS.value || 0);
  const recebido = valor - retencao;
  importanciaRecebida.value = recebido.toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

form.elements.ReciboRendaValor.addEventListener("input", atualizarImportanciaRecebida);
form.elements.ReciboRendaRetencaoIRS.addEventListener("input", atualizarImportanciaRecebida);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Salvando...";

  try {
    const dados = lerFormulario();
    const metodo = numeroEdicao ? "PUT" : "POST";
    const url = numeroEdicao ? `api/recibos/${encodeURIComponent(numeroEdicao)}` : "api/recibos";
    const resultado = await buscarJson(url, {
      method: metodo,
      body: JSON.stringify(dados),
    });
    statusEl.textContent = "Recibo salvo com sucesso.";
    window.setTimeout(() => {
      window.location.href = `./?recibo=${encodeURIComponent(resultado.numero || dados.ReciboRendaNumero)}`;
    }, 500);
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

carregarRecibo().catch((err) => {
  statusEl.innerHTML = escaparHtml(err.message);
});
