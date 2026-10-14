// Baixa do NAJ as atividades de TODOS os usuários num período e a área de cada processo,
// para o painel de administrador montar relatórios por usuário e por núcleo.
// Uso: node robo/naj-relatorio.js <pasta de saída> <data inicial DD/MM/AAAA> [data final DD/MM/AAAA]
// Gera atividades.json [[dataISO, "HH:MM", minutos, usuário, cliente, número do processo, área do processo, descrição, parte contrária], ...]
// e usuarios.json (usuários ativos do NAJ). Só pesquisa: nada é gravado no NAJ.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const espera = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const dig = s => (s || '').replace(/\D/g, '');

async function entrar(browser, modulo) {
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
  await p.locator(`text="${modulo}"`).first().click();
  await espera(6000);
  return p;
}
async function quieto(p) {
  await espera(300);
  for (let i = 0; i < 200 && p.pendentes > 0; i++) await espera(100);
  await espera(400);
}
async function paginar(p, campoPagina, campoTotal, ler, rotulo) {
  const total = Number(await p.inputValue(campoTotal)) || 1;
  const itens = [];
  for (let pg = 1; pg <= total; pg++) {
    if (pg > 1) { await p.fill(campoPagina, String(pg)); await p.press(campoPagina, 'Enter'); await quieto(p); }
    itens.push(...await ler());
    if (pg % 50 === 0) console.log(`${rotulo}: página ${pg}/${total}`);
  }
  return itens;
}

(async () => {
  const [saida, de, ate] = process.argv.slice(2);
  if (!saida || !/^\d{2}\/\d{2}\/\d{4}$/.test(de || '')) { console.error('Uso: node robo/naj-relatorio.js <pasta> <DD/MM/AAAA> [DD/MM/AAAA]'); process.exit(1); }
  const hojeBR = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  fs.mkdirSync(saida, { recursive: true });
  const browser = await chromium.launch();

  // 1) área de cada processo (todas as situações), no módulo Processos; o cadastro em branco que ele abre nunca é gravado
  let p = await entrar(browser, 'Processos');
  await p.selectOption('#TIWCOMBOBOX2', { index: 0 }); // "* Todas as Situações *"
  await quieto(p);
  await p.locator('#TIWGRADBUTTON3').evaluate(e => e.click());
  await quieto(p);
  const procs = await paginar(p, '#TIWEDIT22', '#TIWEDIT23', () => p.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
    .map(t => [...t.cells].map(c => c.innerText.trim())).filter(c => c.length >= 10 && /^\d+$/.test(c[1]))), 'processos');
  await p.context().close();
  // a área do processo é o campo "Advogado do Cliente" do cadastro (coluna 5 da pesquisa)
  const areaPorNumero = new Map(), areaPorPartes = new Map(), areas = new Map();
  const juntar = (mapa, chave, area) => { const s = mapa.get(chave) || new Set(); s.add(area); mapa.set(chave, s); };
  for (const c of procs) {
    const area = (c[5] || '').trim();
    if (!area) continue;
    areas.set(area, (areas.get(area) || 0) + 1);
    if (dig(c[2]).length >= 10) juntar(areaPorNumero, dig(c[2]), area);
    const contraria = norm(c[4]);
    if (contraria) juntar(areaPorPartes, norm(c[3].replace(/\s*\([^)]*\)\s*$/, '')) + '|' + contraria, area);
  }
  // só vale quando aponta para uma única área: sem processo identificado, a atividade fica sem área
  const unica = s => (s && s.size === 1 ? [...s][0] : '');
  fs.writeFileSync(path.join(saida, 'processos-areas.json'), JSON.stringify(procs.map(c => [c[1], c[2], c[3], c[4], c[5]])));
  console.log(`processos: ${procs.length}, áreas: ${areas.size}`);

  // 2) atividades de todos os usuários no período
  p = await entrar(browser, 'Atividades');
  const usuarios = await p.$$eval('#TIWCOMBOBOX1 option', os => os.map(o => o.text.trim()).filter(t => t && !t.startsWith('*') && !t.startsWith('-')));
  await p.selectOption('#TIWCOMBOBOX1', { index: 0 }); // "* Todos os Usuários *"
  await quieto(p);
  await p.fill('#TIWEDIT1', de); await p.press('#TIWEDIT1', 'Tab'); await quieto(p);
  await p.fill('#TIWEDIT2', ate || hojeBR); await p.press('#TIWEDIT2', 'Tab'); await quieto(p);
  await p.locator('#TIWGRADBUTTON1').evaluate(e => e.click());
  await quieto(p);
  const conferePeriodo = [await p.inputValue('#TIWEDIT1'), await p.inputValue('#TIWEDIT2')];
  const esperado = Number(((await p.innerText('body')).match(/Total de:\s*([\d.]+)\s*Registro/) || [])[1]?.replace(/\./g, '')) || 0;
  console.log(`atividades no período ${conferePeriodo.join(' a ')}: ${esperado}`);
  const brutas = await paginar(p, '#TIWEDIT3', '#TIWEDIT4', () => p.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
    .map(t => [...t.cells].map(c => c.innerText.trim())).filter(c => c.length >= 8 && /^\d{2}\/\d{2}\/\d{4}/.test(c[3] || '')).map(c => c.slice(3, 8))), 'atividades');
  await browser.close();

  const vistos = new Set();
  const atividades = [];
  for (const [dataHora, tempo, desc, info, usuario] of brutas) {
    const chave = [dataHora, usuario, desc.slice(0, 60), info].join('|');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const [d, h] = dataHora.split(' ');
    const [dd, mm, aa] = d.split('/');
    const [th, tm] = /^\d+:\d+/.test(tempo) ? tempo.split(':').map(Number) : [0, 0];
    // "Mais informações" = "CLIENTE x PARTE CONTRÁRIA - número" (número opcional)
    const m = info.match(/^(.*?)(?:\s+x\s+(.*?))?(?:\s+-\s+([\d.\-\/ ()]{10,}))?$/s) || [];
    const cliente = (m[1] || info).trim(), contraria = (m[2] || '').trim(), numero = (m[3] || '').trim();
    // área só quando a atividade identifica o processo: pelo número, ou por cliente + parte contrária
    const area = dig(numero).length >= 10 ? unica(areaPorNumero.get(dig(numero)))
      : contraria ? unica(areaPorPartes.get(norm(cliente) + '|' + norm(contraria))) : '';
    atividades.push([`${aa}-${mm}-${dd}`, (h || '').slice(0, 5), th * 60 + tm, usuario, cliente, numero, area, desc.replace(/\s+/g, ' ').slice(0, 140), contraria]);
  }
  if (esperado && atividades.length < esperado * 0.97) throw new Error(`Li ${atividades.length} atividades, mas o NAJ informa ${esperado}.`);
  fs.writeFileSync(path.join(saida, 'atividades.json'), JSON.stringify(atividades));
  fs.writeFileSync(path.join(saida, 'usuarios.json'), JSON.stringify(usuarios));
  fs.writeFileSync(path.join(saida, 'areas.json'), JSON.stringify([...areas.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`atividades: ${atividades.length} (com área: ${atividades.filter(a => a[6]).length}); usuários: ${usuarios.length}`);
})();
