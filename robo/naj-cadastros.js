// Baixa do NAJ a lista de clientes e de processos (as mesmas pesquisas da tela "Nova Atividade"),
// para o formulário sugerir nomes e mostrar o processo pelo código sem precisar acessar o NAJ.
// Uso: node robo/naj-cadastros.js <pasta de saída> [--clientes-antes <total da cópia atual>] [--so-processos]
// Gera clientes.json [[código, nome, CPF/CNPJ], ...] e processos.json (só processos com situação ativa no NAJ) [[código, cliente, parte contrária, número, "comarca · classe"], ...]
// Nada é gravado no NAJ: a tela "Nova Atividade" é aberta só para usar as pesquisas e é fechada sem Gravar.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { entrarNoNaj, janelaPesquisa, espera } = require('./naj-comum');

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

// Códigos dos processos com situação cadastral ativa (judicial ou extrajudicial), pela pesquisa do módulo Processos.
async function codigosAtivos(browser) {
  const p = await entrar(browser, 'processos');
  await p.selectOption('#TIWCOMBOBOX2', { index: 1 }); // "* Somente Ativos *"
  await quieto(p);
  await p.locator('#TIWGRADBUTTON3').evaluate(e => e.click());
  await quieto(p);
  const total = Number(await p.inputValue('#TIWEDIT23')) || 1;
  // colunas: (marcação) | código | número | cliente(qualificação) | parte contrária | advogado/área | classe | comarca | vara | ...
  const codigos = new Map();
  const lerPagina = () => p.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
    .map(t => [...t.cells].map(c => c.innerText.trim()))
    .filter(c => c.length >= 10 && /^\d+$/.test(c[1])));
  for (let pg = 1; pg <= total; pg++) {
    if (pg > 1) {
      await p.fill('#TIWEDIT22', String(pg));
      await p.press('#TIWEDIT22', 'Enter');
      await quieto(p);
    }
    for (const c of await lerPagina()) {
      const cliente = c[3].replace(/\s*\([^)]*\)\s*$/, '');
      const local = [c[7], c[8]].filter(x => x && x !== '-').join(' - ');
      codigos.set(c[1], [c[1], cliente, c[4], c[2], [local, c[6]].filter(Boolean).join(' · ')]);
    }
    if (pg % 50 === 0) console.log(`processos ativos: página ${pg}/${total}, ${codigos.size} códigos`);
  }
  const esperado = Number(((await p.innerText('body')).match(/Total de:\s*([\d.]+)\s*Processo/) || [])[1]?.replace(/\./g, '')) || 0;
  await p.context().close();
  console.log(`processos ativos: ${codigos.size} (o NAJ informa ${esperado})`);
  if (esperado && codigos.size < esperado * 0.98) throw new Error(`Li ${codigos.size} processos ativos, mas o NAJ informa ${esperado}. Nada foi alterado.`);
  return codigos;
}

async function linhas(p, colunas) {
  return p.$$eval('[id^=RGJANELA] tr', (trs, n) => trs
    .filter(t => t.offsetParent !== null && t.querySelector('a[title^="Clique aqui"]'))
    .map(t => [...t.cells].map(c => c.innerText.trim()))
    .filter(c => c.length === n && c[0]), colunas);
}

// Percorre todas as páginas da pesquisa aberta digitando o número da página no campo de paginação.
async function todasPaginas(p, campoPagina, campoTotal, colunas, rotulo) {
  const total = Number(await p.inputValue(campoTotal)) || 1;
  const vistos = new Map();
  for (let pg = 1; pg <= total; pg++) {
    if (pg > 1) {
      await p.fill(campoPagina, String(pg));
      await p.press(campoPagina, 'Enter');
      await quieto(p);
    }
    for (const l of await linhas(p, colunas)) vistos.set(l[0], l);
    if (pg % 50 === 0) console.log(`${rotulo}: página ${pg}/${total}, ${vistos.size} registros`);
  }
  return [...vistos.values()];
}

(async () => {
  const saida = process.argv[2] || '.';
  fs.mkdirSync(saida, { recursive: true });
  const browser = await chromium.launch();
  let p = await entrar(browser);

  // clientes: ativos e inativos (--so-processos reaproveita clientes.json já baixado)
  if (!process.argv.includes('--so-processos')) {
  await p.locator('img[id^=IMCLIENTECNS]').click();
  await quieto(p);
  const clientes = new Map();
  const jan = await janelaPesquisa(p, 'CPF/CNPJ');
  let esperado = 0;
  for (const situacao of ['Ativo', 'Inativo']) {
    await p.selectOption(jan.combo, { label: situacao });
    await quieto(p);
    await p.fill(jan.busca[0], '');
    await p.click(jan.botao);
    await quieto(p);
    // "Total de: N Registro(s)" da própria janela, para conferir a leitura
    const texto = await p.locator(`[id^=RGJANELA]:has(${jan.botao})`).first().innerText();
    const totalNaj = Number((texto.match(/Total de:\s*([\d.]+)\s*Registro/) || [])[1]?.replace(/\./g, '')) || 0;
    const lidos = await todasPaginas(p, jan.pagina, jan.total, 3, `clientes ${situacao}`);
    console.log(`clientes ${situacao}: ${lidos.length} (o NAJ informa ${totalNaj})`);
    if (totalNaj && lidos.length < totalNaj * 0.98) throw new Error(`Li ${lidos.length} clientes "${situacao}", mas o NAJ informa ${totalNaj}. Nada foi alterado.`);
    esperado += totalNaj;
    for (const c of lidos) clientes.set(c[0], c);
  }
  const listaClientes = [...clientes.values()].map(([cod, nome, doc]) => [cod, nome, doc || '']).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  fs.writeFileSync(path.join(saida, 'clientes.json'), JSON.stringify(listaClientes));
  console.log(`clientes: ${listaClientes.length} (o NAJ informa ${esperado})`);
  // a lista não pode encolher de repente (tela do NAJ mudou, paginação quebrada): --clientes-antes <n> é o total da cópia atual
  const iAntes = process.argv.indexOf('--clientes-antes');
  const antes = iAntes > 0 ? Number(process.argv[iAntes + 1]) || 0 : 0;
  if (antes && listaClientes.length < antes * 0.98) {
    fs.rmSync(path.join(saida, 'clientes.json'));
    throw new Error(`Li ${listaClientes.length} clientes, menos de 98% dos ${antes} da cópia atual. Nada foi alterado.`);
  }
  }

  await p.context().close();

  // processos: só os ativos, direto do filtro "Somente Ativos" do módulo Processos (rápido o bastante para rodar de hora em hora)
  const ativos = await codigosAtivos(browser);
  const processosAtivos = [...ativos.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
  fs.writeFileSync(path.join(saida, 'processos.json'), JSON.stringify(processosAtivos));
  console.log(`processos ativos: ${processosAtivos.length}`);
  await browser.close();
})();
