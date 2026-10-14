// Baixa do NAJ a lista de clientes e de processos (as mesmas pesquisas da tela "Nova Atividade"),
// para o formulário sugerir nomes e mostrar o processo pelo código sem precisar acessar o NAJ.
// Uso: node robo/naj-cadastros.js <pasta de saída>
// Gera clientes.json [[código, nome, CPF/CNPJ], ...] e processos.json (só processos com situação ativa no NAJ) [[código, cliente, parte contrária, número, "comarca · classe"], ...]
// Nada é gravado no NAJ: a tela "Nova Atividade" é aberta só para usar as pesquisas e é fechada sem Gravar.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const espera = ms => new Promise(r => setTimeout(r, ms));

async function entrar(browser, modulo = 'atividade') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
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
  for (const situacao of ['Ativo', 'Inativo']) {
    await p.selectOption('#TIWCOMBOBOX6', { label: situacao });
    await quieto(p);
    await p.fill('#TIWEDIT8', '');
    await p.click('#TIWGRADBUTTON7');
    await quieto(p);
    for (const c of await todasPaginas(p, '#TIWEDIT9', '#TIWEDIT10', 3, `clientes ${situacao}`)) clientes.set(c[0], c);
  }
  const listaClientes = [...clientes.values()].map(([cod, nome, doc]) => [cod, nome, doc || '']).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  fs.writeFileSync(path.join(saida, 'clientes.json'), JSON.stringify(listaClientes));
  console.log(`clientes: ${listaClientes.length}`);
  }

  // processos: sessão nova do NAJ, porque a janela de clientes deixa a tela bloqueada
  await p.context().close();
  const iReuso = process.argv.indexOf('--reusar-processos');
  let processos;
  if (iReuso > 0) {
    processos = JSON.parse(fs.readFileSync(process.argv[iReuso + 1], 'utf8'));
  } else {
  p = await entrar(browser);
  await p.locator('img[id^=IMMENUINFOPROCESSO]').first().click();
  await quieto(p);
  await p.locator('img[id^=IMCODIGOPROCESSO]').click();
  await quieto(p);
  await p.fill('#TIWEDIT13', '');
  await p.fill('#TIWEDIT14', '');
  await p.click('#TIWGRADBUTTON8');
  await quieto(p);
  processos = (await todasPaginas(p, '#TIWEDIT15', '#TIWEDIT16', 4, 'processos')).map(([cod, cliente, contraria, info]) => {
    // a célula traz número, comarca e classe em linhas; processos sem número começam pela comarca
    const partes = info.split('\n').map(s => s.trim()).filter(Boolean);
    const numero = partes[0] && (partes[0].replace(/\D/g, '').length >= 10) ? partes.shift() : '';
    return [cod, cliente, contraria, numero, partes.join(' · ')];
  }).sort((a, b) => Number(a[0]) - Number(b[0]));
  await p.context().close();
  }

  fs.writeFileSync(path.join(saida, 'processos-todos.json'), JSON.stringify(processos));

  // só os processos ativos no NAJ; os que a pesquisa da atividade não trouxe vêm do módulo Processos
  const ativos = await codigosAtivos(browser);
  const daAtividade = new Set(processos.map(x => x[0]));
  const processosAtivos = [...processos.filter(x => ativos.has(x[0])), ...[...ativos.values()].filter(x => !daAtividade.has(x[0]))]
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  fs.writeFileSync(path.join(saida, 'processos.json'), JSON.stringify(processosAtivos));
  console.log(`processos: ${processosAtivos.length} ativos de ${processos.length}`);
  await browser.close();
})();
