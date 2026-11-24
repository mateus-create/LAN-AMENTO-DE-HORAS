// Tipo de cada atividade do NAJ (Contratos Fixos, Proposta Fechada, Horas Administrativas), mês a mês.
// Desde 11/2026 a consulta da tela nova de atividades traz o tipo de cada atividade (ID_TIPO_ATIVIDADE); antes era
// preciso gerar o relatório "Relatórios → Atividades" em PDF, um por tipo e por mês. Só leitura: nada é gravado no NAJ.
// Uso: node robo/naj-tipos.js <pasta de saída> <mês inicial AAAA-MM> [mês final AAAA-MM]
// Gera <pasta>/tipos.json: { "AAAA-MM": { porCodigo: {código: tipo}, porChave: {"AAAA-MM-DD|HH:MM|USUÁRIO": tipo},
//   minutos: {tipo: minutos} } } com tipo = "CF" | "PR" | "AD". Atividades sem tipo ficam de fora (como no relatório antigo).
// O mês de cada atividade é o da data da atividade. Cerca de 20 s por mês.
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { abrirAtividadesNova, apiGet, apiTodas, filtroPeriodo } = require('./naj-comum');

const NOMES = { CF: 'CONTRATOS FIXOS', PR: 'PROPOSTA FECHADA', AD: 'HORAS ADMINISTRATIVAS (MKS)' };
const doisDig = n => String(n).padStart(2, '0');
const espaco = t => String(t || '').replace(/\s+/g, ' ').trim();
const minutos = t => /^\d+:\d+/.test(t || '') ? t.split(':').slice(0, 2).reduce((h, m) => Number(h) * 60 + Number(m)) : 0;

(async () => {
  const [saida, mesIni, mesFimArg] = process.argv.slice(2);
  if (!saida || !/^\d{4}-\d{2}$/.test(mesIni || '')) { console.error('Uso: node robo/naj-tipos.js <pasta> <AAAA-MM> [AAAA-MM]'); process.exit(1); }
  const agora = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  const mesFim = /^\d{4}-\d{2}$/.test(mesFimArg || '') ? mesFimArg : agora;
  const meses = [];
  for (let [a, m] = mesIni.split('-').map(Number); `${a}-${doisDig(m)}` <= mesFim; m === 12 ? (a++, m = 1) : m++) meses.push(`${a}-${doisDig(m)}`);
  fs.mkdirSync(saida, { recursive: true });

  const browser = await chromium.launch();
  const p = await abrirAtividadesNova(browser);
  // código do NAJ de cada tipo, conferido pelo nome (se o NAJ mudar os tipos, para em vez de classificar errado)
  const tiposNaj = (await apiGet(p, 'processos/atividades/tipos/getallatividadestipos')) || [];
  const tipoPorId = {};
  for (const [sigla, nome] of Object.entries(NOMES)) {
    const t = tiposNaj.find(x => espaco(x.ATIVIDADE).toUpperCase() === nome);
    if (!t) throw new Error(`O tipo de atividade "${nome}" não existe mais no NAJ (tipos atuais: ${tiposNaj.map(x => x.ATIVIDADE).join(', ')}).`);
    tipoPorId[String(t.ID)] = sigla;
  }

  const resultado = {};
  for (const mes of meses) {
    const [a, m] = mes.split('-').map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    const { linhas } = await apiTodas(p, 'atividades', { filtros: filtroPeriodo(`${mes}-01`, `${mes}-${doisDig(ultimo)}`), rotulo: `atividades ${mes}` });
    const r = resultado[mes] = { porCodigo: {}, porChave: {}, minutos: {} };
    let semTipo = 0;
    for (const x of linhas) {
      const tipo = tipoPorId[String(x.ID_TIPO_ATIVIDADE)];
      if (!tipo) { semTipo++; continue; }
      r.porCodigo[String(x.CODIGO)] = tipo;
      const usuario = espaco(x.NOME_USUARIO);
      if (usuario) r.porChave[`${String(x.DATA).slice(0, 10)}|${String(x.HORA_INICIO || '').slice(0, 5)}|${usuario}`] = tipo;
      r.minutos[tipo] = (r.minutos[tipo] || 0) + minutos(x.TEMPO);
    }
    const n = s => Object.values(r.porCodigo).filter(t => t === s).length;
    console.log(`${mes}: ${linhas.length} atividades — CF ${n('CF')}, PR ${n('PR')}, AD ${n('AD')}, sem tipo ${semTipo}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(saida, 'tipos.json'), JSON.stringify(resultado));
  console.log(`tipos.json: ${meses.length} meses`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
