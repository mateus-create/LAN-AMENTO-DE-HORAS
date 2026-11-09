// Baixa do NAJ a lista de clientes e de processos ativos, para o formulário sugerir nomes e mostrar o processo pelo código
// sem precisar acessar o NAJ.
// Uso: node robo/naj-cadastros.js <pasta de saída> [--anterior <pasta>] [--completo] [--clientes-antes <total da cópia atual>]
//   --anterior <pasta>: pasta com clientes.json e processos.json da cópia atual do formulário (cadastros-anteriores.js).
//     Com ela, a execução é RÁPIDA: lê só os processos novos (a pesquisa vem do código mais novo para o mais antigo)
//     e confere os totais do NAJ; só baixa tudo de novo o que não bater (veja "Modo rápido" abaixo).
//   --completo: baixa tudo, mesmo com --anterior (uma vez por dia, para pegar alterações que não mudam os totais).
// Gera clientes.json [[código, nome, CPF/CNPJ], ...], processos.json (só situação ativa) [[código, cliente, parte contrária,
// número, "comarca · classe"], ...] e resumo.json { modo, clientes, processos, processosNovos, mudou }.
// Nada é gravado no NAJ: as telas são abertas só para usar as pesquisas e são fechadas sem Gravar.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { entrarNoNaj, janelaPesquisa, espera, percorrerPaginas } = require('./naj-comum');

const arg = nome => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const numero = t => Number(String(t || '').replace(/\./g, '')) || 0;

async function entrar(browser, modulo = 'atividade') {
  const p = await entrarNoNaj(browser, { login: process.env.NAJ_USUARIO, senha: process.env.NAJ_SENHA });
  await p.locator('text="Controles"').first().click();
  await espera(800);
  if (modulo === 'processos') {
    // módulo Processos: usado só para a pesquisa; ele abre um cadastro em branco que nunca é gravado
    await p.locator('text="Processos"').first().click();
    await espera(6000);
    return p;
  }
  await p.locator('text="Atividades"').first().click();
  await espera(4000);
  await p.locator('text="Nova Atividade"').first().click();
  await espera(4000);
  return p;
}

async function quieto(p) {
  await espera(300);
  for (let i = 0; i < 200 && p.pendentes > 0; i++) await espera(100);
  await espera(300);
}

// ---------- processos (módulo Processos, filtro "Somente Ativos"; a lista vem do código mais novo para o mais antigo) ----------
async function abrirProcessos(browser) {
  const p = await entrar(browser, 'processos');
  await p.selectOption('#TIWCOMBOBOX2', { index: 1 }); // "* Somente Ativos *"
  await quieto(p);
  await p.locator('#TIWGRADBUTTON3').evaluate(e => e.click());
  await quieto(p);
  return { p, pagina: '#TIWEDIT22', total: '#TIWEDIT23' };
}
const totalProcessos = async p => numero(((await p.innerText('body')).match(/Total de:\s*([\d.]+)\s*Processo/) || [])[1]);
// colunas: (marcação) | código | número | cliente(qualificação) | parte contrária | advogado/área | classe | comarca | vara | ...
const lerProcessos = p => p.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
  .map(t => [...t.cells].map(c => c.innerText.trim()))
  .filter(c => c.length >= 10 && /^\d+$/.test(c[1])));
const assinaturaProcessos = async p => ((await lerProcessos(p))[0] || [])[1] || '';
const registroProcesso = c => {
  const cliente = c[3].replace(/\s*\([^)]*\)\s*$/, '');
  const local = [c[7], c[8]].filter(x => x && x !== '-').join(' - ');
  return [c[1], cliente, c[4], c[2], [local, c[6]].filter(Boolean).join(' · ')];
};

// Todos os processos ativos. Confere com o "Total de: N Processo(s)" do NAJ, lido de novo no fim (pode entrar processo no meio).
async function todosProcessos(browser) {
  const codigos = new Map();
  let esperado = 0;
  await percorrerPaginas({
    rotulo: 'processos ativos', quieto, assinatura: assinaturaProcessos,
    abrir: async () => { const l = await abrirProcessos(browser); esperado = await totalProcessos(l.p); return l; },
    porPagina: async (p, pg) => {
      for (const c of await lerProcessos(p)) codigos.set(c[1], registroProcesso(c));
      if (pg % 50 === 0) console.log(`processos ativos: página ${pg}, ${codigos.size} códigos`);
    },
  });
  // confere com o total de uma sessão nova (o total da sessão que leu pode ser de antes de um processo novo)
  const l = await abrirProcessos(browser);
  const fim = await totalProcessos(l.p);
  await l.p.context().close();
  console.log(`processos ativos: ${codigos.size} (o NAJ informa ${fim})`);
  if (!fim || codigos.size !== fim) throw new Error(`Li ${codigos.size} processos ativos, mas o NAJ informa ${fim || esperado}. Nada foi alterado.`);
  return codigos;
}

// Só os processos novos: lê do começo da lista até a primeira página que já tenha um código conhecido.
// Vale só se cópia atual + novos = total de ativos do NAJ (um processo baixado ou reativado muda a conta e força a leitura completa).
async function processosNovos(browser, anteriores) {
  const maior = Math.max(0, ...anteriores.map(r => Number(r[0])));
  const novos = new Map();
  let total = 0;
  await percorrerPaginas({
    rotulo: 'processos novos', quieto, assinatura: assinaturaProcessos,
    abrir: async () => { const l = await abrirProcessos(browser); total = await totalProcessos(l.p); return l; },
    porPagina: async p => {
      const linhas = await lerProcessos(p);
      for (const c of linhas) if (Number(c[1]) > maior) novos.set(c[1], registroProcesso(c));
      return !linhas.length || linhas.some(c => Number(c[1]) <= maior);
    },
  });
  const juntos = new Map(anteriores.map(r => [r[0], r]));
  for (const [cod, r] of novos) juntos.set(cod, r);
  console.log(`processos novos: ${novos.size}; cópia atual ${anteriores.length} + novos = ${juntos.size}; o NAJ informa ${total} ativos`);
  return { confere: total > 0 && juntos.size === total, juntos, novos: [...novos.values()] };
}

// ---------- clientes (pesquisa de clientes da tela "Nova Atividade"; a lista vem em ordem alfabética) ----------
async function linhasClientes(p) {
  return p.$$eval('[id^=RGJANELA] tr', trs => trs
    .filter(t => t.offsetParent !== null && t.querySelector('a[title^="Clique aqui"]'))
    .map(t => [...t.cells].map(c => c.innerText.trim()))
    .filter(c => c.length === 3 && c[0]));
}
async function abrirClientes(browser, situacao) {
  const p = await entrar(browser);
  await p.locator('img[id^=IMCLIENTECNS]').click();
  await quieto(p);
  const jan = await janelaPesquisa(p, 'CPF/CNPJ');
  await p.selectOption(jan.combo, { label: situacao });
  await quieto(p);
  await p.fill(jan.busca[0], '');
  await p.click(jan.botao);
  await quieto(p);
  // "Total de: N Registro(s)" da própria janela
  const texto = await p.locator(`[id^=RGJANELA]:has(${jan.botao})`).first().innerText();
  const totalNaj = numero((texto.match(/Total de:\s*([\d.]+)\s*Registro/) || [])[1]);
  return { p, pagina: jan.pagina, total: jan.total, totalNaj };
}
async function totaisClientes(browser) {
  const r = {};
  for (const s of ['Ativo', 'Inativo']) { const l = await abrirClientes(browser, s); r[s] = l.totalNaj; await l.p.context().close(); }
  return r;
}
async function todosClientes(browser) {
  const clientes = new Map();
  for (const situacao of ['Ativo', 'Inativo']) {
    const vistos = new Map();
    await percorrerPaginas({
      rotulo: `clientes ${situacao}`, quieto, assinatura: async p => ((await linhasClientes(p))[0] || [])[0] || '',
      abrir: () => abrirClientes(browser, situacao),
      porPagina: async (p, pg) => {
        for (const l of await linhasClientes(p)) vistos.set(l[0], l);
        if (pg % 50 === 0) console.log(`clientes ${situacao}: página ${pg}, ${vistos.size} registros`);
      },
    });
    const l = await abrirClientes(browser, situacao);
    await l.p.context().close();
    console.log(`clientes ${situacao}: ${vistos.size} (o NAJ informa ${l.totalNaj})`);
    if (!l.totalNaj || vistos.size !== l.totalNaj) throw new Error(`Li ${vistos.size} clientes "${situacao}", mas o NAJ informa ${l.totalNaj}. Nada foi alterado.`);
    for (const c of vistos.values()) clientes.set(c[0], c);
  }
  return [...clientes.values()].map(([cod, nome, doc]) => [cod, nome, doc || '']).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
}

(async () => {
  const saida = process.argv[2] || '.';
  fs.mkdirSync(saida, { recursive: true });
  const dirAnterior = arg('--anterior');
  const ler = f => JSON.parse(fs.readFileSync(path.join(dirAnterior, f), 'utf8'));
  const anterior = dirAnterior ? { clientes: ler('clientes.json'), processos: ler('processos.json') } : null;
  const rapido = anterior && !process.argv.includes('--completo') && anterior.clientes.length && anterior.processos.length;
  const browser = await chromium.launch();
  const resumo = { modo: rapido ? 'rápido' : 'completo' };

  // processos
  let processos, novos = [];
  if (rapido) {
    const r = await processosNovos(browser, anterior.processos);
    novos = r.novos;
    if (r.confere) processos = [...r.juntos.values()];
    else { console.log('processos: a conta não fecha (algum foi baixado, reativado ou entrou no meio); lendo todos'); resumo.processosCompleto = true; }
  }
  if (!processos) processos = [...(await todosProcessos(browser)).values()];
  processos.sort((a, b) => Number(a[0]) - Number(b[0]));

  // clientes
  let clientes;
  if (rapido) {
    const t = await totaisClientes(browser);
    const nomes = new Set(anterior.clientes.map(c => norm(c[1])));
    const semCliente = novos.filter(r => r[1] && !nomes.has(norm(r[1])));
    console.log(`clientes no NAJ: ${t.Ativo} ativos + ${t.Inativo} inativos = ${t.Ativo + t.Inativo}; cópia atual ${anterior.clientes.length}; processos novos com cliente fora da lista: ${semCliente.length}`);
    if (t.Ativo && t.Ativo + t.Inativo === anterior.clientes.length && !semCliente.length) clientes = anterior.clientes;
    else { console.log('clientes: mudaram; lendo todos'); resumo.clientesCompleto = true; }
  }
  if (!clientes) clientes = await todosClientes(browser);
  await browser.close();

  // a lista não pode encolher de repente (tela do NAJ mudou, paginação quebrada): --clientes-antes <n> é o total da cópia atual
  const antes = Number(arg('--clientes-antes')) || (anterior ? anterior.clientes.length : 0);
  if (antes && clientes.length < antes * 0.995) throw new Error(`Li ${clientes.length} clientes, menos de 99,5% dos ${antes} da cópia atual. Nada foi alterado.`);

  fs.writeFileSync(path.join(saida, 'clientes.json'), JSON.stringify(clientes));
  fs.writeFileSync(path.join(saida, 'processos.json'), JSON.stringify(processos));
  resumo.clientes = clientes.length;
  resumo.processos = processos.length;
  resumo.processosNovos = novos.length;
  resumo.mudou = !anterior || JSON.stringify(clientes) !== JSON.stringify(anterior.clientes) || JSON.stringify(processos) !== JSON.stringify(anterior.processos);
  fs.writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo));
  console.log(`clientes: ${clientes.length}; processos ativos: ${processos.length}; ${resumo.mudou ? 'HÁ MUDANÇAS para gravar' : 'SEM MUDANÇAS (não grave nada)'}`);
  console.log('resumo:', JSON.stringify(resumo));
})().catch(err => { console.error(err.message || err); process.exit(1); });
