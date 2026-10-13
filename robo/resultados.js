// Converte a saída do robô em um arquivo de atualização por lançamento, para gravar no formulário.
// Uso: node robo/resultados.js <saida.json> <pasta de atualizações>
const fs = require('fs');
const path = require('path');
const [saida, pasta] = process.argv.slice(2);
fs.mkdirSync(pasta, { recursive: true });
const agora = new Date().toISOString();
for (const r of JSON.parse(fs.readFileSync(saida, 'utf8'))) {
  const upd = {
    status: r.status === 'lancado' ? 'lancado' : 'erro',
    mensagem: r.mensagem || '',
    candidatos: r.candidatos || [],
    atualizadoEm: agora,
  };
  if (r.clienteNaj) upd.clienteNaj = r.clienteNaj;
  if (r.processoNaj) upd.processoNaj = r.processoNaj;
  if (r.codigoNaj) upd.codigoNaj = r.codigoNaj;
  if (upd.status === 'lancado') upd.lancadoEm = agora;
  fs.writeFileSync(path.join(pasta, `${r.id}.json`), JSON.stringify(upd, null, 2));
  console.log(`${r.id}: ${upd.status} - ${upd.mensagem}`);
}
