// Remonta a cópia atual dos cadastros a partir dos documentos da coleção "cadastros" do formulário, baixados com
// ArtifactData `list` + `out_dir` (arquivos clientes-N.json e processos-N.json).
// Uso: node robo/cadastros-anteriores.js <pasta com os documentos baixados> <pasta de saída>
// Gera <saída>/clientes.json e <saída>/processos.json, no mesmo formato do naj-cadastros.js (para o --anterior).
// Confere com o info.json baixado: se a soma não bater com info.clientes/info.processos, para com erro.
const fs = require('fs');
const path = require('path');
const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) { console.error('Uso: node robo/cadastros-anteriores.js <pasta baixada> <saída>'); process.exit(1); }
const ler = f => { const d = JSON.parse(fs.readFileSync(path.join(entrada, f), 'utf8')); return d.data || d; };
const info = ler('info.json');
const juntar = tipo => (info.documentos || []).filter(id => id.startsWith(tipo + '-'))
  .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
  .flatMap(id => ler(id + '.json').itens || []);
const clientes = juntar('clientes');
const processos = juntar('processos');
if (clientes.length !== info.clientes || processos.length !== info.processos) {
  console.error(`A cópia baixada não confere com o info (${clientes.length}/${info.clientes} clientes, ${processos.length}/${info.processos} processos).`);
  process.exit(1);
}
fs.mkdirSync(saida, { recursive: true });
fs.writeFileSync(path.join(saida, 'clientes.json'), JSON.stringify(clientes));
fs.writeFileSync(path.join(saida, 'processos.json'), JSON.stringify(processos));
console.log(`cópia atual: ${clientes.length} clientes, ${processos.length} processos (de ${info.atualizadoEm})`);
