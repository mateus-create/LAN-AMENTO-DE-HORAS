// Baixa do NAJ as atividades de TODOS os usuários num período e a área de cada processo,
// para o painel de administrador montar relatórios por usuário e por núcleo.
// Uso: node robo/naj-relatorio.js <pasta de saída> <data inicial DD/MM/AAAA> [data final DD/MM/AAAA]
// Gera atividades.json [[dataISO, "HH:MM", minutos, usuário, cliente, número do processo, área do processo, descrição, parte contrária,
//   área jurídica da atividade, código do processo, código da atividade], ...]
// Opções: --cache <arquivo> (detalhes já lidos, reaproveitados entre execuções), --paralelo <n> (sessões simultâneas, padrão 1),
//   --semente <pasta> (documentos m-AAAA-MM-N.json da coleção "relatorio", baixados com ArtifactData `list` + `out_dir`):
//   as atividades já gravadas no formulário não são abertas de novo, a não ser que sejam dos últimos --reler-dias dias
//   (padrão 7) ou que o tempo na lista do NAJ seja diferente do gravado. Sem a semente, cada atividade é aberta uma a uma.
// Se a tela travar, a sessão cair ou uma página demorar demais, o robô entra de novo no NAJ e continua da mesma página.
// e usuarios.json (usuários ativos do NAJ). Só pesquisa: nada é gravado no NAJ.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { entrarNoNaj, espera, percorrerPaginas, comNovasTentativas } = require('./naj-comum');
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const dig = s => (s || '').replace(/\D/g, '');

async function entrar(browser, modulo) {
  const p = await entrarNoNaj(browser, { login: process.env.NAJ_USUARIO, senha: process.env.NAJ_SENHA });
  try {
    await p.locator('text="Controles"').first().click();
    await espera(800);
    await p.locator(`text="${modulo}"`).first().click();
    await espera(6000);
  } catch (err) { await p.context().close().catch(() => {}); throw err; }
  return p;
}
async function quieto(p) {
  await espera(300);
  for (let i = 0; i < 200 && p.pendentes > 0; i++) await espera(100);
  await espera(400);
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
  const porCodigo = new Map();
  let esperadoProcs = 0;
  const abrirProcessos = async () => {
    const p = await entrar(browser, 'Processos');
    await p.selectOption('#TIWCOMBOBOX2', { index: 0 }); // "* Todas as Situações *"
    await quieto(p);
    await p.locator('#TIWGRADBUTTON3').evaluate(e => e.click());
    await quieto(p);
    esperadoProcs = Number(((await p.innerText('body')).match(/Total de:\s*([\d.]+)\s*Processo/) || [])[1]?.replace(/\./g, '')) || 0;
    return { p, pagina: '#TIWEDIT22', total: '#TIWEDIT23' };
  };
  await percorrerPaginas({
    rotulo: 'processos', quieto, abrir: abrirProcessos,
    assinatura: async p => (await p.$$eval('tr', trs => { const t = trs.find(t => t.offsetParent !== null && t.cells.length >= 10 && /^\d+$/.test((t.cells[1] || {}).innerText || '')); return t ? t.cells[1].innerText.trim() : ''; })),
    porPagina: async (p, pg) => {
      const linhas = await p.$$eval('tr', trs => trs.filter(t => t.offsetParent !== null)
        .map(t => [...t.cells].map(c => c.innerText.trim())).filter(c => c.length >= 10 && /^\d+$/.test(c[1])));
      for (const c of linhas) porCodigo.set(c[1], c);
      if (pg % 50 === 0) console.log(`processos: página ${pg}`);
    },
  });
  procs = [...porCodigo.values()];
  if (esperadoProcs && procs.length < esperadoProcs) throw new Error(`Li ${procs.length} processos, mas o NAJ informa ${esperadoProcs}.`);
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
  // semente: atividades já gravadas no formulário, pela data/hora, usuário e começo da descrição (iguais aos da lista do NAJ)
  const chaveSemente = (dataHora, usuario, desc) => [dataHora.slice(0, 16), usuario, desc.replace(/\s+/g, ' ').slice(0, 80)].join('|');
  const semente = new Map();
  const iSem = process.argv.indexOf('--semente');
  const iDias = process.argv.indexOf('--reler-dias');
  const relerDias = iDias > 0 ? Number(process.argv[iDias + 1]) : 7;
  const limiteSemente = new Date(Date.now() - relerDias * 86400000).toISOString().slice(0, 10);
  if (iSem > 0) {
    const dir = process.argv[iSem + 1];
    const repetidas = new Set();
    for (const f of fs.readdirSync(dir).filter(f => /^m-\d{4}-\d{2}-\d+\.json$/.test(f))) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const a of (d.data || d).itens || []) {
        // a = [dataISO, HH:MM, minutos, usuário, cliente, número, área do processo, descrição, contrária, área jurídica, cód. processo, cód. atividade]
        if (!a[11] || a[0] >= limiteSemente) continue;
        const [aa, mm, dd] = a[0].split('-');
        const k = chaveSemente(`${dd}/${mm}/${aa} ${a[1]}`, a[3], a[7]);
        if (semente.has(k)) repetidas.add(k);
        semente.set(k, { codAtiv: a[11], codProc: a[10] || '', areaAtiv: a[9] || '', tempo: `${String(Math.floor(a[2] / 60)).padStart(2, '0')}:${String(a[2] % 60).padStart(2, '0')}`, minutos: a[2] });
      }
    }
    repetidas.forEach(k => semente.delete(k)); // duas atividades iguais na lista: abre as duas
    console.log(`semente: ${semente.size} atividades já gravadas (até ${limiteSemente}, as mais novas são relidas)`);
  }
  const minutosDe = t => /^\d+:\d+/.test(t || '') ? t.split(':').slice(0, 2).reduce((h, m) => Number(h) * 60 + Number(m)) : null;
  // detalhe já conhecido: do cache desta execução ou da semente (só se o tempo na lista do NAJ for o mesmo gravado)
  const conhecido = (k, linha) => {
    if (cache[k]) return cache[k];
    const s = semente.get(chaveSemente(linha[0], linha[4], linha[2]));
    if (!s) return null;
    const t = minutosDe(linha[1]);
    return t === null || t === s.minutos ? s : null;
  };
  let daSemente = 0;
  const iTrab = process.argv.indexOf('--paralelo');
  // com 2 sessões do mesmo usuário o NAJ chegou a mostrar a uma a página da outra; o padrão é 1
  const nTrab = iTrab > 0 ? Math.max(1, Number(process.argv[iTrab + 1]) || 1) : 1;

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
  // campos "Página(s) [n] de [total]" da lista: achados ao lado do rótulo, porque os ids TIWEDITn mudam quando o NAJ
  // acrescenta campos à tela (em 10/2026 passaram de TIWEDIT3/4 para TIWEDIT5/6)
  async function paginacao(q) {
    const ids = await q.evaluate(() => {
      const rot = [...document.querySelectorAll('body *')].find(e => e.offsetParent && e.childElementCount === 0 && /^P[aá]gina\(s\)$/.test(e.textContent.trim()));
      if (!rot) return [];
      const r = rot.getBoundingClientRect();
      return [...document.querySelectorAll('input')].filter(i => i.offsetParent && i.id && (i.type === 'text' || !i.type))
        .map(i => [i, i.getBoundingClientRect()]).filter(([, b]) => Math.abs((b.top + b.bottom) / 2 - (r.top + r.bottom) / 2) < 12 && b.left > r.left)
        .sort((a, b) => a[1].left - b[1].left).slice(0, 2).map(([i]) => '#' + i.id);
    });
    if (ids.length < 2) throw new Error('Não achei os campos de página da lista de atividades do NAJ.');
    return { pagina: ids[0], total: ids[1] };
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
    if (!achou) { if (process.env.DEPURAR) console.log('sem ícone de edição na linha', i); return null; }
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

  let p0 = await comNovasTentativas(abrirLista, 'lista de atividades');
  const usuarios = await p0.$$eval('#TIWCOMBOBOX1 option', os => os.map(o => o.text.trim()).filter(t => t && !t.startsWith('*') && !t.startsWith('-')));
  const conferePeriodo = [await p0.inputValue('#TIWEDIT1'), await p0.inputValue('#TIWEDIT2')];
  const esperado = Number(((await p0.innerText('body')).match(/Total de:\s*([\d.]+)\s*Registro/) || [])[1]?.replace(/\./g, '')) || 0;
  const pag = await paginacao(p0);
  const totalPaginas = Number(await p0.inputValue(pag.total)) || 1;
  console.log(`campos de página: ${pag.pagina} e ${pag.total}`);
  console.log(`atividades no período ${conferePeriodo.join(' a ')}: ${esperado} em ${totalPaginas} páginas; ${Object.keys(cache).length} já lidas antes`);
  await p0.context().close();

  const brutas = [];
  const jaVistas = new Set(); // linhas já lidas nesta execução: uma página inteira repetida = lista desatualizada
  let lidas = 0, naoConferidas = 0;
  async function trabalhador(t) {
    const pgIni = Number(process.env.PAGINA_INICIAL) || 1, pgFim = Math.min(totalPaginas, Number(process.env.PAGINA_FINAL) || totalPaginas);
    const abrir = async () => {
      const q = await abrirLista();
      q.setDefaultTimeout(20000);
      const pg2 = await paginacao(q);
      const total2 = Number(await q.inputValue(pg2.total)) || 1;
      if (total2 < totalPaginas) throw new Error(`A lista de atividades tem ${total2} páginas, menos que as ${totalPaginas} do começo.`);
      return { p: q, pagina: pg2.pagina, total: pg2.total };
    };
    // a página só entra no resultado depois de lida inteira: se a sessão cair no meio, ela é lida de novo
    await percorrerPaginas({ rotulo: `[sessão ${t + 1}]`, quieto, abrir, de: pgIni + t, ate: pgFim, passo: nTrab, limitePagina: 150000,
      assinatura: async q => { const l = (await lerLinhas(q))[0]; return l ? chaveDe(l) : ''; },
      porPagina: async (q, pg) => {
      let linhas = await lerLinhas(q);
      for (let tent = 0; linhas.length && linhas.every(l => jaVistas.has(chaveDe(l))) && tent < 3; tent++) {
        console.log(`[sessão ${t + 1}] página ${pg} veio igual a uma já lida; abrindo de novo`);
        await q.fill(pag.pagina, String(pg)); await q.press(pag.pagina, 'Enter'); await quieto(q); await espera(1500);
        linhas = await lerLinhas(q);
      }
      if (linhas.length && linhas.every(l => jaVistas.has(chaveDe(l)))) throw new Error(`A página ${pg} da lista de atividades repete outra já lida.`);
      const daPagina = [];
      let semDetalhe = 0;
      console.log(`[sessão ${t + 1}] página ${pg}/${totalPaginas} (${new Date().toISOString().slice(11, 19)})`);
      if (process.env.DEPURAR) console.log('  1ª linha:', JSON.stringify(linhas[0]), 'linhas:', linhas.length, 'sem cache:', linhas.filter(l => !conhecido(chaveDe(l), l)).length);
      for (let i = 0; i < linhas.length; i++) {
        const k = chaveDe(linhas[i]);
        if (!cache[k] && conhecido(k, linhas[i])) { cache[k] = conhecido(k, linhas[i]); daSemente++; }
        if (!cache[k]) {
          // se a atividade aberta não for a da linha (a lista mudou), relê a página e tenta de novo
          let det = null;
          for (let tent = 0; tent < 3 && !det; tent++) {
            det = await lerDetalhe(q, i, linhas[i]);
            if (!det) { await q.fill(pag.pagina, String(pg)); await q.press(pag.pagina, 'Enter'); await quieto(q); const novas = await lerLinhas(q); if (!novas[i] || chaveDe(novas[i]) !== k) break; }
          }
          if (det) { cache[k] = det; lidas++; if (lidas % 50 === 0) { salvarCache(); console.log(`detalhes lidos: ${lidas}`); } }
          else { semDetalhe++; daPagina.push([...linhas[i], { codAtiv: '', codProc: '', areaAtiv: '', tempo: '' }]); continue; }
        }
        daPagina.push([...linhas[i], cache[k]]);
      }
      linhas.forEach(l => jaVistas.add(chaveDe(l)));
      brutas.push(...daPagina);
      naoConferidas += semDetalhe;
    } });
  }
  await Promise.all(Array.from({ length: nTrab }, (_, t) => trabalhador(t)));
  salvarCache();
  await browser.close();
  console.log(`detalhes abertos no NAJ: ${lidas}; reaproveitados do formulário: ${daSemente}`);
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
  // nenhuma atividade pode faltar (o total é o do começo da leitura; as lançadas durante a leitura só somam)
  if (!esperado || atividades.length < esperado) throw new Error(`Li ${atividades.length} atividades, mas o NAJ informa ${esperado}. Nada deve ser gravado.`);
  fs.writeFileSync(path.join(saida, 'atividades.json'), JSON.stringify(atividades));
  fs.writeFileSync(path.join(saida, 'usuarios.json'), JSON.stringify(usuarios));
  fs.writeFileSync(path.join(saida, 'areas.json'), JSON.stringify([...areas.entries()].sort((a, b) => b[1] - a[1])));
  const areasAtiv = new Map(); atividades.forEach(a => a[9] && areasAtiv.set(a[9], (areasAtiv.get(a[9]) || 0) + 1));
  fs.writeFileSync(path.join(saida, 'areas-atividade.json'), JSON.stringify([...areasAtiv.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`atividades: ${atividades.length} (com processo: ${atividades.filter(a => a[10]).length}, com área do processo: ${atividades.filter(a => a[6]).length}, com área jurídica: ${atividades.filter(a => a[9]).length}); usuários: ${usuarios.length}`);
})();
