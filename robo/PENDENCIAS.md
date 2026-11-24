# Situação dos robôs e pendências (atualizado em 24/11/2026)

## Estado atual
- Tudo está no branch `main`: os 11 branches de trabalho anteriores foram juntados nele em 24/11.
  Para trabalho novo, parta sempre do `main` atualizado.
- `formulario/lancamento-horas.html` é igual à versão publicada em https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf.
  Ao mudar o formulário, publique e faça commit da mesma versão (a publicada é a que vale).
- Rotinas ligadas, as duas usando o `main`:
  - lançamentos: 8h–20h a cada 2 h, dias úteis (`robo/CICLO.md`);
  - cadastros e relatório: 06:45 (rápido + relatório + tipos) e 12:45 (completo), dias úteis (`robo/CADASTROS.md`).
- Logins do NAJ testados em 24/11 com `--testar-login`: mateus, luan, felipe e tributario aceitos.
- Formulário atualizado em 24/11 com os robôs novos: 4.940 clientes, 1.405 processos ativos, relatório de 01/10 a 24/11,
  tipos de hora de julho a novembro.

## Tela nova de atividades do NAJ (desde 19/11/2026)
- Controles → Atividades agora abre a aplicação nova do NAJ (`.../naj-adv-web/public/naj/atividades`). A "Nova Atividade"
  fica no botão de três pontos acima da lista, numa janela com campos de id fixo (`codigo_cliente`, `codigo_processo`,
  `id_tipo_atividade`, `id_area_juridica`, `historico`, `data`, `hora_inicio`, `hora_termino`, botão `#gravar-atividade`).
- A aplicação nova tem consultas paginadas em JSON, usadas pelos robôs (helpers em `robo/naj-comum.js`:
  `abrirAtividadesNova`, `apiGet`, `apiTodas`, `filtroPeriodo`):
  - `naj-lancar.js`: preenche e grava a janela nova; cliente por nome e processo por número pelas consultas
    `pessoas/getPessoasFilter` e `processos/getProcessosFilter`;
  - `naj-cadastros.js`: clientes por `pessoas/paginate` (divisões liberadas, situação Ativo/Inativo), cerca de 80 s;
  - `naj-relatorio.js`: atividades por `atividades/paginate` (código, processo, área jurídica e tempo), cerca de 20 s por mês;
  - `naj-tipos.js`: tipo de cada atividade pela mesma consulta, sem PDF.
- O módulo Processos e Relatórios → Atividades continuam na tela antiga e não mudaram; a lista de processos e a área de
  cada processo seguem sendo lidas do módulo Processos.
- Regras novas do NAJ: não existe mais "Disponível ao Cliente" (o campo do formulário é ignorado); com processo, o NAJ trava
  a área jurídica na área do processo — o robô lança assim e avisa na mensagem se ela for diferente da escolhida.
- A tela antiga mandava nomes de usuário e de algumas áreas com espaço não separável; a consulta nova manda espaço normal.
  `relatorio-para-formulario.js` normaliza os nomes antigos ao juntar com o `info` atual.

## A acompanhar
- O primeiro lançamento real pela rotina é o primeiro uso do botão Gravar da tela nova (o preenchimento foi testado com
  `--teste`). Conferir no NAJ se a atividade apareceu certa.
- Meses de julho a setembro no formulário ainda têm áreas jurídicas com espaço não separável (vieram da tela antiga).
  Só importa se essas áreas forem ligadas a um núcleo; nesse caso, rode o relatório desde julho para regravar esses meses.

## Custos
- Rotinas em sessão nova custam ~US$ 0,13 (lançamentos) e ~US$ 0,22–0,50 (cadastros/relatório) por execução.
- O que mais gasta: conversas longas e rotina que reabre a mesma sessão (persistente) — cada execução relê todo o
  histórico. Para trabalho novo, abra uma conversa nova a partir do `main`.
