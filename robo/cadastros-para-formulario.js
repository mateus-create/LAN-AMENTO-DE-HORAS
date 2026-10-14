// Divide clientes.json e processos.json em documentos de até ~150 KB para a coleção "cadastros" do formulário.
// Uso: node robo/cadastros-para-formulario.js <pasta com clientes.json e processos.json> <pasta de saída>
// Saída: um JSON por documento (clientes-1.json, processos-1.json, ..., info.json) para gravar com ArtifactData.
const fs = require('fs');
const path = require('path');
const [entrada, saida] = process.argv.slice(2);
fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(saida, { recursive: true });

function partes(tipo, itens, tamanho) {
  const ids = [];
  for (let i = 0; i * tamanho < itens.length; i++) {
    const id = `${tipo}-${i + 1}`;
    fs.writeFileSync(path.join(saida, `${id}.json`), JSON.stringify({ tipo, itens: itens.slice(i * tamanho, (i + 1) * tamanho) }));
    ids.push(id);
  }
  return ids;
}

const clientes = JSON.parse(fs.readFileSync(path.join(entrada, 'clientes.json'), 'utf8'));
const processos = JSON.parse(fs.readFileSync(path.join(entrada, 'processos.json'), 'utf8'));
const docs = [...partes('clientes', clientes, 2000), ...partes('processos', processos, 900)];
fs.writeFileSync(path.join(saida, 'info.json'), JSON.stringify({
  atualizadoEm: new Date().toISOString(), clientes: clientes.length, processos: processos.length, documentos: docs,
}));
for (const f of fs.readdirSync(saida)) console.log(f, fs.statSync(path.join(saida, f)).size, 'bytes');
