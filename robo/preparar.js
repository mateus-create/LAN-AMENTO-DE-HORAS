// Junta os lançamentos exportados do formulário (um JSON por documento) em uma lista para o robô.
// Uso: node robo/preparar.js <pasta com os .json> <entrada.json>
const fs = require('fs');
const path = require('path');
const [pasta, saida] = process.argv.slice(2);
const itens = fs.existsSync(pasta)
  ? fs.readdirSync(pasta).filter(f => f.endsWith('.json')).map(f => ({ id: path.basename(f, '.json'), ...JSON.parse(fs.readFileSync(path.join(pasta, f), 'utf8')) }))
  : [];
const pendentes = itens.filter(i => i.status === 'pendente');
fs.writeFileSync(saida, JSON.stringify(pendentes, null, 2));
console.log(`${pendentes.length} lançamento(s) pendente(s): ${pendentes.map(i => i.id).join(', ') || '-'}`);
