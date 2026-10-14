# Ciclo de lançamento no NAJ (roda de hora em hora)

Formulário: https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf
Armazenamento: ferramenta ArtifactData com o `url` acima.
Cada pessoa da equipe tem os próprios lançamentos em `equipe/<id da pessoa>/lancamentos`.
`config/membros` liga cada pessoa ao login do NAJ (`pessoas.<id>.najLogin`).
Senhas: nunca no formulário. A do dono é `NAJ_SENHA` (com `NAJ_USUARIO`); a de cada pessoa fica na variável
`NAJ_SENHA_<LOGIN EM MAIÚSCULAS, com _ no lugar de símbolos>` (ex.: leticia@mks.adv.br → `NAJ_SENHA_LETICIA_MKS_ADV_BR`).
Nunca copie valores de senha para arquivos, mensagens ou o formulário.

Status de um lançamento: `pendente` → `processando` → `lancado` ou `erro`.
Campos opcionais usados pelo robô: `clienteCod` e `processoCod` (códigos no NAJ).

## Passos

Use uma pasta de trabalho nova, por exemplo `$TMP/ciclo-<data-hora>` (chamada abaixo de `<pasta>`).

1. **Senhas disponíveis.** `env | grep -o '^NAJ_SENHA_[A-Z0-9_]*' | sort` (só os nomes). Se a lista mudou desde a última vez,
   grave em `config/robo` o campo `senhas` com esses nomes (ArtifactData `set`/`update`, com `if_version` se existir).
2. **Pessoas.** ArtifactData `list` em `equipe` com `out_dir` = `<pasta>` e `get` em `config` / `membros` com o mesmo `out_dir`.
3. **Travados de um ciclo anterior.** Para cada pessoa, `query` em `equipe/<id>/lancamentos` com `where status == processando`.
   Não lance de novo (pode já estar gravado no NAJ): `update` (com `if_version`) para `status: "erro"`,
   `mensagem: "O ciclo anterior foi interrompido durante o lançamento. Confira no NAJ se a atividade já existe; se não existir, toque em Corrigir e salve para devolver à fila."`.
4. **Pendentes.** Para cada pessoa, `query` em `equipe/<id>/lancamentos` com `where status == pendente` e `out_dir` = `<pasta>`.
   Anote o `version` de cada documento. Se não houver nenhum em ninguém, encerre o ciclo sem fazer mais nada.
   (A coleção antiga `lancamentos`, sem divisão por pessoa, deve estar vazia: a página do dono move tudo para `equipe/`.
   Se ainda houver pendentes lá, trate-os como do dono.)
5. **Marcar como processando.** ArtifactData `batch` com um `update` por documento: `{status: "processando"}`, `if_version` anotado.
   Anote as novas versões. Se algum falhar por versão (a pessoa editou nesse instante), deixe para o próximo ciclo.
6. **Preparar.** `node robo/preparar.js <pasta> <pasta>/entrada.json` (só os `pendente` do arquivo exportado; remova os que falharam no passo 5).
7. **Lançar.** `node robo/naj-lancar.js <pasta>/entrada.json <pasta>/saida.json --prints <pasta>/prints`
   (sem `--teste`: grava no NAJ, cada um com o próprio login). Cerca de 40 s por lançamento.
8. **Gravar o resultado.** `node robo/resultados.js <pasta>/entrada.json <pasta>/saida.json <pasta>/upd`; depois ArtifactData `batch`
   com um `update` por arquivo (`collection` = a coleção mostrada, `doc_id`, `file_path`, `if_version` do passo 5).
   Se algum id ficou sem resultado, grave `status: "erro"` com a mensagem do passo 3.
9. **Resumo.** Uma linha por lançamento: pessoa, lançado (código NAJ) ou erro (motivo).

## Testar sem gravar

`node robo/naj-lancar.js entrada.json saida.json --teste --prints prints/` preenche a tela "Nova Atividade" do NAJ,
confere os campos, tira um print e fecha a janela sem clicar em Gravar.
