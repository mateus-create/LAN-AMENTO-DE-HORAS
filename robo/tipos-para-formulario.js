// Grava o tipo de cada atividade (saída do naj-tipos.js) em documentos por mês da coleção "relatorio":
// t-AAAA-MM = { porCodigo: {código da atividade: "CF"|"PR"|"AD"}, porChave: {"AAAA-MM-DD|HH:MM|USUÁRIO": tipo}, minutos }.
// A página junta esses tipos às atividades pelo código (a[11]) ou, sem código, pela data, hora e usuário.
// Uso: node robo/tipos-para-formulario.js <tipos.json> <pasta de saída> [lista atual de info.tipos, separada por vírgula]
// Gera um JSON por mês e tipos-info.json com a lista completa para o campo "tipos" de relatorio/info.
const fs = require('fs');
const path = require('path');
const [arq, saida, atuais] = process.argv.slice(2);
if (!arq || !saida) { console.error('Uso: node robo/tipos-para-formulario.js <tipos.json> <pasta> [ids atuais]'); process.exit(1); }
const tipos = JSON.parse(fs.readFileSync(arq, 'utf8'));
fs.mkdirSync(saida, { recursive: true });
const ids = new Set((atuais || '').split(',').map(x => x.trim()).filter(Boolean));
for (const [mes, r] of Object.entries(tipos)) {
  const id = `t-${mes}`;
  fs.writeFileSync(path.join(saida, id + '.json'), JSON.stringify(r));
  ids.add(id);
  const n = Object.keys(r.porCodigo).length;
  console.log(id, n, 'atividades', fs.statSync(path.join(saida, id + '.json')).size, 'bytes');
}
fs.writeFileSync(path.join(saida, 'tipos-info.json'), JSON.stringify({ tipos: [...ids].sort() }));
console.log('info.tipos:', [...ids].sort().join(', '));
