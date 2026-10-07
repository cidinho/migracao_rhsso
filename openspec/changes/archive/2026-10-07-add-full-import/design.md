## Context

A importação simples (change `add-bulk-user-import`, arquivada) aplica um único conjunto de grupos, escolhido na tela, a todas as linhas. O motor do job já trata grupos por linha no resultado (`RowResult.grupos`), mas a decisão de quais grupos atribuir vem de `job.groups`, comum a todas as linhas. A prévia do CSV hoje é puramente local (não consulta o RH-SSO) e linhas inválidas causam erro 400 na criação do job, então nunca chegam ao relatório.

No frontend, um único store Pinia (`useImportStore`) guarda o estado do assistente, e as etapas navegam por número fixo (`store.step = 3`), o que não serve para um fluxo de quatro etapas convivendo com outro de cinco.

## Goals / Non-Goals

**Goals:**
- Importação completa com grupos por linha, reaproveitando o mesmo motor, o mesmo controle de taxa e as mesmas regras de idempotência.
- Grupo inexistente afeta só aquele grupo; a linha segue com os demais.
- Linhas inválidas registradas como `IGNORADO` no resultado e no relatório, nas duas importações.
- Manter a importação simples compatível e com o mesmo comportamento visível, exceto pelas linhas ignoradas no resultado.

**Non-Goals:**
- Remover grupos que não estão na planilha (sincronização).
- Hierarquias com mais de um nível abaixo da raiz.
- Gerar o modelo CSV a partir das raízes do realm.
- Trocar a estratégia de levantamento de membros (continua por grupo).

## Decisions

### D1. Mesmos endpoints, com `mode`
`POST /api/imports/preview?mode=completa`, `GET /api/imports/template.csv?mode=completa` e `POST /api/imports` com `mode: 'simples' | 'completa'` (padrão `simples`). Alternativa: endpoints separados (`/full-imports`). Rejeitada porque duplicaria controle de job, polling, pausa, relatório e reprocessamento, que são idênticos.

### D2. Leitura das colunas de grupo no parser
`parseCsv` recebe o modo. Na importação completa, toda coluna fora de UID/NOME/Email com cabeçalho não vazio é uma raiz; raízes repetidas são combinadas. Cada célula é dividida por `|`, com trim, descarte de vazios e remoção de repetidos, e vira uma lista de paths pedidos (`/<raiz>/<nome>`). Valores com `/` são mantidos na lista para serem sinalizados como inválidos ("apenas um nível"). O parser não conhece o realm: só produz os paths pedidos.

### D3. Resolução de paths no `GroupsService`
Novo método `resolvePaths(paths)`, que usa índices por path exato e por path em minúsculas, montados junto com o cache atual. Ordem: path exato; senão, um único path igual sem diferenciar maiúsculas; senão, inexistente (com motivo "não existe no realm" ou "corresponde a mais de um grupo"). Valores com mais de um nível são inexistentes com o motivo próprio. Se algum path não for encontrado, o cache é recarregado uma vez, como já faz `resolve(ids)`. Usado na prévia e de novo na criação do job; na criação, com `refresh` (árvore lida sem cache), para que um grupo apagado depois da Revisão vire `INEXISTENTE` e não uma falha de atribuição.

Status por grupo na prévia: `OK` ou `INEXISTENTE`. Regras de linha: nenhum path pedido → erro "Nenhum grupo informado"; nenhum path `OK` → erro "Nenhum grupo válido".

### D4. Corpo da criação do job
Cada linha enviada carrega `line`, `uid`, `nome`, `email`, opcionalmente `groups` (paths pedidos, na completa) e `removed` (removida manualmente na Revisão). O frontend envia todas as linhas da planilha. O servidor revalida e classifica: removidas → `IGNORADO` ("Removida na revisão"); com erro → `IGNORADO` com os erros; válidas → processadas. Alternativa: o frontend enviar só as válidas e uma lista à parte de ignoradas. Rejeitada porque o servidor deixaria de ser a fonte da verdade sobre o que é inválido.

### D5. Modelo do job
- `ImportRow` ganha `groups?: GroupRef[]` (grupos válidos da linha) e `missingGroups?: { path; motivo }[]`.
- `job.mode` registra o tipo. `job.groups` passa a ser a união dos grupos válidos de todas as linhas, na completa, de modo que o levantamento de membros não muda.
- `ImportProcessor` usa `row.groups ?? job.groups`. Os inexistentes entram em `grupos` com status `INEXISTENTE` (novo `GroupStatus`) e geram um aviso; não entram no cálculo de `ERRO`, `CRIADO` ou `GRUPOS_ADICIONADOS`.
- As linhas ignoradas vão para `job.results` na criação, com status `IGNORADO` (novo `RowStatus`), e `job.ignored` guarda quantas são. Na visão do job, `total` é o número de linhas a processar e `processed` desconta as ignoradas; como elas estão no início de `results`, o polling incremental por `since` continua funcionando.
- O reprocessamento de erros na completa reenvia, por linha, os paths pedidos originalmente (`requestedGroups`), e não só os resolvidos, para que um grupo criado depois seja reconsiderado.

### D6. Relatório
Nova coluna "Grupos inexistentes" (path e motivo). As linhas `IGNORADO` entram ordenadas pela linha da planilha, com o motivo na coluna "Mensagem".

### D7. Frontend: store por modo e etapas por nome
- `createImportStore(mode)` gera dois stores Pinia (`import-simples` e `import-completa`). A página injeta o store certo (`provide`), e os componentes usam `useImportStore()`, que faz `inject` com o store simples como padrão. Assim os componentes não mudam de assinatura, e o chip de conexão do cabeçalho continua funcionando.
- `store.step` passa a ser um nome (`upload`, `review`, `groups`, `confirm`, `result`). Cada página define a sua lista de etapas; um componente `ImportWizard` renderiza o stepper a partir dela. Botões de avançar e voltar usam `store.next()` e `store.back()`, que consultam a lista de etapas do modo.
- Rotas: `/` (simples) e `/completa`. O menu tem os dois itens.
- Revisão: coluna "Grupos" com chips (válido ou inexistente, com ícone e texto). Confirmação: lista de grupos com a contagem de usuários e a lista de inexistentes.

## Risks / Trade-offs

- [A prévia da importação completa depende do RH-SSO] → usa o cache de grupos (`GROUPS_CACHE_TTL_SECONDS`), e a falha de conexão aparece como erro de upload, com a mensagem da conexão.
- [A união dos grupos da planilha pode ter muitos grupos grandes, aumentando o levantamento de membros e o risco do WAF] → as requisições passam pelo mesmo limitador. A Confirmação mostra a quantidade de grupos. Trocar a estratégia fica para uma change futura, se for necessário.
- [Correspondência sem diferenciar maiúsculas pode escolher um grupo inesperado] → só é aceita quando há exatamente um candidato; com mais de um, o grupo fica inexistente com o motivo "corresponde a mais de um grupo".
- [Mudança de contrato: linhas inválidas não causam mais 400] → o frontend é atualizado junto, e clientes antigos que enviavam só linhas válidas continuam funcionando.
- [Linhas ignoradas no início de `results`] → `processed` e a barra de progresso descontam as ignoradas, para a porcentagem não começar acima de zero.
