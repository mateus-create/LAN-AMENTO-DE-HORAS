// Divide as atividades baixadas do NAJ em documentos por mês (coleção "relatorio" do formulário).
// Uso: node robo/relatorio-para-formulario.js <pasta do naj-relatorio> <info atual.json ou -> <pasta de saída>
// Os meses baixados agora substituem os mesmos meses no formulário; os outros meses são mantidos
// (assim dá para acrescentar meses antigos sem perder os recentes).
// Gera um JSON por documento, info.json e apagar.json (documentos antigos dos meses substituídos).
const fs = require('fs');
const path = require('path');
const [entrada, infoAtualArq, saida] = process.argv.slice(2);
fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(saida, { recursive: true });
const ler = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const atividades = ler(path.join(entrada, 'atividades.json'));
const infoAtual = infoAtualArq && infoAtualArq !== '-' && fs.existsSync(infoAtualArq) ? ler(infoAtualArq) : { documentos: [] };
const porMes = {};
for (const a of atividades) (porMes[a[0].slice(0, 7)] ||= []).push(a);
const meses = Object.keys(porMes).sort();
const novos = [];
for (const m of meses) {
  const lista = porMes[m].sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
  for (let i = 0; i * 700 < lista.length; i++) {
    const id = `m-${m}-${i + 1}`;
    fs.writeFileSync(path.join(saida, id + '.json'), JSON.stringify({ itens: lista.slice(i * 700, (i + 1) * 700) }));
    novos.push(id);
  }
}
const mesDe = id => id.slice(2, 9);
const mantidos = (infoAtual.documentos || []).filter(id => !meses.includes(mesDe(id)));
const apagar = (infoAtual.documentos || []).filter(id => meses.includes(mesDe(id)) && !novos.includes(id));
// áreas jurídicas dos meses mantidos continuam na lista (para o mapa de núcleos)
const juntarAreas = (novas, antigas) => [...novas, ...antigas.filter(([n]) => !novas.some(([x]) => x === n))];
const datas = atividades.map(a => a[0]).sort();
fs.writeFileSync(path.join(saida, 'info.json'), JSON.stringify({
  de: [infoAtual.de, datas[0]].filter(Boolean).sort()[0] || null,
  ate: [infoAtual.ate, datas[datas.length - 1]].filter(Boolean).sort().pop() || null,
  atualizadoEm: new Date().toISOString(),
  documentos: [...mantidos, ...novos].sort(),
  usuarios: [...new Set([...(infoAtual.usuarios || []), ...ler(path.join(entrada, 'usuarios.json'))])].sort(),
  areas: ler(path.join(entrada, 'areas.json')),
  areasAtividade: juntarAreas(fs.existsSync(path.join(entrada, 'areas-atividade.json')) ? ler(path.join(entrada, 'areas-atividade.json')) : [], infoAtual.areasAtividade || []),
}));
fs.writeFileSync(path.join(saida, 'apagar.json'), JSON.stringify(apagar));
for (const f of fs.readdirSync(saida)) console.log(f, fs.statSync(path.join(saida, f)).size, 'bytes');
console.log('apagar:', apagar.join(', ') || '-');
