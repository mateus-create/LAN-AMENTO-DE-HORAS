# Lançamento de horas no NAJ

Situação atual, rotinas e pendências: `robo/PENDENCIAS.md` (comece por ele). Todo trabalho parte do branch `main`.

- `formulario/lancamento-horas.html`: formulário (publicado em https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf; o arquivo é igual à versão publicada).
- `robo/naj-lancar.js`: robô que entra no NAJ e cria a atividade em Controles → Atividades → botão de três pontos → Nova Atividade (tela nova do NAJ, desde 11/2026).
- `robo/CICLO.md`: passo a passo do ciclo de lançamentos (fila do formulário → NAJ → status de volta no formulário), a cada 2 h.
- Aba "Timesheet" do formulário: cronômetro (iniciar, pausar, parar) vinculado a cliente e processo, guardado em `timesheet/ativo` e `timesheet_registros`; cada registro pode ser enviado à fila do NAJ.
- `robo/naj-cadastros.js`, `robo/cadastros-anteriores.js` e `robo/CADASTROS.md`: cópia da lista de clientes e processos do NAJ para o formulário sugerir nomes.
- `robo/naj-relatorio.js` e `robo/naj-tipos.js` (passos em `robo/CADASTROS.md`): relatório de horas da equipe e tipo de cada hora, para o painel de administrador.
- `robo/naj-comum.js`: entrada no NAJ e consultas da tela nova de atividades, usadas por todos os robôs.
