# Atualização dos cadastros do NAJ no formulário (de hora em hora)

O formulário sugere clientes e mostra processos a partir de uma cópia da lista do NAJ,
guardada na coleção `cadastros` do formulário https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf.
O formulário não acessa o NAJ diretamente, então esta cópia precisa ser renovada.

1. `node robo/naj-cadastros.js <pasta>`: baixa clientes (ativos e inativos) e só os processos com situação ativa no NAJ (filtro "Somente Ativos" do módulo Processos). Leva cerca de 15 a 25 minutos.
   Rode em segundo plano. Nada é gravado no NAJ.
2. `node robo/cadastros-para-formulario.js <pasta> <pasta>/docs`: divide as listas em documentos de até ~200 KB
   (`clientes-N`, `processos-N`) e gera `info`.
3. ArtifactData `list` em `cadastros` para ver os documentos atuais e suas versões.
4. Para cada arquivo em `<pasta>/docs`, ArtifactData `set` em `cadastros` com `doc_id` = nome do arquivo sem `.json`,
   `file_path` = o arquivo e `if_version` = versão atual quando o documento já existe.
   Grave `info` por último. Apague (`delete`) os documentos `clientes-N`/`processos-N` que sobraram de uma lista maior.
5. Se o download falhar no meio, não grave nada: o formulário continua com a cópia anterior.
6. Conferência antes de gravar (passo 4): o log precisa mostrar `processos ativos: N (o NAJ informa N)` com os dois números
   iguais, e o total de clientes não pode ter caído mais de 0,5% em relação a `cadastros/info` atual (campo `clientes`).
   Se falhar, não grave nada e diga o motivo em uma linha (a próxima execução tenta de novo).
   Use sempre uma pasta nova e vazia (ex.: `/tmp/cad-<data-hora>`), para não misturar arquivos de outra execução.

## Relatório de horas da equipe (rotina separada, uma vez por dia)

1. `node robo/naj-relatorio.js <pasta>/rel <primeiro dia do mês passado, DD/MM/AAAA> --cache /tmp/naj-detalhes.json`:
   baixa a área de cada processo (campo "Advogado do Cliente") e as atividades de todos os usuários no período. Abre cada
   atividade (só leitura) para ler o processo vinculado e a Área Jurídica; as já lidas ficam no cache. Rode em segundo plano.
   Núcleo de cada hora (calculado na página): área do processo vinculado → Área Jurídica da atividade → núcleo principal da pessoa.
2. ArtifactData `get` em `relatorio` / `info` com `out_dir` (se existir) e
   `node robo/relatorio-para-formulario.js <pasta>/rel <info.json baixado ou -> <pasta>/rel/docs`.
3. Grave cada `m-AAAA-MM-N.json` em `relatorio` (`set`, `if_version` quando já existir), apague os ids de `apagar.json`
   e grave `info` por último. A coleção `relatorio` só é lida por administradores.
4. Cuidados: se o passo 1 falhar (sessão do NAJ cai, timeout), tente mais uma vez; se falhar de novo, não grave nada.
   Antes de gravar, baixe os meses atuais (`get` com `out_dir`) e compare a quantidade de itens: um mês já fechado
   não pode ter ficado com menos itens; se ficou, não grave e avise. Áreas novas: liste as áreas de `info.areas`
   e `info.areasAtividade` que não estavam no `info` anterior e não estão em `config/nucleos` (`mapa` / `mapaAtividade`).
   O relatório roda logo depois da atualização de cadastros das 06:45 (mesma sessão), para não usar o NAJ em paralelo.
