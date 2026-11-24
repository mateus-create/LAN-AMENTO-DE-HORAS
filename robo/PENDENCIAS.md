# Pendências (diagnóstico de 26/10/2026)

## 0. Tela nova de atividades do NAJ (19/11/2026) — lançamento adaptado
- O NAJ trocou a tela de atividades: agora é `.../naj-adv-web/public/naj/atividades`, e a "Nova Atividade" fica no botão
  de três pontos acima da lista. A janela tem campos de id fixo (`codigo_cliente`, `codigo_processo`, `id_tipo_atividade`,
  `id_area_juridica`, `historico`, `data`, `hora_inicio`, `hora_termino`, botão `#gravar-atividade`).
- `robo/naj-lancar.js` reescrito para essa tela. Cliente por nome e processo por número usam as mesmas consultas da tela
  (`pessoas/getPessoasFilter`, `processos/getProcessosFilter`). Testado sem gravar (`--teste`): código e número de processo,
  código e nome de cliente, cliente inexistente. O clique em Gravar ainda não foi exercido com uma atividade real.
- Mudanças de regra do NAJ: não existe mais "Disponível ao Cliente" (o campo do formulário é ignorado); com processo,
  o NAJ trava a área jurídica na área do processo — o robô lança assim e avisa na mensagem se ela for diferente da escolhida.
- 24/11: os outros robôs também passaram para a tela nova (consultas `pessoas/paginate` e `atividades/paginate`, helpers em
  `robo/naj-comum.js`): clientes do `naj-cadastros.js`, atividades do `naj-relatorio.js` e tipos do `naj-tipos.js` (sem PDF).
  O módulo Processos não mudou e continua sendo lido como antes (lista de processos e área de cada processo).
  Conferido contra o formulário: clientes iguais código a código (+1 cadastrado no dia), outubro com as mesmas 910 atividades,
  tipos de jul–nov com todas as atividades que o formulário tinha (mais as que o PDF deixava de fora).

As duas rotinas (lançamentos e cadastros/relatório) estão DESLIGADAS. Correções de código feitas em 26/10 (abaixo).

- 24/11: formulário atualizado com os robôs novos (4.940 clientes, 1.405 processos ativos; relatório de 01/10 a 24/11;
  tipos de jul–nov). As rotinas de lançamento e de cadastros/relatório estão ligadas e apontam para o branch
  `claude/wizardly-ramanujan-yiqfw5` (o main ainda tem os robôs da tela antiga). Quando esse branch entrar no main,
  voltar as duas rotinas para `main`. O primeiro lançamento real da rotina é o primeiro uso do botão Gravar da tela nova.

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
- Download real em 26/10: clientes ativos 4.923 (o NAJ informa 4.923), contra 15 antes da correção.

## 3. Relatório diário: parado desde 22/10
- Os campos usados pelo relatório (lista de atividades e módulo Processos) não mudaram com a renumeração; a parada
  coincide com a falha dos cadastros na mesma rotina das 06:45. Conferir na primeira execução depois de religar.

## Para religar as rotinas
- Cadastros/relatório: podem voltar (passar `--clientes-antes` com o total de `cadastros/info`, ver `CADASTROS.md`).
- Lançamentos: podem voltar; os itens do Luan só depois da senha corrigida (item 1).

## Custos
- Rotinas em sessão nova custam ~US$ 0,13 (lançamentos) e ~US$ 0,22–0,50 (cadastros/relatório) por execução.
- Novos horários: lançamentos 8h–20h a cada 2 h (7/dia, com saída rápida sem clonar quando não há pendentes);
  cadastros 06:45 e 12:45 (relatório só às 06:45).
- O que mais gasta: conversas longas (esta sessão e a sessão ROTINA, ~US$ 190–240 cada) e rotina que reabre a mesma sessão
  (persistente) — cada execução relê todo o histórico. Para trabalho novo, abra uma conversa nova.
