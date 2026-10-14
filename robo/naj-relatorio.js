// Baixa do NAJ as atividades de TODOS os usuários num período e a área de cada processo,
// para o painel de administrador montar relatórios por usuário e por núcleo.
// Uso: node robo/naj-relatorio.js <pasta de saída> <data inicial DD/MM/AAAA> [data final DD/MM/AAAA]
// Gera atividades.json [[dataISO, "HH:MM", minutos, usuário, cliente, número do processo, área do processo, descrição, parte contrária,
//   área jurídica da atividade, código do processo, código da atividade], ...]
// Opções: --cache <arquivo> (detalhes já lidos, reaproveitados entre execuções), --paralelo <n> (sessões simultâneas, padrão 3).
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
  const [saida, de] = process.argv.slice(2);
  const ate = /^\d{2}\/\d{2}\/\d{4}$/.test(process.argv[4] || '') ? process.argv[4] : null;
  if (!saida || !/^\d{2}\/\d{2}\/\d{4}$/.test(de || '')) { console.error('Uso: node robo/naj-relatorio.js <pasta> <DD/MM/AAAA> [DD/MM/AAAA]'); process.exit(1); }
  const hojeBR = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  fs.mkdirSync(saida, { recursive: true });
  const browser = await chromium.launch();

  // 1) área de cada processo (todas as situações), no módulo Processos; o cadastro em branco que ele abre nunca é gravado.
  //    --reusar-areas <processos-areas.json> aproveita uma leitura recente.
  const iAreas = process.argv.indexOf('--reusar-areas');
  let procs;
  if (iAreas > 0) {
    procs = JSON.parse(fs.readFileSync(process.argv[iAreas + 1], 'utf8')).map(([cod, num, cli, contr, area]) => ['', cod, num, cli, contr, area]);
  } else {
  let p = await entrar(browser, 'Processos');
  await p.selectOption('#TIWCOMBOBOX2', { index: 0 }); // "* Todas as Situações *"
  await quieto(p);
  await p.locator('#TIWGRADBUTTON3').evaluate(e => e.click());
  await quieto(p);
  procs = await paginar(p, '#TIWEDIT22', '#TIWEDIT23', () => p.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
    .map(t => [...t.cells].map(c => c.innerText.trim())).filter(c => c.length >= 10 && /^\d+$/.test(c[1]))), 'processos');
  await p.context().close();
  }
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

  // 2) atividades de todos os usuários no período. A lista não mostra o processo vinculado nem a área jurídica
  //    da atividade, então cada atividade nova é aberta (só leitura) para ler esses campos; as já lidas ficam no cache.
  const iCache = process.argv.indexOf('--cache');
  const arqCache = iCache > 0 ? process.argv[iCache + 1] : path.join(saida, 'detalhes.json');
  const cache = fs.existsSync(arqCache) ? JSON.parse(fs.readFileSync(arqCache, 'utf8')) : {};
  const salvarCache = () => fs.writeFileSync(arqCache, JSON.stringify(cache));
  const iTrab = process.argv.indexOf('--paralelo');
  const nTrab = iTrab > 0 ? Math.max(1, Number(process.argv[iTrab + 1]) || 1) : 2;

  async function abrirLista() {
    const q = await entrar(browser, 'Atividades');
    await q.selectOption('#TIWCOMBOBOX1', { index: 0 }); // "* Todos os Usuários *"
    await quieto(q);
    await q.fill('#TIWEDIT1', de); await q.press('#TIWEDIT1', 'Tab'); await quieto(q);
    await q.fill('#TIWEDIT2', ate || hojeBR); await q.press('#TIWEDIT2', 'Tab'); await quieto(q);
    // da mais antiga para a mais nova: atividades lançadas durante a leitura entram no fim e não deslocam as páginas
    await q.selectOption('#TIWCOMBOBOX3', { index: 0 }); await quieto(q); // "Data e Hora Início"
    await q.selectOption('#TIWCOMBOBOX4', { index: 0 }); await quieto(q); // "Crescente"
    await q.locator('#TIWGRADBUTTON1').evaluate(e => e.click());
    await quieto(q);
    return q;
  }
  const lerLinhas = q => q.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
    .map(t => [...t.cells].map(c => c.innerText.trim())).filter(c => c.length >= 8 && /^\d{2}\/\d{2}\/\d{4}/.test(c[3] || '')).map(c => c.slice(3, 8)));
  const chaveDe = ([dataHora, , desc, info, usuario]) => [dataHora, usuario, desc.replace(/\s+/g, ' ').slice(0, 80), info].join('|');
  async function lerDetalhe(q, i, linha) {
    // abre pelo ícone de edição da própria linha (nem toda linha tem ícone, então não dá para contar ícones)
    const achou = await q.$$eval('tr', (trs, i) => {
      const rows = trs.filter(t => t.offsetParent !== null && t.cells.length >= 8 && /^\d{2}\/\d{2}\/\d{4}/.test((t.cells[3] || {}).innerText || ''));
      const img = rows[i] && rows[i].querySelector('img[src*="edit-row"]');
      if (img) img.click();
      return !!img;
    }, i);
    if (!achou) return null;
    await quieto(q);
    const descTela = await q.locator('textarea[id^=MMDESCRICAO]').filter({ visible: true }).first().inputValue().catch(() => '');
    const v = await q.$$eval('input[type=text],select', els => Object.fromEntries(els.filter(e => e.offsetParent !== null && /^(ED|CB)[A-Z]+\d*$/.test(e.id))
      .map(e => [e.id.replace(/\d+$/, ''), e.tagName === 'SELECT' ? (e.options[e.selectedIndex] || {}).text || '' : e.value])));
    await q.locator('img[id^=IMFECHARJANELA]').filter({ visible: true }).last().evaluate(e => e.click());
    await quieto(q);
    // confere que abriu a atividade certa: a descrição da tela começa como a da lista
    const curto = t => t.replace(/\s+/g, ' ').trim().slice(0, 30).replace(/\(\.\.\.\)$/, '');
    if (curto(descTela) && curto(linha[2]) && !curto(descTela).startsWith(curto(linha[2]).slice(0, 20))) {
      if (process.env.DEPURAR) console.log('não conferiu:', JSON.stringify({ lista: linha[2].slice(0, 60), tela: descTela.slice(0, 60), cod: v.EDCODIGOATIVIDADE }));
      return null;
    }
    const area = (v.CBAREAJURIDICA || '').replace(/^\*.*\*$/, '').trim();
    return { codAtiv: v.EDCODIGOATIVIDADE || '', codProc: v.EDCODIGOPROCESSO || '', areaAtiv: area, tempo: v.EDTEMPOTOTAL || '' };
  }

  let p0 = await abrirLista();
  const usuarios = await p0.$$eval('#TIWCOMBOBOX1 option', os => os.map(o => o.text.trim()).filter(t => t && !t.startsWith('*') && !t.startsWith('-')));
  const conferePeriodo = [await p0.inputValue('#TIWEDIT1'), await p0.inputValue('#TIWEDIT2')];
  const esperado = Number(((await p0.innerText('body')).match(/Total de:\s*([\d.]+)\s*Registro/) || [])[1]?.replace(/\./g, '')) || 0;
  const totalPaginas = Number(await p0.inputValue('#TIWEDIT4')) || 1;
  console.log(`atividades no período ${conferePeriodo.join(' a ')}: ${esperado} em ${totalPaginas} páginas; ${Object.keys(cache).length} já lidas antes`);
  await p0.context().close();

  const brutas = [];
  let lidas = 0, naoConferidas = 0;
  async function trabalhador(t) {
    const q = await abrirLista();
    q.setDefaultTimeout(20000);
    const pgIni = Number(process.env.PAGINA_INICIAL) || 1, pgFim = Math.min(totalPaginas, Number(process.env.PAGINA_FINAL) || totalPaginas);
    for (let pg = pgIni + t; pg <= pgFim; pg += nTrab) {
      if (pg > 1) { await q.fill('#TIWEDIT3', String(pg)); await q.press('#TIWEDIT3', 'Enter'); await quieto(q); }
      if (await q.inputValue('#TIWEDIT3') !== String(pg)) throw new Error(`Não consegui abrir a página ${pg} da lista de atividades.`);
      let linhas = await lerLinhas(q);
      console.log(`[sessão ${t + 1}] página ${pg}/${totalPaginas} (${new Date().toISOString().slice(11, 19)})`);
      for (let i = 0; i < linhas.length; i++) {
        const k = chaveDe(linhas[i]);
        if (!cache[k]) {
          // se a atividade aberta não for a da linha (a lista mudou), relê a página e tenta de novo
          let det = null;
          for (let tent = 0; tent < 3 && !det; tent++) {
            det = await lerDetalhe(q, i, linhas[i]);
            if (!det) { await q.fill('#TIWEDIT3', String(pg)); await q.press('#TIWEDIT3', 'Enter'); await quieto(q); const novas = await lerLinhas(q); if (!novas[i] || chaveDe(novas[i]) !== k) break; }
          }
          if (det) { cache[k] = det; lidas++; if (lidas % 50 === 0) { salvarCache(); console.log(`detalhes lidos: ${lidas}`); } }
          else { naoConferidas++; brutas.push([...linhas[i], { codAtiv: '', codProc: '', areaAtiv: '', tempo: '' }]); continue; }
        }
        brutas.push([...linhas[i], cache[k]]);
      }
    }
    await q.context().close();
  }
  await Promise.all(Array.from({ length: nTrab }, (_, t) => trabalhador(t)));
  salvarCache();
  await browser.close();
  if (naoConferidas) console.log(`atividades sem detalhe (a lista mudou durante a leitura): ${naoConferidas}`);

  const areaPorCodigo = new Map(procs.map(c => [c[1], (c[5] || '').trim()]));
  const vistos = new Set();
  const atividades = [];
  for (const [dataHora, tempo, desc, info, usuario, det] of brutas) {
    const chave = det.codAtiv || [dataHora, usuario, desc.slice(0, 80), info].join('|');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const [d, h] = dataHora.split(' ');
    const [dd, mm, aa] = d.split('/');
    const t = /^\d+:\d+/.test(det.tempo) ? det.tempo : tempo;
    const [th, tm] = /^\d+:\d+/.test(t) ? t.split(':').map(Number) : [0, 0];
    // "Mais informações" = "CLIENTE x PARTE CONTRÁRIA - número" (número opcional)
    const m = info.match(/^(.*?)(?:\s+x\s+(.*?))?(?:\s+-\s+([\d.\-\/ ()]{10,}))?$/s) || [];
    const cliente = (m[1] || info).trim(), contraria = (m[2] || '').trim(), numero = (m[3] || '').trim();
    // área do processo pelo código exato do processo vinculado à atividade
    const areaProc = det.codProc ? (areaPorCodigo.get(det.codProc) || '') : '';
    atividades.push([`${aa}-${mm}-${dd}`, (h || '').slice(0, 5), th * 60 + tm, usuario, cliente, numero, areaProc, desc.replace(/\s+/g, ' ').slice(0, 140), contraria, det.areaAtiv, det.codProc, det.codAtiv]);
  }
  if (esperado && atividades.length < esperado * 0.97) throw new Error(`Li ${atividades.length} atividades, mas o NAJ informa ${esperado}.`);
  fs.writeFileSync(path.join(saida, 'atividades.json'), JSON.stringify(atividades));
  fs.writeFileSync(path.join(saida, 'usuarios.json'), JSON.stringify(usuarios));
  fs.writeFileSync(path.join(saida, 'areas.json'), JSON.stringify([...areas.entries()].sort((a, b) => b[1] - a[1])));
  const areasAtiv = new Map(); atividades.forEach(a => a[9] && areasAtiv.set(a[9], (areasAtiv.get(a[9]) || 0) + 1));
  fs.writeFileSync(path.join(saida, 'areas-atividade.json'), JSON.stringify([...areasAtiv.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`atividades: ${atividades.length} (com processo: ${atividades.filter(a => a[10]).length}, com área do processo: ${atividades.filter(a => a[6]).length}, com área jurídica: ${atividades.filter(a => a[9]).length}); usuários: ${usuarios.length}`);
})();
