# Atualização dos cadastros do NAJ no formulário (uma vez por dia)

O formulário sugere clientes e mostra processos a partir de uma cópia da lista do NAJ,
guardada na coleção `cadastros` do formulário https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf.
O formulário não acessa o NAJ diretamente, então esta cópia precisa ser renovada.

1. `node robo/naj-cadastros.js <pasta>`: baixa clientes (ativos e inativos) e só os processos com situação ativa no NAJ (filtro "Somente Ativos" do módulo Processos). Leva de 30 a 90 minutos.
   Rode em segundo plano. Nada é gravado no NAJ.
2. `node robo/cadastros-para-formulario.js <pasta> <pasta>/docs`: divide as listas em documentos de até ~200 KB
   (`clientes-N`, `processos-N`) e gera `info`.
3. ArtifactData `list` em `cadastros` para ver os documentos atuais e suas versões.
4. Para cada arquivo em `<pasta>/docs`, ArtifactData `set` em `cadastros` com `doc_id` = nome do arquivo sem `.json`,
   `file_path` = o arquivo e `if_version` = versão atual quando o documento já existe.
   Grave `info` por último. Apague (`delete`) os documentos `clientes-N`/`processos-N` que sobraram de uma lista maior.
5. Se o download falhar no meio, não grave nada: o formulário continua com a cópia anterior.

## Relatório de horas da equipe (mesma rotina diária)

6. `node robo/naj-relatorio.js <pasta>/rel <primeiro dia do mês passado, DD/MM/AAAA>`: baixa as atividades de todos os usuários do NAJ
   no período e a área de cada processo. Leva de 30 a 60 minutos; rode em segundo plano.
7. ArtifactData `get` em `relatorio` / `info` com `out_dir` (se existir) e
   `node robo/relatorio-para-formulario.js <pasta>/rel <info.json baixado ou -> <pasta>/rel/docs`.
8. Grave cada `m-AAAA-MM-N.json` em `relatorio` (`set`, `if_version` quando já existir), apague os ids de `apagar.json`
   e grave `info` por último. A coleção `relatorio` só é lida por administradores.
