# Pendências (diagnóstico de 26/10/2026)

As duas rotinas (lançamentos e cadastros/relatório) estão DESLIGADAS até estas correções.

## 1. Lançamentos do Luan: todos com erro
- 18 lançamentos (06/10 a 22/10) terminaram com "Falha técnica no robô: page.waitForSelector: Timeout 30000ms exceeded."
- Onde: `robo/naj-lancar.js`, função `entrar()`, na espera por `button.button-acessar-adv` logo depois de Entrar,
  ou seja, o NAJ não aceitou o login/senha do Luan (ou mostrou outra tela). O mesmo lançamento com o login do dono funciona (teste sem gravar).
- Correção a fazer: detectar login recusado e dizer isso com clareza ("login/senha do NAJ de X recusado"), guardar print da tela
  quando falhar, testar o login uma vez por pessoa antes do lote (se falhar, marcar os itens dela com essa mensagem sem tentar um por um),
  e um teste de credencial ao cadastrar cada pessoa nova. A senha (`NAJ_SENHA_LUAN_MKS_ADV_BR`) só é visível em sessões novas.
- Depois: devolver os 18 itens do Luan para `pendente` (com o OK do Mateus).

## 2. Cadastros: o download de clientes traz só 15
- `node robo/naj-cadastros.js` em 26/10: "clientes: 15" (antes ~4.920); processos ativos OK (1412 = NAJ).
- Onde: laço de clientes em `robo/naj-cadastros.js` (combo `#TIWCOMBOBOX6`, busca `#TIWGRADBUTTON7`, paginação `#TIWEDIT9`/`#TIWEDIT10`).
  Provável mudança na tela de pesquisa de clientes do NAJ (paginação ou filtro). A conferência impediu gravar: o formulário segue com a cópia de 22/10.
- Correção a fazer: achar o novo seletor/paginação e o robô recusar sozinho uma lista de clientes menor que 98% da anterior.

## 3. Relatório diário: parado desde 22/10
- Causa ainda não verificada (provavelmente a mesma falha de cadastros ou a sessão do NAJ).

## Custos
- Rotinas em sessão nova custam ~US$ 0,13 (lançamentos) e ~US$ 0,22–0,50 (cadastros/relatório) por execução.
- Novos horários: lançamentos 8h–20h a cada 2 h (7/dia, com saída rápida sem clonar quando não há pendentes);
  cadastros 06:45 e 12:45 (relatório só às 06:45).
- O que mais gasta: conversas longas (esta sessão e a sessão ROTINA, ~US$ 190–240 cada) e rotina que reabre a mesma sessão
  (persistente) — cada execução relê todo o histórico. Para trabalho novo, abra uma conversa nova.
