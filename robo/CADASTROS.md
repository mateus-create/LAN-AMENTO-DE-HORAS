# Atualização dos cadastros do NAJ no formulário

O formulário sugere clientes e mostra processos a partir de uma cópia da lista do NAJ,
guardada na coleção `cadastros` do formulário https://claude.ai/artifact/DW1sanezeJtNKf3D3N2uyf.
O formulário não acessa o NAJ diretamente, então esta cópia precisa ser renovada.

Há dois modos (`robo/naj-cadastros.js`), ambos só leitura no NAJ:
- **Rápido** (`--anterior`, cerca de 2 minutos): a pesquisa de processos vem do código mais novo para o mais antigo, então o robô
  lê só as primeiras páginas, até achar um código que já está na cópia. A cópia só é aceita se **cópia + novos = total de ativos
  do NAJ**. Se não bater (algum processo foi baixado ou reativado), ele lê todos os processos. Os clientes vêm em ordem alfabética
  e não dá para pegar só os novos; o robô confere os totais Ativo/Inativo do NAJ e se o cliente de cada processo novo já está
  na lista. Se algo mudou, lê todos os clientes.
- **Completo** (`--completo`, cerca de 16 minutos): lê tudo. Pega o que o rápido não vê porque não muda os totais
  (nome de cliente corrigido, número de processo alterado, um processo baixado e outro reativado no mesmo intervalo).
  Rode uma vez por dia (execução das 12:45).

Nos dois modos, se a tela travar ou a sessão do NAJ cair, o robô entra de novo e continua da mesma página (até 4 vezes),
e só termina com sucesso se o total lido for **exatamente** o total que o NAJ informa (clientes por situação e processos ativos).

1. Use uma pasta nova e vazia `<pasta>` (ex.: `/tmp/cad-<data-hora>`).
2. ArtifactData `list` em `cadastros` com `out_dir` = `<pasta>/form` (anote as versões de cada documento).
   `node robo/cadastros-anteriores.js <pasta>/form/cadastros <pasta>/anterior` remonta a cópia atual (e confere com o `info`).
3. Em segundo plano: `timeout 2700 node robo/naj-cadastros.js <pasta>/novo --anterior <pasta>/anterior > <pasta>/cad.log 2>&1`
   (acrescente `--completo` na execução das 12:45). Se o passo 2 falhar, rode sem `--anterior` (vira completo).
4. Se o robô terminar com erro (código de saída diferente de 0), não grave nada e diga o motivo em uma linha (última linha do log).
5. Se a última linha disser `SEM MUDANÇAS`, não grave nada (`resumo.json` com `mudou: false`).
6. Se houver mudanças: `node robo/cadastros-para-formulario.js <pasta>/novo <pasta>/novo/docs` divide as listas em documentos
   (`clientes-N`, `processos-N`) e gera `info`. Grave com um único ArtifactData `batch`: `set` de cada arquivo em `<pasta>/novo/docs`
   com `doc_id` = nome do arquivo sem `.json` e `if_version` = versão do passo 2 quando o documento já existe;
   `delete` dos documentos `clientes-N`/`processos-N` que sobraram de uma lista maior; `info` por último.

## Relatório de horas da equipe (rotina separada, uma vez por dia)

1. ArtifactData `list` em `relatorio` com `out_dir` = `<pasta>/relform` (guarda o `info`, os meses atuais e as versões).
   Em segundo plano: `timeout 4200 node robo/naj-relatorio.js <pasta>/rel <primeiro dia do mês passado, DD/MM/AAAA> --cache <pasta>/detalhes.json --semente <pasta>/relform/relatorio > <pasta>/rel.log 2>&1`.
   Baixa a área de cada processo (campo "Advogado do Cliente") e as atividades de todos os usuários no período. A lista do NAJ
   não mostra o processo vinculado nem a Área Jurídica, então o robô abre (só leitura) cada atividade que ainda não está no
   formulário, as dos últimos 7 dias (podem ter sido corrigidas) e as que estão com tempo diferente do gravado; as outras vêm
   da `--semente`. Leva cerca de 20 a 30 minutos. Se a sessão do NAJ cair ou ficar lenta, o robô entra de novo e continua.
   Só termina com sucesso se leu pelo menos o total de atividades que o NAJ informa no período.
   Núcleo de cada hora (calculado na página): área do processo vinculado → Área Jurídica da atividade → núcleo principal da pessoa.
2. `node robo/relatorio-para-formulario.js <pasta>/rel <pasta>/relform/relatorio/info.json <pasta>/rel/docs` (use `-` se não houver `info`).
3. Grave cada `m-AAAA-MM-N.json` em `relatorio` (`set`, `if_version` quando já existir), apague os ids de `apagar.json`
   e grave `info` por último. A coleção `relatorio` só é lida por administradores.
4. Cuidados: se o passo 1 falhar, tente mais uma vez com o mesmo comando, acrescentando `--reusar-areas <pasta>/rel/processos-areas.json`
   se esse arquivo já existir (não baixa a lista de processos de novo) e mantendo o `--cache` (as atividades já abertas não são
   reabertas); se falhar de novo, não grave nada.
   Antes de gravar, compare a quantidade de itens com os meses baixados no passo 1: um mês já fechado
   não pode ter ficado com menos itens; se ficou, não grave e avise. Áreas novas: liste as áreas de `info.areas`
   e `info.areasAtividade` que não estavam no `info` anterior e não estão em `config/nucleos` (`mapa` / `mapaAtividade`).
   O relatório roda logo depois da atualização de cadastros das 06:45 (mesma sessão), para não usar o NAJ em paralelo.
5. Tipos de hora dos mesmos meses (do mês passado até o atual), depois do passo 3: siga a seção "Tipos de hora" abaixo.
   Se falhar, não grave os tipos (os meses anteriores continuam valendo) e avise.

## Tipos de hora (Contratos Fixos, Propostas, Administrativas)

A lista de atividades do NAJ não mostra o tipo. O tipo vem do relatório "Relatórios → Atividades" (analítico, um por tipo e por mês),
que traz o código de cada atividade. Só leitura; cada relatório abre uma sessão nova do NAJ (a tela trava depois de gerar um PDF), ~40 s cada.

1. `node robo/naj-tipos.js <pasta>/tipos <AAAA-MM inicial> [AAAA-MM final]` (precisa do `pdftotext`). Rode em segundo plano.
2. `node robo/tipos-para-formulario.js <pasta>/tipos/tipos.json <pasta>/tipos/docs <ids atuais de relatorio/info.tipos, separados por vírgula>`.
3. Grave cada `t-AAAA-MM.json` em `relatorio` (`set`, `if_version` quando já existir) e, por último, `update` em `relatorio/info`
   com o campo `tipos` de `tipos-info.json`. O `relatorio-para-formulario.js` mantém esse campo quando regrava o `info`.

A aba Equipe → Relatórios → "Indicadores dos núcleos" junta o tipo a cada hora pelo código da atividade.
O núcleo de cada hora é o da pessoa que lançou (aba Pessoas ou quadro "Núcleo de cada pessoa do NAJ");
quem tem mais de um núcleo é dividido pela área do processo. Responsável e integrantes por mês ficam em `config/nucleos.equipe`.
