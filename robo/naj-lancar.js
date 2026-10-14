// Robô de lançamento de atividades no NAJ.
// Uso: node robo/naj-lancar.js <entrada.json> <saida.json> [--teste] [--prints <pasta>]
// entrada.json: [{ id, cliente, clienteCod?, processo?, processoCod?, area, tipo, descricao, data (AAAA-MM-DD), inicio (HH:MM), termino (HH:MM), disponivelCliente }]
// saida.json:   [{ id, status: "lancado"|"erro"|"teste_ok", mensagem, clienteNaj?, processoNaj?, candidatos?, print? }]
// Com --teste preenche a tela inteira mas NÃO clica em Gravar.
// Credenciais: variáveis de ambiente NAJ_URL, NAJ_USUARIO, NAJ_SENHA.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const TIPOS = { 'CONTRATOS FIXOS': '100', 'PROPOSTA FECHADA': '200', 'HORAS ADMINISTRATIVAS (MKS)': '300' };
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const soDigitos = s => (s || '').replace(/\D/g, '');
const espera = ms => new Promise(r => setTimeout(r, ms));

class ErroLancamento extends Error {
  constructor(mensagem, candidatos) { super(mensagem); this.candidatos = candidatos; }
}

async function entrar(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  // conta requisições em andamento: o NAJ responde a cada campo com uma chamada ao servidor
  p.pendentes = 0;
  p.on('request', () => p.pendentes++);
  p.on('requestfinished', () => p.pendentes--);
  p.on('requestfailed', () => p.pendentes--);
  await p.goto(process.env.NAJ_URL, { waitUntil: 'networkidle' });
  await p.fill('#login', process.env.NAJ_USUARIO);
  await p.fill('#password', process.env.NAJ_SENHA);
  await p.click('button:has-text("Entrar")');
  await p.waitForSelector('button.button-acessar-adv');
  await espera(500);
  await p.click('button.button-acessar-adv');
  await p.waitForURL(/najgestaoweb/, { timeout: 30000 });
  await p.waitForLoadState('networkidle').catch(() => {});
  await espera(3000);
  const ok = p.locator('button:visible:has-text("OK")');
  if (await ok.count()) await ok.first().click();
  await p.fill('#txtsenha', process.env.NAJ_SENHA);
  await p.click('#btentrar');
  await p.waitForLoadState('networkidle').catch(() => {});
  await espera(5000);
  await p.locator('text="Controles"').first().click();
  await espera(800);
  await p.locator('text="Atividades"').first().click();
  await p.waitForLoadState('networkidle').catch(() => {});
  await espera(4000);
  return p;
}

// Linhas visíveis da janela de pesquisa aberta (cada linha = textos das células).
async function linhasResultado(p, colunas) {
  return p.$$eval('[id^=RGJANELA] tr', (trs, n) => trs
    .filter(t => t.offsetParent !== null && t.querySelector('a[title^="Clique aqui"]'))
    .map(t => [...t.cells].map(c => c.innerText.trim()))
    .filter(c => c.length === n && c[0]), colunas);
}

async function clicarLinha(p, texto) {
  await p.locator('[id^=RGJANELA] tr', { hasText: texto }).filter({ visible: true }).first()
    .locator('a[title^="Clique aqui"]').first().click({ force: true });
  await espera(4000);
}

// Campo cujo id é o prefixo seguido só de dígitos (EDCLIENTE123, e não EDCLIENTECOD123).
function campo(p, prefixo) {
  return p.locator(`[id^=${prefixo}]`).filter({ visible: true })
    .filter({ has: p.locator('xpath=self::*') }).and(p.locator(`xpath=//*[translate(substring(@id, ${prefixo.length + 1}), '0123456789', '') = '' and starts-with(@id, '${prefixo}')]`)).first();
}

async function valor(p, prefixo) {
  return campo(p, prefixo).inputValue();
}

async function selecionarProcesso(p, e) {
  await p.locator('img[id^=IMMENUINFOPROCESSO]').first().click();
  await espera(2500);
  await p.locator('img[id^=IMCODIGOPROCESSO]').click();
  await espera(3000);
  await p.fill('#TIWEDIT14', e.processo.trim());
  await p.click('#TIWGRADBUTTON8');
  await espera(4000);
  // colunas: código | cliente | parte contrária | informações (número, comarca, classe)
  const linhas = await linhasResultado(p, 4);
  const alvo = soDigitos(e.processo);
  const achados = linhas.filter(c => soDigitos(c[3]).includes(alvo));
  if (!achados.length) {
    throw new ErroLancamento(`Processo "${e.processo}" não encontrado no NAJ. Confira o número.`);
  }
  let escolhido = achados[0];
  if (achados.length > 1) {
    const doCliente = achados.filter(c => norm(c[1]).includes(norm(e.cliente)));
    if (doCliente.length !== 1) {
      throw new ErroLancamento(`Há ${achados.length} cadastros para o processo "${e.processo}". Indique o cliente exato.`,
        achados.map(c => `${c[1]} x ${c[2]}`));
    }
    escolhido = doCliente[0];
  }
  await clicarLinha(p, escolhido[3].split('\n')[0]);
  const clienteNaj = await valor(p, 'EDCLIENTE');
  if (e.cliente && !norm(clienteNaj).includes(norm(e.cliente)) && !norm(e.cliente).includes(norm(clienteNaj))) {
    throw new ErroLancamento(`O processo "${e.processo}" é do cliente "${clienteNaj}", e não de "${e.cliente}". Confira o cliente ou o número do processo.`,
      [clienteNaj]);
  }
  return { clienteNaj, processoNaj: `${escolhido[1]} x ${escolhido[2]} - ${escolhido[3].replace(/\n/g, ' / ')}` };
}

// Processo pelo código de cadastro no NAJ: digitado direto no campo "Código do Processo".
async function processoPorCodigo(p, e) {
  await p.locator('img[id^=IMMENUINFOPROCESSO]').first().click();
  await quieto(p);
  await preencherCampo(p, 'EDCODIGOPROCESSO', String(e.processoCod).trim());
  const numero = await valor(p, 'EDNUMEROPROCESSO');
  const contraria = await valor(p, 'EDPARTECONTRARIA');
  const classe = await valor(p, 'EDCLASSE');
  if (!numero && !contraria && !classe) {
    throw new ErroLancamento(`Código de processo ${e.processoCod} não encontrado no NAJ. Confira o código.`);
  }
  // com o cliente vazio o NAJ costuma trazer o cliente do processo; se não trouxer, preenchemos
  if (!(await valor(p, 'EDCLIENTE'))) {
    if (e.clienteCod) await preencherCampo(p, 'EDCLIENTECOD', String(e.clienteCod));
    else await selecionarCliente(p, e);
  }
  const clienteNaj = await valor(p, 'EDCLIENTE');
  const clienteCodNaj = await valor(p, 'EDCLIENTECOD');
  const outroCliente = e.clienteCod
    ? String(e.clienteCod) !== clienteCodNaj
    : e.cliente && !norm(clienteNaj).includes(norm(e.cliente)) && !norm(e.cliente).includes(norm(clienteNaj));
  if (outroCliente) {
    throw new ErroLancamento(`O processo de código ${e.processoCod} é do cliente "${clienteNaj}", e não de "${e.cliente}". Confira o cliente ou o código do processo.`, [clienteNaj]);
  }
  return { clienteNaj, processoNaj: `${clienteNaj} x ${contraria}${numero ? ' - ' + numero : ''}${classe ? ' / ' + classe : ''}` };
}

// Cliente pelo código de cadastro no NAJ: digitado direto no campo de código do cliente.
async function clientePorCodigo(p, e) {
  await preencherCampo(p, 'EDCLIENTECOD', String(e.clienteCod).trim());
  const clienteNaj = await valor(p, 'EDCLIENTE');
  if (!clienteNaj) throw new ErroLancamento(`Cliente de código ${e.clienteCod} não encontrado no NAJ. Escolha o cliente de novo na lista.`);
  return { clienteNaj };
}

async function pesquisarCliente(p, termo) {
  await p.fill('#TIWEDIT8', termo);
  await p.click('#TIWGRADBUTTON7');
  await espera(4000);
  return linhasResultado(p, 3); // código | nome | CPF/CNPJ
}

async function selecionarCliente(p, e) {
  await p.locator('img[id^=IMCLIENTECNS]').click();
  await espera(3000);
  let linhas = await pesquisarCliente(p, e.cliente.trim());
  if (!linhas.length) {
    // procura sugestões palavra por palavra, da mais longa para a mais curta
    let sugestoes = [];
    for (const palavra of norm(e.cliente).split(' ').filter(w => w.length >= 4).sort((a, b) => b.length - a.length)) {
      sugestoes = await pesquisarCliente(p, palavra);
      if (sugestoes.length) break;
    }
    throw new ErroLancamento(`Cliente "${e.cliente}" não encontrado no NAJ.` +
      (sugestoes.length ? ' Veja se é um destes:' : ' Confira o nome.'), sugestoes.map(c => c[1]));
  }
  let escolhido = linhas.length === 1 ? linhas[0] : linhas.find(c => norm(c[1]) === norm(e.cliente));
  if (!escolhido) {
    throw new ErroLancamento(`Encontrei ${linhas.length} clientes para "${e.cliente}". Escreva o nome completo de um deles:`,
      linhas.map(c => c[1]));
  }
  await clicarLinha(p, escolhido[2] || escolhido[1]);
  return { clienteNaj: await valor(p, 'EDCLIENTE') };
}

function dataBR(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
function hms(hhmm) { return hhmm.length === 5 ? hhmm + ':00' : hhmm; }
function duracao(ini, fim) {
  const s = t => { const [h, m, x] = hms(t).split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
  const d = s(fim) - s(ini);
  if (d <= 0) throw new ErroLancamento('O horário de término precisa ser depois do horário de início.');
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(Math.floor(d / 3600))}:${p2(Math.floor(d % 3600 / 60))}:${p2(d % 60)}`;
}

// Espera o servidor responder; a resposta atrasada sobrescreve campos preenchidos antes dela.
async function quieto(p) {
  await espera(300);
  for (let i = 0; i < 150 && p.pendentes > 0; i++) await espera(100);
  await espera(400);
}

async function preencherCampo(p, prefixo, v) {
  const el = campo(p, prefixo);
  await el.fill(v);
  await el.press('Tab');
  await quieto(p);
}

async function lancar(p, e, teste, pastaPrints) {
  for (const campo of ['cliente', 'area', 'tipo', 'descricao', 'data', 'inicio', 'termino']) {
    if (!e[campo] || !String(e[campo]).trim()) throw new ErroLancamento(`Campo obrigatório vazio: ${campo}.`);
  }
  const codTipo = TIPOS[e.tipo];
  if (!codTipo) throw new ErroLancamento(`Tipo de atividade desconhecido: "${e.tipo}".`);
  const tempo = duracao(e.inicio, e.termino);

  await p.locator('text="Nova Atividade"').first().click();
  await espera(4000);

  // ordem de preferência: código do processo, número do processo, código do cliente, nome do cliente
  let r;
  if (e.processoCod && String(e.processoCod).trim()) r = await processoPorCodigo(p, e);
  else if (e.processo && e.processo.trim()) r = await selecionarProcesso(p, e);
  else if (e.clienteCod && String(e.clienteCod).trim()) r = await clientePorCodigo(p, e);
  else r = await selecionarCliente(p, e);

  await p.locator('select[id^=CBAREAJURIDICA]').selectOption({ label: e.area });
  await espera(2000);
  await preencherCampo(p, 'EDTIPOATIVIDADECOD', codTipo);
  if (norm(await valor(p, 'EDTIPOATIVIDADE')) !== norm(e.tipo)) throw new ErroLancamento('O NAJ não aceitou o tipo de atividade.');
  await p.locator('textarea[id^=MMDESCRICAO]').fill(e.descricao.trim());
  // a caixa vem antes dos horários: clicar nela recarrega a janela e pode desfazer o término
  const ck = p.locator('input[id^=CKDISPONIVELCLIENTE]').filter({ visible: true }).first();
  if ((await ck.isChecked()) !== (e.disponivelCliente !== false)) {
    await p.locator('span[id^=CKDISPONIVELCLIENTE][id$=_CHKBCAPTION]').first().click();
    await espera(2000);
  }
  // o NAJ calcula o tempo a partir do término; o tempo entra só na conferência
  const esperado = { EDDATAINICIO: dataBR(e.data), EDHORAINICIO: hms(e.inicio), EDHORATERMINO: hms(e.termino) };
  for (let tentativa = 0; ; tentativa++) {
    for (const [prefixo, v] of Object.entries(esperado)) {
      if ((await valor(p, prefixo)) !== v) await preencherCampo(p, prefixo, v);
    }
    await quieto(p);
    esperado.EDTEMPOTOTAL = tempo;
    const errados = [];
    for (const [prefixo, v] of Object.entries(esperado)) if ((await valor(p, prefixo)) !== v) errados.push(prefixo);
    if (!errados.length) break;
    if (tentativa === 2) throw new ErroLancamento(`O NAJ não aceitou a data/horários (${errados.join(', ')}).`);
  }
  if ((await ck.isChecked()) !== (e.disponivelCliente !== false)) throw new ErroLancamento('O NAJ não aceitou a opção "Disponível ao Cliente".');

  const conferido = {
    cliente: await valor(p, 'EDCLIENTE'), tipo: await valor(p, 'EDTIPOATIVIDADE'),
    data: await valor(p, 'EDDATAINICIO'), inicio: await valor(p, 'EDHORAINICIO'),
    termino: await valor(p, 'EDHORATERMINO'), tempo: await valor(p, 'EDTEMPOTOTAL'),
    codigo: await valor(p, 'EDCODIGOATIVIDADE'),
    area: await p.locator('select[id^=CBAREAJURIDICA]').evaluate(x => x.options[x.selectedIndex].text),
    disponivelCliente: await ck.isChecked(),
  };
  if (norm(conferido.area) !== norm(e.area)) throw new ErroLancamento(`O NAJ não aceitou a área jurídica "${e.area}".`);
  const print = path.join(pastaPrints, `${e.id}.png`);

  if (teste) {
    await p.screenshot({ path: print });
    await p.locator('img[id^=IMFECHARJANELA]').filter({ visible: true }).last().click({ force: true }).catch(() => {});
    await espera(2000);
    return { status: 'teste_ok', mensagem: `Teste: tela preenchida, não gravado. Tempo ${conferido.tempo}.`, ...r, conferido, print };
  }

  await p.locator('input[value="Gravar"]').filter({ visible: true }).first().click();
  await quieto(p);
  await espera(1500);
  // o NAJ confirma com "Atividade [INCLUÍDA] com sucesso!" e já abre uma atividade nova em branco
  const incluida = /INCLU[IÍ]DA\]?\s*com sucesso/i.test(await p.innerText('body'));
  const avisos = await p.$$eval('*', els => els.filter(x => x.offsetParent !== null && x.children.length === 0 && /grav|sucesso|erro|aten|obrigat/i.test(x.innerText || '')).map(x => x.innerText.trim()).slice(0, 5));
  await p.screenshot({ path: print });
  const ok = p.locator('button:visible:has-text("OK"), input[type=button][value="Ok"]:visible');
  if (await ok.count()) { await ok.first().click().catch(() => {}); await espera(1500); }
  await p.locator('img[id^=IMFECHARJANELA]').filter({ visible: true }).last().click({ force: true }).catch(() => {});
  await espera(3000);
  // confirma pela lista de atividades
  const lista = await p.innerText('body');
  const trecho = e.descricao.trim().slice(0, 40);
  if (!incluida && !lista.includes(trecho)) {
    throw new ErroLancamento(`Cliquei em Gravar, mas a atividade não apareceu na lista. Aviso do NAJ: ${avisos.join(' | ') || 'nenhum'}`);
  }
  return { status: 'lancado', mensagem: `Lançado no NAJ (código ${conferido.codigo}, tempo ${conferido.tempo}).`, ...r, codigoNaj: conferido.codigo, conferido, print };
}

(async () => {
  const [entrada, saida] = process.argv.slice(2);
  const teste = process.argv.includes('--teste');
  const iPrints = process.argv.indexOf('--prints');
  const pastaPrints = iPrints > 0 ? process.argv[iPrints + 1] : path.dirname(path.resolve(saida));
  fs.mkdirSync(pastaPrints, { recursive: true });
  const itens = JSON.parse(fs.readFileSync(entrada, 'utf8'));
  const resultados = [];
  const browser = await chromium.launch();
  let p = null;
  for (const e of itens) {
    // uma sessão nova do NAJ por lançamento, para nenhum item herdar janelas abertas do anterior
    try {
      p = await entrar(browser);
      resultados.push({ id: e.id, ...(await lancar(p, e, teste, pastaPrints)) });
    } catch (err) {
      const mensagem = err instanceof ErroLancamento ? err.message : `Falha técnica no robô: ${err.message.split('\n')[0]}`;
      resultados.push({ id: e.id, status: 'erro', mensagem, candidatos: err.candidatos || [] });
    }
    if (p) { await p.context().close().catch(() => {}); p = null; }
    fs.writeFileSync(saida, JSON.stringify(resultados, null, 2));
  }
  await browser.close();
  console.log(JSON.stringify(resultados, null, 2));
})();
