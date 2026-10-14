# Lançamento de horas no NAJ

- `formulario/lancamento-horas.html`: formulário (publicado em https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf).
- `robo/naj-lancar.js`: robô que entra no NAJ e cria a atividade em Controles → Atividades → Nova Atividade.
- `robo/CICLO.md`: passo a passo do ciclo de hora em hora (fila do formulário → NAJ → status de volta no formulário).
- Aba "Timesheet" do formulário: cronômetro (iniciar, pausar, parar) vinculado a cliente e processo, guardado em `timesheet/ativo` e `timesheet_registros`; cada registro pode ser enviado à fila do NAJ.
- `robo/naj-cadastros.js` e `robo/CADASTROS.md`: cópia diária da lista de clientes e processos do NAJ para o formulário sugerir nomes.
