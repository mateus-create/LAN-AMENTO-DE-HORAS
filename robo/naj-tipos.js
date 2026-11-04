// Tipo de cada atividade do NAJ (Contratos Fixos, Proposta Fechada, Horas Administrativas), mês a mês.
// A lista de atividades não mostra o tipo; o relatório "Relatórios → Atividades" (analítico) filtra por tipo e
// mostra o código de cada atividade. Um relatório por tipo e por mês, só leitura: nada é gravado no NAJ.
// Uso: node robo/naj-tipos.js <pasta de saída> <mês inicial AAAA-MM> [mês final AAAA-MM]
// Gera <pasta>/tipos.json: { "AAAA-MM": { porCodigo: {código: tipo}, porChave: {"AAAA-MM-DD|HH:MM|USUÁRIO": tipo},
//   minutos: {tipo: minutos} } } com tipo = "CF" | "PR" | "AD". Precisa do pdftotext (poppler-utils).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { entrarNoNaj, espera } = require('./naj-comum');

const TIPOS = { CF: '100', PR: '200', AD: '300' };
const NOMES = { CF: 'CONTRATOS FIXOS', PR: 'PROPOSTA FECHADA', AD: 'HORAS ADMINISTRATIVAS (MKS)' };
const doisDig = n => String(n).padStart(2, '0');

// Lê o texto do PDF do relatório: cada atividade começa em "Usuário: NOME   Código Atividade: N".
function lerPdf(arq) {
  const txt = execFileSync('pdftotext', ['-layout', arq, '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const itens = [];
  for (const bloco of txt.split(/(?=^\s*Usuário:\s)/m).slice(1)) {
    const cod = (bloco.match(/Código Atividade:\s*(\d+)/) || [])[1];
    const usuario = ((bloco.match(/^\s*Usuário:\s*(.+?)(?:\s{2,}|\s*Código Atividade|$)/m) || [])[1] || '').trim();
    const dh = bloco.match(/Data Atividade:\s*(\d{2})\/(\d{2})\/(\d{4})\s*Hora Início:\s*(\d{2}:\d{2})/);
    const tempo = (bloco.match(/Tempo Total:\s*(\d+):(\d{2})/) || []);
    if (!cod) continue;
    itens.push({ cod, usuario, data: dh ? `${dh[3]}-${dh[2]}-${dh[1]}` : '', hora: dh ? dh[4] : '', min: tempo[1] ? Number(tempo[1]) * 60 + Number(tempo[2]) : 0 });
  }
  return itens;
}

(async () => {
  const [saida, mesIni, mesFimArg] = process.argv.slice(2);
  if (!saida || !/^\d{4}-\d{2}$/.test(mesIni || '')) { console.error('Uso: node robo/naj-tipos.js <pasta> <AAAA-MM> [AAAA-MM]'); process.exit(1); }
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { console.error('Falta o pdftotext (instale poppler-utils).'); process.exit(1); }
  const agora = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  const mesFim = /^\d{4}-\d{2}$/.test(mesFimArg || '') ? mesFimArg : agora;
  const meses = [];
  for (let [a, m] = mesIni.split('-').map(Number); `${a}-${doisDig(m)}` <= mesFim; m === 12 ? (a++, m = 1) : m++) meses.push(`${a}-${doisDig(m)}`);
  fs.mkdirSync(path.join(saida, 'pdf'), { recursive: true });

  const browser = await chromium.launch();
  // depois de gerar um PDF a tela do NAJ trava (some o menu): cada relatório usa uma sessão nova
  let p = null;
  const quieto = async () => { await espera(300); for (let i = 0; i < 200 && p.pendentes > 0; i++) await espera(100); await espera(500); };
  async function abrirTela() {
    if (p) await p.context().close().catch(() => {});
    p = await entrarNoNaj(browser, { login: process.env.NAJ_USUARIO, senha: process.env.NAJ_SENHA });
    await p.locator('text="Relatórios"').first().click();
    await espera(1500);
    await p.locator('text="Atividades"').last().click();
    await espera(5000);
  }

  const resultado = {};
  for (const mes of meses) {
    const [a, m] = mes.split('-').map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    const r = resultado[mes] = { porCodigo: {}, porChave: {}, minutos: {} };
    for (const [tipo, cod] of Object.entries(TIPOS)) {
      await abrirTela();
      await p.fill('#EDCODTIPO', cod); await p.press('#EDCODTIPO', 'Tab'); await quieto();
      const nome = await p.inputValue('#EDTIPO');
      if (nome.trim().toUpperCase() !== NOMES[tipo]) throw new Error(`O código de tipo ${cod} no NAJ agora é "${nome}" (esperado ${NOMES[tipo]}).`);
      await p.fill('#EDDATACADASTROINI', `01/${doisDig(m)}/${a}`); await p.press('#EDDATACADASTROINI', 'Tab'); await quieto();
      await p.fill('#EDDATACADASTROFIM', `${ultimo}/${doisDig(m)}/${a}`); await p.press('#EDDATACADASTROFIM', 'Tab'); await quieto();
      await p.check('#IWRADIOGROUP1_INPUT_2'); await quieto(); // Analítico (o sintético não traz o código da atividade)
      const arq = path.join(saida, 'pdf', `${mes}-${tipo}.pdf`);
      // o NAJ gera o PDF em /files/Relatorio_idN.pdf; às vezes como download, às vezes numa aba nova
      const pdfUrl = new Promise(res => {
        const ver = r => { if (/\/files\/Relatorio_id\d+\.pdf/i.test(r.url())) { p.context().off('response', ver); res(r.url()); } };
        p.context().on('response', ver);
        setTimeout(() => { p.context().off('response', ver); res(null); }, 90000);
      });
      p.once('download', () => {});
      await p.click('#IWBUTTON1');
      const url = await pdfUrl;
      for (const aba of p.context().pages()) if (aba !== p) await aba.close().catch(() => {});
      let itens = [];
      if (url) {
        const resp = await p.context().request.get(url);
        fs.writeFileSync(arq, await resp.body());
        itens = lerPdf(arq);
      } else {
        await p.screenshot({ path: arq.replace(/\.pdf$/, '-sem-pdf.png') });
        throw new Error(`O NAJ não gerou o relatório de ${NOMES[tipo]} de ${mes} (print em ${arq.replace(/\.pdf$/, '-sem-pdf.png')}).`);
      }
      for (const it of itens) {
        r.porCodigo[it.cod] = tipo;
        if (it.data && it.hora && it.usuario) r.porChave[`${it.data}|${it.hora}|${it.usuario}`] = tipo;
        r.minutos[tipo] = (r.minutos[tipo] || 0) + it.min;
      }
      console.log(`${mes} ${NOMES[tipo]}: ${itens.length} atividades`);
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(saida, 'tipos.json'), JSON.stringify(resultado));
  console.log(`tipos.json: ${meses.length} meses`);
})().catch(e => { console.error(e.message); process.exit(1); });
