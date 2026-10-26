# Pendências (diagnóstico de 26/10/2026)

As duas rotinas (lançamentos e cadastros/relatório) estão DESLIGADAS. Correções de código feitas em 26/10 (abaixo).

## 1. Lançamentos do Luan: todos com erro — causa confirmada, robô corrigido; falta a senha
- Causa (26/10): o NAJ responde `401 "Não autorizado"` ao login `luan@mks.adv.br` com a senha de `NAJ_SENHA_LUAN_MKS_ADV_BR`.
  A senha guardada no ambiente está errada (não há espaço nem aspas sobrando; o login do dono funciona).
- Feito no robô (`robo/naj-comum.js`, `robo/naj-lancar.js`):
  - login recusado vira a mensagem "O NAJ recusou o login/senha de X ... Confira a senha cadastrada para essa pessoa.";
  - uma única tentativa por pessoa no lote: os outros itens dela recebem a mesma mensagem sem nova tentativa;
  - todo erro guarda print da tela em `<prints>/<id>-erro.png` (campo `print` do resultado);
  - teste de credencial: `node robo/naj-lancar.js --testar-login <login> <NAJ_SENHA_...>` (passo 1 do `CICLO.md`).
- **Falta (Mateus):** corrigir o valor de `NAJ_SENHA_LUAN_MKS_ADV_BR` nas variáveis do ambiente, confirmar com
  `--testar-login luan@mks.adv.br NAJ_SENHA_LUAN_MKS_ADV_BR` em uma sessão nova e só então devolver os 18 itens do Luan para `pendente`.

## 2. Cadastros: o download de clientes trazia só 15 — corrigido
- Causa: o NAJ acrescentou uma janela de pesquisa nova à tela "Nova Atividade" e renumerou os campos. A janela de clientes
  passou de `#TIWEDIT8/9/10` para `#TIWEDIT10/11/12`; o robô lia o total de páginas de um campo vazio e lia só a 1ª página
  de cada situação (10 ativos + 5 inativos = 15). A mesma mudança quebrava, no `naj-lancar.js`, a busca de cliente por nome
  (`#TIWEDIT8`) e de processo por número (`#TIWEDIT14`).
- Feito: as janelas de pesquisa são achadas pelo conteúdo (`janelaPesquisa` em `robo/naj-comum.js`) e o campo
  "Número do Processo" pelo rótulo ao lado dele, sem ids fixos. O `naj-cadastros.js` confere cada situação com o
  "Total de: N Registro(s)" do NAJ e recusa sozinho uma lista menor que 98% dele ou de `--clientes-antes <N>`.
- Testado sem gravar no NAJ: cliente por nome e processo por número preenchem a tela (`--teste`).
- Download completo em teste (26/10).

## 3. Relatório diário: parado desde 22/10
- Os campos usados pelo relatório (lista de atividades e módulo Processos) não mudaram; teste em andamento.

## Para religar as rotinas
- Cadastros/relatório: podem voltar (passar `--clientes-antes` com o total de `cadastros/info`, ver `CADASTROS.md`).
- Lançamentos: podem voltar; os itens do Luan só depois da senha corrigida (item 1).

## Custos
- Rotinas em sessão nova custam ~US$ 0,13 (lançamentos) e ~US$ 0,22–0,50 (cadastros/relatório) por execução.
- Novos horários: lançamentos 8h–20h a cada 2 h (7/dia, com saída rápida sem clonar quando não há pendentes);
  cadastros 06:45 e 12:45 (relatório só às 06:45).
- O que mais gasta: conversas longas (esta sessão e a sessão ROTINA, ~US$ 190–240 cada) e rotina que reabre a mesma sessão
  (persistente) — cada execução relê todo o histórico. Para trabalho novo, abra uma conversa nova.
