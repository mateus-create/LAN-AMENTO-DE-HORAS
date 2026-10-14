// Converte a saída do robô em um arquivo de atualização por lançamento, para gravar no formulário.
// Uso: node robo/resultados.js <entrada.json> <saida.json> <pasta de atualizações>
// Gera <pasta>/<uid>__<id>.json e lista a coleção e o documento de cada um.
const fs = require('fs');
const path = require('path');
const [entrada, saida, pasta] = process.argv.slice(2);
fs.mkdirSync(pasta, { recursive: true });
const porId = Object.fromEntries(JSON.parse(fs.readFileSync(entrada, 'utf8')).map(e => [e.id, e]));
const agora = new Date().toISOString();
for (const r of JSON.parse(fs.readFileSync(saida, 'utf8'))) {
  const e = porId[r.id] || {};
  const upd = { status: r.status === 'lancado' ? 'lancado' : 'erro', mensagem: r.mensagem || '', candidatos: r.candidatos || [], atualizadoEm: agora };
  if (r.clienteNaj) upd.clienteNaj = r.clienteNaj;
  if (r.processoNaj) upd.processoNaj = r.processoNaj;
  if (r.codigoNaj) upd.codigoNaj = r.codigoNaj;
  if (upd.status === 'lancado') upd.lancadoEm = agora;
  const arq = path.join(pasta, `${e.uid || 'sem'}__${r.id}.json`);
  fs.writeFileSync(arq, JSON.stringify(upd, null, 2));
  console.log(`${e.colecao} / ${r.id}: ${upd.status} - ${upd.mensagem}  [${arq}]`);
}
