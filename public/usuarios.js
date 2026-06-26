const formUsuario = document.querySelector("#formUsuario");
const listaUsuarios = document.querySelector("#listaUsuarios");
const mensagemUsuario = document.querySelector("#mensagemUsuario");
const btnNovo = document.querySelector("#btnNovo");

let usuarios = [];

async function buscarJson(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(dados.erro || "Erro ao processar a requisicao");
  }

  return dados;
}

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mostrarMensagem(texto, tipo = "") {
  mensagemUsuario.textContent = texto;
  mensagemUsuario.dataset.tipo = tipo;
}

function limparFormulario() {
  formUsuario.reset();
  formUsuario.codigoOriginal.value = "";
  formUsuario.perfil.value = "0";
  mostrarMensagem("");
}

function editarUsuario(codigo) {
  const usuario = usuarios.find((item) => item.codigo === codigo);
  if (!usuario) return;

  formUsuario.codigoOriginal.value = usuario.codigo;
  formUsuario.codigo.value = usuario.codigo;
  formUsuario.nome.value = usuario.nome || "";
  formUsuario.email.value = usuario.email || "";
  formUsuario.senha.value = "";
  formUsuario.perfil.value = usuario.perfil ?? 0;
  mostrarMensagem("Senha atual protegida. Preencha apenas se quiser trocar.", "ok");
  formUsuario.nome.focus();
}

function renderizarUsuarios() {
  if (!usuarios.length) {
    listaUsuarios.innerHTML = '<p class="muted">Nenhum usuario cadastrado.</p>';
    return;
  }

  listaUsuarios.innerHTML = usuarios.map((usuario) => `
    <div class="user-card">
      <strong>${escaparHtml(usuario.codigo)}</strong>
      <span>${escaparHtml(usuario.nome || "")}</span>
      <span>${escaparHtml(usuario.email || "")}</span>
      <span>********</span>
      <em>Perfil ${escaparHtml(usuario.perfil ?? 0)}</em>
      <div class="user-card-actions">
        <button type="button" class="secondary-button" data-editar="${escaparHtml(usuario.codigo)}">
          <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
          Editar
        </button>
        <button type="button" class="danger-button" data-excluir="${escaparHtml(usuario.codigo)}">
          <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>
          Excluir
        </button>
      </div>
    </div>
  `).join("");

  listaUsuarios.querySelectorAll("[data-editar]").forEach((botao) => {
    botao.addEventListener("click", () => editarUsuario(botao.dataset.editar));
  });

  listaUsuarios.querySelectorAll("[data-excluir]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const codigo = botao.dataset.excluir;
      if (!confirm(`Excluir o usuario ${codigo}?`)) return;

      try {
        await buscarJson(`api/usuarios?codigo=${encodeURIComponent(codigo)}`, { method: "DELETE" });
        if (formUsuario.codigoOriginal.value === codigo) limparFormulario();
        mostrarMensagem("Usuario excluido com sucesso.", "ok");
        await carregarUsuarios();
      } catch (err) {
        mostrarMensagem(err.message, "erro");
      }
    });
  });
}

async function carregarUsuarios() {
  usuarios = await buscarJson("api/usuarios");
  renderizarUsuarios();
}

formUsuario.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostrarMensagem("Salvando usuario...");

  try {
    const dados = new FormData(formUsuario);
    await buscarJson("api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigoOriginal: dados.get("codigoOriginal"),
        codigo: dados.get("codigo"),
        nome: dados.get("nome"),
        email: dados.get("email"),
        senha: dados.get("senha"),
        perfil: dados.get("perfil"),
      }),
    });

    limparFormulario();
    mostrarMensagem("Usuario salvo com sucesso.", "ok");
    await carregarUsuarios();
  } catch (err) {
    mostrarMensagem(err.message, "erro");
  }
});

btnNovo.addEventListener("click", limparFormulario);

carregarUsuarios().catch((err) => mostrarMensagem(err.message, "erro"));
