// Robô de lançamento de atividades no NAJ.
// Uso: node robo/naj-lancar.js <entrada.json> <saida.json> [--teste] [--prints <pasta>]
// entrada.json: [{ id, cliente, clienteCod?, processo?, processoCod?, area, tipo, descricao, data (AAAA-MM-DD), inicio (HH:MM), termino (HH:MM) }]
// (disponivelCliente ainda pode vir, mas a tela nova do NAJ não tem mais essa opção e ele é ignorado)
// saida.json:   [{ id, status: "lancado"|"erro"|"teste_ok", mensagem, clienteNaj?, processoNaj?, candidatos?, print? }]
// Com --teste preenche a tela inteira mas NÃO clica em Gravar. Erros guardam um print em <prints>/<id>-erro.png.
// Teste de credencial: node robo/naj-lancar.js --testar-login <login> <VARIAVEL_DA_SENHA>
// Credenciais: NAJ_URL; por lançamento, najLogin + a variável de ambiente senhaVar com a senha (padrão: NAJ_USUARIO/NAJ_SENHA).
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const soDigitos = s => (s || '').replace(/\D/g, '');
const { ErroLogin, entrarNoNaj, espera } = require('./naj-comum');

class ErroLancamento extends Error {
  constructor(mensagem, candidatos) { super(mensagem); this.candidatos = candidatos; }
}

async function entrar(browser, cred, printErro) {
  const p = await entrarNoNaj(browser, cred, { printErro });
  await p.locator('text="Controles"').first().click();
  await espera(800);
  await p.locator('text="Atividades"').first().click();
  await p.waitForLoadState('networkidle').catch(() => {});
  await espera(4000);
  return p;
}

// Tela "Nova Atividade" (nova versão do NAJ, desde 11/2026): janela (modal) aberta pelo botão de três pontos da lista
// de atividades, com campos de id fixo. As pesquisas de cliente e processo usam a mesma consulta que a tela usa.
const MODAL = '#modal-manutencao-atividade';

async function abrirNovaAtividade(p) {
  await p.locator('button:has(i.fa-ellipsis-v)').filter({ visible: true }).first().click();
  await espera(500);
  await p.locator('span', { hasText: /^Nova Atividade$/ }).filter({ visible: true }).first().click();
  await p.waitForSelector(`${MODAL}.show #historico`, { state: 'visible', timeout: 30000 });
  // espera a tela carregar as listas (tipos de atividade e áreas jurídicas)
  await p.waitForFunction(() => document.querySelectorAll('#id_tipo_atividade option').length > 1
    && document.querySelectorAll('#id_area_juridica option').length > 1, null, { timeout: 30000 });
  await quieto(p);
}

// Consulta do NAJ (pessoas/getPessoasFilter, processos/getProcessosFilter...) com a sessão aberta.
async function consultar(p, rota, termo) {
  const t = encodeURIComponent(String(termo).replace(/[\/\\?#%]+/g, ' ').replace(/\s+/g, ' ').trim());
  const r = await p.evaluate(url => najPessoaAtividade.getData(baseURL + url), `${rota}/${t}`);
  return (r && r.data) || [];
}

async function valor(p, id) {
  return p.inputValue(`${MODAL} #${id}`);
}

// Digita um código e sai do campo: o NAJ preenche o nome (ou o processo e o cliente) ao mudar o campo.
async function preencherCodigo(p, id, v, idPreenchido) {
  const el = p.locator(`${MODAL} #${id}`);
  await el.fill(v);
  await el.press('Tab');
  await quieto(p);
  for (let i = 0; i < 50 && !(await valor(p, idPreenchido)); i++) await espera(200);
  await quieto(p);
}

async function processoPorCodigo(p, e) {
  await preencherCodigo(p, 'codigo_processo', String(e.processoCod).trim(), 'resumo_prc');
  const resumo = await valor(p, 'resumo_prc');
  if (!resumo) throw new ErroLancamento(`Código de processo ${e.processoCod} não encontrado no NAJ. Confira o código.`);
  return conferirClienteDoProcesso(p, e, resumo, `de código ${e.processoCod}`);
}

async function conferirClienteDoProcesso(p, e, resumo, qual) {
  const clienteNaj = await valor(p, 'nome_cliente');
  const clienteCodNaj = await valor(p, 'codigo_cliente');
  const outroCliente = e.clienteCod
    ? String(e.clienteCod).trim() !== clienteCodNaj
    : e.cliente && !norm(clienteNaj).includes(norm(e.cliente)) && !norm(e.cliente).includes(norm(clienteNaj));
  if (outroCliente) {
    throw new ErroLancamento(`O processo ${qual} é do cliente "${clienteNaj}", e não de "${e.cliente}". Confira o cliente ou o processo.`, [clienteNaj]);
  }
  return { clienteNaj, processoNaj: resumo };
}

async function selecionarProcesso(p, e) {
  const alvo = soDigitos(e.processo);
  const linhas = (await consultar(p, 'processos/getProcessosFilter', e.processo.trim()))
    .filter(x => soDigitos(x.numero_processo_new || x.numero_processo).includes(alvo));
  if (!linhas.length) throw new ErroLancamento(`Processo "${e.processo}" não encontrado no NAJ. Confira o número.`);
  let escolhido = linhas[0];
  if (linhas.length > 1) {
    const doCliente = linhas.filter(x => e.clienteCod ? String(x.codigo_cliente) === String(e.clienteCod).trim() : norm(x.nome_cliente).includes(norm(e.cliente)));
    if (doCliente.length !== 1) {
      throw new ErroLancamento(`Há ${linhas.length} cadastros para o processo "${e.processo}". Indique o cliente exato.`,
        linhas.map(x => `${x.nome_cliente} x ${x.nome_parte_contraria}`));
    }
    escolhido = doCliente[0];
  }
  await preencherCodigo(p, 'codigo_processo', String(escolhido.codigo), 'resumo_prc');
  const resumo = await valor(p, 'resumo_prc');
  if (!resumo) throw new ErroLancamento(`O NAJ não aceitou o processo "${e.processo}" (código ${escolhido.codigo}).`);
  return conferirClienteDoProcesso(p, e, resumo, `"${e.processo}"`);
}

async function clientePorCodigo(p, e) {
  await preencherCodigo(p, 'codigo_cliente', String(e.clienteCod).trim(), 'nome_cliente');
  const clienteNaj = await valor(p, 'nome_cliente');
  if (!clienteNaj) throw new ErroLancamento(`Cliente de código ${e.clienteCod} não encontrado no NAJ. Escolha o cliente de novo na lista.`);
  return { clienteNaj };
}

async function selecionarCliente(p, e) {
  const linhas = await consultar(p, 'pessoas/getPessoasFilter', e.cliente.trim());
  if (!linhas.length) {
    // procura sugestões palavra por palavra, da mais longa para a mais curta
    let sugestoes = [];
    for (const palavra of norm(e.cliente).split(' ').filter(w => w.length >= 4).sort((a, b) => b.length - a.length)) {
      sugestoes = await consultar(p, 'pessoas/getPessoasFilter', palavra);
      if (sugestoes.length) break;
    }
    throw new ErroLancamento(`Cliente "${e.cliente}" não encontrado no NAJ.` +
      (sugestoes.length ? ' Veja se é um destes:' : ' Confira o nome.'), sugestoes.slice(0, 20).map(c => c.nome));
  }
  const exatos = linhas.filter(c => norm(c.nome) === norm(e.cliente));
  const escolhido = linhas.length === 1 ? linhas[0] : exatos.length === 1 ? exatos[0] : null;
  if (!escolhido) {
    throw new ErroLancamento(`Encontrei ${linhas.length} clientes para "${e.cliente}". Escreva o nome completo de um deles:`,
      linhas.slice(0, 20).map(c => c.nome));
  }
  return clientePorCodigo(p, { ...e, clienteCod: escolhido.pessoa_codigo });
}

const hhmm = t => String(t).trim().slice(0, 5);
function duracao(ini, fim) {
  const m = t => { const [h, mi] = hhmm(t).split(':').map(Number); return h * 60 + mi; };
  const d = m(fim) - m(ini);
  if (d <= 0) throw new ErroLancamento('O horário de término precisa ser depois do horário de início.');
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(Math.floor(d / 60))}:${p2(d % 60)}`;
}

// Espera o servidor responder; a resposta atrasada sobrescreve campos preenchidos antes dela.
async function quieto(p) {
  await espera(300);
  for (let i = 0; i < 150 && p.pendentes > 0; i++) await espera(100);
  await espera(400);
}

// Mensagens que o NAJ mostra no canto da tela (toast) ou em caixa de alerta.
async function avisosNaj(p) {
  return p.$$eval('.toast, .toast-message, .swal2-popup, .jq-toast-single, .alert', els =>
    els.filter(x => x.offsetParent !== null).map(x => x.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5)).catch(() => []);
}

async function fecharJanela(p) {
  await p.locator(`${MODAL} button[title="Fechar"]`).first().click({ force: true }).catch(() => {});
  await espera(1500);
}

async function lancar(p, e, teste, pastaPrints) {
  for (const campo of ['cliente', 'area', 'tipo', 'descricao', 'data', 'inicio', 'termino']) {
    if (!e[campo] || !String(e[campo]).trim()) throw new ErroLancamento(`Campo obrigatório vazio: ${campo}.`);
  }
  const tempo = duracao(e.inicio, e.termino);

  await abrirNovaAtividade(p);

  // ordem de preferência: código do processo, número do processo, código do cliente, nome do cliente
  let r;
  if (e.processoCod && String(e.processoCod).trim()) r = await processoPorCodigo(p, e);
  else if (e.processo && e.processo.trim()) r = await selecionarProcesso(p, e);
  else if (e.clienteCod && String(e.clienteCod).trim()) r = await clientePorCodigo(p, e);
  else r = await selecionarCliente(p, e);
  await quieto(p);

  // tipo de atividade: lista com código e nome (o campo de texto ao lado só filtra a lista)
  const tipo = await p.evaluate(nome => {
    const n = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const op = [...document.querySelectorAll('#id_tipo_atividade option')].find(o => o.value && n(o.text) === n(nome));
    if (!op) return null;
    $('#id_tipo_atividade').val(op.value).trigger('change');
    return { cod: op.value, texto: $('#id_tipo_atividade option:selected').text() };
  }, e.tipo);
  if (!tipo) throw new ErroLancamento(`Tipo de atividade desconhecido no NAJ: "${e.tipo}".`);
  await quieto(p);

  // área jurídica: com processo escolhido, o NAJ usa a área do processo e trava o campo
  const area = p.locator(`${MODAL} #id_area_juridica`);
  let avisoArea = '';
  if (await area.isDisabled()) {
    const doProcesso = await area.evaluate(x => x.options[x.selectedIndex]?.text || '');
    if (norm(doProcesso) !== norm(e.area)) avisoArea = ` O NAJ usou a área jurídica do processo (${doProcesso}), e não ${e.area}.`;
  } else {
    const op = await area.evaluate((x, alvo) => {
      const n = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
      return [...x.options].find(o => o.value && n(o.text) === n(alvo))?.value;
    }, e.area);
    if (!op) throw new ErroLancamento(`O NAJ não tem a área jurídica "${e.area}".`);
    await area.selectOption(op);
  }

  const setor = p.locator(`${MODAL} #id_setor_atividade`);
  if (await setor.evaluate(x => x.required && !x.disabled && !x.value)) {
    throw new ErroLancamento('O NAJ passou a exigir o "Setor" da atividade, que o robô ainda não preenche. Avise o administrador.');
  }

  await p.locator(`${MODAL} #historico`).fill(e.descricao.trim());

  // data e horários: o NAJ recalcula o término quando o início muda (mantém a duração), então o início vem primeiro
  const esperado = { data: e.data, hora_inicio: hhmm(e.inicio), hora_termino: hhmm(e.termino) };
  for (let tentativa = 0; ; tentativa++) {
    for (const [id, v] of Object.entries(esperado)) {
      if ((await valor(p, id)) !== v) {
        const el = p.locator(`${MODAL} #${id}`);
        await el.fill(v);
        await el.dispatchEvent('change');
        await quieto(p);
      }
    }
    const errados = [];
    for (const [id, v] of Object.entries({ ...esperado, tempo })) if ((await valor(p, id)) !== v) errados.push(id);
    if (!errados.length) break;
    if (tentativa === 2) throw new ErroLancamento(`O NAJ não aceitou a data/horários (${errados.join(', ')}).`);
  }

  const conferido = {
    cliente: await valor(p, 'nome_cliente'), clienteCod: await valor(p, 'codigo_cliente'),
    processoCod: await valor(p, 'codigo_processo'), processo: await valor(p, 'resumo_prc'),
    tipo: tipo.texto, data: await valor(p, 'data'), inicio: await valor(p, 'hora_inicio'),
    termino: await valor(p, 'hora_termino'), tempo: await valor(p, 'tempo'),
    area: await area.evaluate(x => x.options[x.selectedIndex]?.text || ''),
  };
  if (!conferido.clienteCod) throw new ErroLancamento('O NAJ não preencheu o cliente.');
  const print = path.join(pastaPrints, `${e.id}.png`);

  if (teste) {
    await p.screenshot({ path: print });
    await fecharJanela(p);
    return { status: 'teste_ok', mensagem: `Teste: tela preenchida, não gravado. Tempo ${conferido.tempo}.${avisoArea}`, ...r, conferido, print };
  }

  // ao gravar, o NAJ mostra "Atividade cadastrada com sucesso!" e reabre a janela com a atividade já gravada (com ID)
  const resposta = p.waitForResponse(x => x.request().method() === 'POST' && /\/atividades(\?|$)/.test(x.url()), { timeout: 60000 }).catch(() => null);
  await p.locator(`${MODAL} #gravar-atividade`).click();
  const corpo = await (await resposta)?.json().catch(() => null);
  let codigo = corpo?.model?.CODIGO ? String(corpo.model.CODIGO) : '';
  for (let i = 0; i < 50 && !codigo; i++) { await espera(200); codigo = await valor(p, 'codigo_atividade').catch(() => ''); }
  const avisos = await avisosNaj(p);
  await p.screenshot({ path: print });
  if (!codigo) {
    throw new ErroLancamento(`Cliquei em Gravar, mas o NAJ não confirmou a atividade. Aviso do NAJ: ${corpo?.mensagem || avisos.join(' | ') || 'nenhum'}`);
  }
  await fecharJanela(p);
  return { status: 'lancado', mensagem: `Lançado no NAJ (código ${codigo}, tempo ${conferido.tempo}).${avisoArea}`, ...r, codigoNaj: codigo, conferido, print };
}

// Senha de cada pessoa: variável de ambiente senhaVar (padrão NAJ_SENHA, com o login NAJ_USUARIO).
function credencial(login, varSenha) {
  return { login: login || process.env.NAJ_USUARIO, senha: process.env[varSenha || 'NAJ_SENHA'] };
}

(async () => {
  // teste de credencial (ao cadastrar uma pessoa nova): node robo/naj-lancar.js --testar-login <login> <VARIAVEL_DA_SENHA>
  const iTeste = process.argv.indexOf('--testar-login');
  if (iTeste > 0) {
    const [login, varSenha] = process.argv.slice(iTeste + 1);
    const cred = credencial(login, varSenha);
    if (!cred.senha) { console.log(`A variável ${varSenha || 'NAJ_SENHA'} não existe neste ambiente.`); process.exit(1); }
    const browser = await chromium.launch();
    try {
      await (await entrar(browser, cred, 'teste-login.png')).context().close();
      console.log(`Login de ${cred.login} aceito pelo NAJ.`);
    } catch (err) {
      console.log(err instanceof ErroLogin ? err.message : `Falha técnica no teste de login: ${err.message.split('\n')[0]} (print em teste-login.png)`);
      process.exitCode = 1;
    }
    await browser.close();
    return;
  }

  const [entrada, saida] = process.argv.slice(2);
  const teste = process.argv.includes('--teste');
  const iPrints = process.argv.indexOf('--prints');
  const pastaPrints = iPrints > 0 ? process.argv[iPrints + 1] : path.dirname(path.resolve(saida));
  fs.mkdirSync(pastaPrints, { recursive: true });
  const itens = JSON.parse(fs.readFileSync(entrada, 'utf8'));
  const resultados = [];
  const browser = await chromium.launch();
  // login recusado: os outros itens da mesma pessoa recebem a mesma mensagem sem nova tentativa
  const loginsRecusados = new Map();
  let p = null;
  for (const e of itens) {
    // uma sessão nova do NAJ por lançamento, para nenhum item herdar janelas abertas do anterior
    const printErro = path.join(pastaPrints, `${e.id}-erro.png`);
    let print;
    try {
      if (e.erroConfig) throw new ErroLancamento(e.erroConfig);
      // cada pessoa lança com o próprio login do NAJ; a senha fica numa variável do ambiente (nunca no formulário)
      const cred = credencial(e.najLogin, e.senhaVar);
      if (!cred.login || !cred.senha) throw new ErroLancamento(`A senha do NAJ de ${e.najLogin || 'este usuário'} ainda não foi configurada pelo administrador.`);
      if (loginsRecusados.has(cred.login)) throw new ErroLancamento(loginsRecusados.get(cred.login));
      try {
        p = await entrar(browser, cred, printErro);
      } catch (err) {
        if (!(err instanceof ErroLogin)) throw err;
        loginsRecusados.set(cred.login, err.message);
        print = printErro;
        throw new ErroLancamento(err.message);
      }
      resultados.push({ id: e.id, ...(await lancar(p, e, teste, pastaPrints)) });
    } catch (err) {
      const mensagem = err instanceof ErroLancamento ? err.message : `Falha técnica no robô: ${err.message.split('\n')[0]}`;
      if (p) print = await p.screenshot({ path: printErro }).then(() => printErro, () => undefined);
      else if (!print && !(err instanceof ErroLancamento) && fs.existsSync(printErro)) print = printErro;
      resultados.push({ id: e.id, status: 'erro', mensagem, candidatos: err.candidatos || [], ...(print && { print }) });
    }
    if (p) { await p.context().close().catch(() => {}); p = null; }
    fs.writeFileSync(saida, JSON.stringify(resultados, null, 2));
  }
  await browser.close();
  console.log(JSON.stringify(resultados, null, 2));
})();
