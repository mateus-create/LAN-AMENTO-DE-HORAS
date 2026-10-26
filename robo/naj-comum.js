// Partes comuns aos robôs do NAJ: entrada no sistema e localização das janelas de pesquisa.
const espera = ms => new Promise(r => setTimeout(r, ms));

class ErroLogin extends Error {
  constructor(mensagem) { super(mensagem); this.name = 'ErroLogin'; }
}

// Abre uma sessão do NAJ e para logo depois da segunda senha (#btentrar), antes de escolher o módulo.
// Login/senha recusados viram ErroLogin com uma mensagem clara; com printErro, guarda um print da tela quando falha.
async function entrarNoNaj(browser, cred, { printErro } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  // conta requisições em andamento: o NAJ responde a cada campo com uma chamada ao servidor
  p.pendentes = 0;
  p.on('request', () => p.pendentes++);
  p.on('requestfinished', () => p.pendentes--);
  p.on('requestfailed', () => p.pendentes--);
  try {
    await p.goto(process.env.NAJ_URL, { waitUntil: 'networkidle' });
    await p.fill('#login', cred.login);
    await p.fill('#password', cred.senha);
    // a tela de login fica parada quando a senha é recusada; a resposta da API diz o motivo ({status_code: 401, naj: {mensagem}})
    const resposta = p.waitForResponse(r => /\/auth\/login/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
    await p.click('button:has-text("Entrar")');
    const corpo = await (await resposta)?.json().catch(() => null);
    if (corpo && Number(corpo.status_code) >= 400) {
      throw new ErroLogin(`O NAJ recusou o login/senha de ${cred.login} ("${corpo.naj?.mensagem || corpo.status_code}"). Confira a senha cadastrada para essa pessoa.`);
    }
    await p.waitForSelector('button.button-acessar-adv').catch(() => {
      throw new ErroLogin(`Depois do login de ${cred.login} o NAJ não mostrou a tela de escolha da advocacia (senha recusada ou outra tela).`);
    });
    await espera(500);
    await p.click('button.button-acessar-adv');
    await p.waitForURL(/najgestaoweb/, { timeout: 30000 });
    await p.waitForLoadState('networkidle').catch(() => {});
    await espera(3000);
    const ok = p.locator('button:visible:has-text("OK")');
    if (await ok.count()) await ok.first().click();
    await p.fill('#txtsenha', cred.senha);
    await p.click('#btentrar');
    await p.waitForLoadState('networkidle').catch(() => {});
    await espera(5000);
    return p;
  } catch (err) {
    if (printErro) await p.screenshot({ path: printErro }).catch(() => {});
    await ctx.close().catch(() => {});
    throw err;
  }
}

// Campos de uma janela de pesquisa (clientes, processos...), achada pelo texto que só ela tem.
// Os ids TIWEDITn mudam quando o NAJ acrescenta janelas à tela, então não podem ficar fixos no código.
// Na janela, os dois primeiros campos são a paginação (página atual, total de páginas) e os seguintes, os de busca;
// rotulos liga o texto ao lado de cada campo ao seu id.
async function janelaPesquisa(p, marca) {
  const j = await p.$$eval('input[value=Pesquisar]', (bts, marca) => {
    for (const bt of bts) {
      const jan = bt.closest('[id^=RGJANELA]');
      if (!jan || !jan.textContent.replace(/\s+/g, ' ').includes(marca)) continue;
      const eds = [...jan.querySelectorAll('input[id^=TIWEDIT]')].map(e => '#' + e.id);
      // rótulo de cada campo = texto mais próximo à esquerda dele, na mesma linha da tela (os rótulos são posicionados,
      // não ficam ao lado do campo no HTML). Só funciona com a janela aberta.
      const rotulos = {};
      const textos = [...jan.querySelectorAll('span')].filter(x => !x.children.length && x.textContent.trim()).map(x => [x.textContent.trim().replace(/:$/, ''), x.getBoundingClientRect()]);
      for (const ed of jan.querySelectorAll('input[id^=TIWEDIT]')) {
        const r = ed.getBoundingClientRect();
        const meio = (r.top + r.bottom) / 2;
        const perto = textos.filter(([, t]) => t.width && t.right <= r.left + 2 && t.top <= meio && t.bottom >= meio).sort((x, y) => y[1].right - x[1].right)[0];
        if (perto) rotulos[perto[0]] = '#' + ed.id;
      }
      return { botao: '#' + bt.id, pagina: eds[0], total: eds[1], busca: eds.slice(2), rotulos, combo: (s => s && '#' + s.id)(jan.querySelector('select[id^=TIWCOMBOBOX]')) };
    }
    return null;
  }, marca);
  if (!j || j.busca.length < 1) throw new Error(`Não achei a janela de pesquisa "${marca}" no NAJ (a tela pode ter mudado).`);
  return j;
}

module.exports = { ErroLogin, entrarNoNaj, janelaPesquisa, espera };
