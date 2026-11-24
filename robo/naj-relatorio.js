// Baixa do NAJ as atividades de TODOS os usuários num período e a área de cada processo,
// para o painel de administrador montar relatórios por usuário e por núcleo.
// Uso: node robo/naj-relatorio.js <pasta de saída> <data inicial DD/MM/AAAA> [data final DD/MM/AAAA]
// Gera atividades.json [[dataISO, "HH:MM", minutos, usuário, cliente, número do processo, área do processo, descrição, parte contrária,
//   área jurídica da atividade, código do processo, código da atividade], ...]
// e usuarios.json (usuários que lançaram no período), areas.json e areas-atividade.json. Só pesquisa: nada é gravado no NAJ.
// Opção: --reusar-areas <processos-areas.json> (não lê a lista de processos de novo).
// As atividades vêm da consulta da tela nova de atividades; as opções antigas --cache, --semente, --paralelo e
// --reler-dias não são mais necessárias e são ignoradas.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { entrarNoNaj, espera, percorrerPaginas, abrirAtividadesNova, apiGet, apiTodas, filtroPeriodo } = require('./naj-comum');

async function entrar(browser, modulo) {
  const p = await entrarNoNaj(browser, { login: process.env.NAJ_USUARIO, senha: process.env.NAJ_SENHA });
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
  const areas = new Map();
  for (const c of procs) {
    const area = (c[5] || '').trim();
    if (area) areas.set(area, (areas.get(area) || 0) + 1);
  }
  fs.writeFileSync(path.join(saida, 'processos-areas.json'), JSON.stringify(procs.map(c => [c[1], c[2], c[3], c[4], c[5]])));
  console.log(`processos: ${procs.length}, áreas: ${areas.size}`);

  // 2) atividades de todos os usuários no período, pela consulta da tela nova de atividades (desde 11/2026).
  //    Ela já traz o código da atividade, o processo vinculado, a área jurídica, o tipo e o tempo total (com os
  //    intervalos adicionais): não é mais preciso abrir atividade por atividade. Cerca de 20 s por mês.
  const iso = br => br.split('/').reverse().join('-');
  const p = await abrirAtividadesNova(browser);
  const nomesAreas = new Map(((await apiGet(p, 'processos/areajuridica')) || []).map(a => [String(a.ID), String(a.AREA || '').trim()]));
  if (!nomesAreas.size) throw new Error('O NAJ não informou as áreas jurídicas.');
  const periodo = [iso(de), iso(ate || hojeBR)];
  const { total: esperado, linhas } = await apiTodas(p, 'atividades', { filtros: filtroPeriodo(...periodo), rotulo: 'atividades' });
  await p.context().close().catch(() => {});
  await browser.close();
  console.log(`atividades no período ${periodo.join(' a ')}: ${linhas.length} (o NAJ informa ${esperado})`);

  const areaPorCodigo = new Map(procs.map(c => [c[1], (c[5] || '').trim()]));
  const espaco = t => String(t || '').replace(/\s+/g, ' ').trim();
  const minutos = t => /^\d+:\d+/.test(t || '') ? t.split(':').slice(0, 2).reduce((h, m) => Number(h) * 60 + Number(m)) : 0;
  const atividades = linhas.map(a => {
    const codProc = a.CODIGO_PROCESSO ? String(a.CODIGO_PROCESSO) : '';
    return [
      String(a.DATA).slice(0, 10), String(a.HORA_INICIO || '').slice(0, 5), minutos(a.TEMPO), espaco(a.NOME_USUARIO),
      espaco(a.PESSOA_CLIENTE_NOME || a.NOME_CLIENTE), espaco(codProc ? (a.NUMERO_PROCESSO_NEW || a.NUMERO_PROCESSO) : ''),
      codProc ? (areaPorCodigo.get(codProc) || '') : '', espaco(a.DESCRICAO || a.HISTORICO).slice(0, 140),
      espaco(codProc ? a.NOME_ADVERSARIO : ''), nomesAreas.get(String(a.ID_AREA_JURIDICA)) || '', codProc, String(a.CODIGO),
    ];
  }).sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
  // usuários que lançaram no período (o formulário junta com a lista que já tinha)
  const usuarios = [...new Set(atividades.map(a => a[3]).filter(Boolean))].sort();
  if (!esperado || atividades.length < esperado) throw new Error(`Li ${atividades.length} atividades, mas o NAJ informa ${esperado}. Nada deve ser gravado.`);
  fs.writeFileSync(path.join(saida, 'atividades.json'), JSON.stringify(atividades));
  fs.writeFileSync(path.join(saida, 'usuarios.json'), JSON.stringify(usuarios));
  fs.writeFileSync(path.join(saida, 'areas.json'), JSON.stringify([...areas.entries()].sort((a, b) => b[1] - a[1])));
  const areasAtiv = new Map(); atividades.forEach(a => a[9] && areasAtiv.set(a[9], (areasAtiv.get(a[9]) || 0) + 1));
  fs.writeFileSync(path.join(saida, 'areas-atividade.json'), JSON.stringify([...areasAtiv.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`atividades: ${atividades.length} (com processo: ${atividades.filter(a => a[10]).length}, com área do processo: ${atividades.filter(a => a[6]).length}, com área jurídica: ${atividades.filter(a => a[9]).length}); usuários: ${usuarios.length}`);
})().catch(err => { console.error(err.message || err); process.exit(1); });
