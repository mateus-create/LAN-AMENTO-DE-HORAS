# Ciclo de lançamento no NAJ (roda de hora em hora)

Formulário: https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf
Armazenamento: coleção `lancamentos` do formulário (ferramenta ArtifactData, `url` acima).
Credenciais: variáveis de ambiente `NAJ_URL`, `NAJ_USUARIO`, `NAJ_SENHA` (nunca copiar os valores para arquivos ou mensagens).

Status de um lançamento: `pendente` → `processando` → `lancado` ou `erro`.
O usuário corrige um `erro` no formulário e ele volta para `pendente`.

## Passos

Use uma pasta de trabalho nova, por exemplo `$TMP/ciclo-<data-hora>`.

1. **Travados de um ciclo anterior.** ArtifactData `query` em `lancamentos` com `where status == processando`.
   Se houver algum, NÃO lançar de novo (pode já ter sido gravado no NAJ). Para cada um, `update` (com `if_version`)
   para `status: "erro"`, `mensagem: "O ciclo anterior foi interrompido durante o lançamento. Confira no NAJ se a atividade já existe; se não existir, toque em Corrigir e salve para devolver à fila."`.
2. **Buscar pendentes.** ArtifactData `query` em `lancamentos` com `where status == pendente` e `out_dir` na pasta de trabalho.
   Anote o `version` de cada documento mostrado no resultado.
   Se não houver nenhum, encerre o ciclo sem fazer mais nada.
3. **Marcar como processando.** ArtifactData `batch` com um `update` por documento: `{status: "processando"}`, `if_version` = versão anotada.
   Anote as novas versões. Se algum falhar por versão (o usuário editou nesse instante), deixe esse para o próximo ciclo.
4. **Preparar a entrada.** `node robo/preparar.js <pasta>/lancamentos <pasta>/entrada.json`
   (o script só pega os de status `pendente` no arquivo exportado, que é o estado lido no passo 2; remova da entrada os que falharam no passo 3).
5. **Lançar.** `node robo/naj-lancar.js <pasta>/entrada.json <pasta>/saida.json --prints <pasta>/prints`
   (sem `--teste`: este grava no NAJ). Leva cerca de 40 s por lançamento.
6. **Gravar o resultado.** `node robo/resultados.js <pasta>/saida.json <pasta>/upd`, depois ArtifactData `batch` com um
   `update` por arquivo (`file_path` = `<pasta>/upd/<id>.json`, `if_version` = versão do passo 3).
   Se o robô terminou sem gerar resultado para algum id, grave `status: "erro"` com a mensagem do passo 1 para ele.
7. **Resumo.** Uma linha por lançamento: lançado (código NAJ) ou erro (motivo).

## Testar sem gravar

`node robo/naj-lancar.js entrada.json saida.json --teste --prints prints/` preenche a tela "Nova Atividade" do NAJ,
confere os campos, tira um print e fecha a janela sem clicar em Gravar.
