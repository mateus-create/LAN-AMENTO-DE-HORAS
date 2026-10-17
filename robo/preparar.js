// Junta os lançamentos pendentes de todas as pessoas (exportados do formulário) em uma lista para o robô,
// com o login do NAJ de cada pessoa e o nome da variável de ambiente que guarda a senha dela.
// Uso: node robo/preparar.js <pasta exportada> <entrada.json>
// A pasta exportada tem: equipe/<id>.json (pessoas), equipe/<id>/lancamentos/<doc>.json, config/membros.json e config/robo.json.
const fs = require('fs');
const path = require('path');
const [pasta, saida] = process.argv.slice(2);
const ler = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const varSenha = login => 'NAJ_SENHA_' + login.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const cfgArq = path.join(pasta, 'config', 'membros.json');
const membros = fs.existsSync(cfgArq) ? (ler(cfgArq).pessoas || {}) : {};
// outras contas do próprio dono (ex.: conta pessoal): lançam como o dono, com a senha principal
const roboArq = path.join(pasta, 'config', 'robo.json');
const contasDoDono = new Set(fs.existsSync(roboArq) ? (ler(roboArq).contasDoDono || []) : []);
const itens = [];
const dirEquipe = path.join(pasta, 'equipe');
if (fs.existsSync(dirEquipe)) {
  for (const uid of fs.readdirSync(dirEquipe)) {
    const dirLanc = path.join(dirEquipe, uid, 'lancamentos');
    if (!fs.existsSync(dirLanc)) continue;
    const perfilArq = path.join(dirEquipe, uid + '.json');
    const dono = contasDoDono.has(uid) || (fs.existsSync(perfilArq) && ler(perfilArq).dono === true);
    const cfg = membros[uid] || {};
    for (const f of fs.readdirSync(dirLanc).filter(f => f.endsWith('.json'))) {
      const e = { id: path.basename(f, '.json'), uid, colecao: `equipe/${uid}/lancamentos`, ...ler(path.join(dirLanc, f)) };
      if (e.status !== 'pendente') continue;
      if (cfg.najLogin) { e.najLogin = cfg.najLogin; e.senhaVar = dono && !process.env[varSenha(cfg.najLogin)] ? 'NAJ_SENHA' : varSenha(cfg.najLogin); }
      else if (!dono) e.erroConfig = 'O administrador ainda não ligou você ao seu usuário do NAJ (aba Equipe → Pessoas).';
      itens.push(e);
    }
  }
}
fs.writeFileSync(saida, JSON.stringify(itens, null, 2));
console.log(`${itens.length} lançamento(s) pendente(s): ${itens.map(i => `${i.colecao}/${i.id}${i.erroConfig ? ' (sem configuração)' : ''}`).join(', ') || '-'}`);
