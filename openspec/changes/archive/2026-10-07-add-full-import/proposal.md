## Why

Na importação atual, o operador escolhe na tela um mesmo conjunto de grupos para todas as linhas da planilha. Na migração, porém, cada usuário costuma precisar de subgrupos diferentes, o que obriga a dividir a planilha e repetir a importação várias vezes. Precisamos de um fluxo em que os grupos de cada usuário venham na própria planilha.

## What Changes

- Novo fluxo **Importação completa**, ao lado do atual, que passa a se chamar **Importação simples**. O menu lateral ganha os dois itens.
- Na importação completa, a planilha tem `UID`, `NOME`, `Email` e, em seguida, uma coluna por **grupo raiz**: o cabeçalho é o nome da raiz (ex.: `APP.PORTAL`) e a célula traz os **subgrupos diretos** dessa raiz separados por `|` (ex.: `ROLE_PORTAL_USER|ROLE_PORTAL_ADMIN`). Só existe um nível: a raiz não é atribuída sozinha e netos não são aceitos.
- O separador de colunas continua `;` ou `,`, detectado automaticamente.
- Fluxo em quatro etapas: **Upload → Revisão → Confirmação → Resultado**. Não há etapa de seleção de grupos; a Revisão mostra os grupos de cada linha já validados contra o realm.
- Grupo citado que não existe no realm (raiz ou subgrupo) **não invalida a linha**: só aquele grupo fica como `INEXISTENTE`, não é atribuído e é sinalizado na Revisão e no relatório. Os demais grupos da linha são atribuídos normalmente.
- Linha sem nenhum grupo informado, ou em que todos os grupos citados são inexistentes, é **inválida**: não é importada e é sinalizada na Revisão e no relatório.
- Todas as regras de idempotência atuais valem: usuário novo é criado com as ações obrigatórias; usuário existente recebe só os grupos que faltam; **nenhum grupo é removido**. Usuário existente que já tem todos os grupos válidos fica `SEM_ALTERACAO`, com aviso se a planilha citar grupos inexistentes.
- **Nas duas importações**, as linhas inválidas passam a constar no resultado e no relatório com o novo status `IGNORADO` e o motivo. Hoje elas aparecem só na Revisão.
- Modelo CSV próprio para a importação completa.
- README atualizado com o novo fluxo e o formato da planilha.

## Capabilities

### New Capabilities

- `full-user-import`: importação completa com grupos por linha — formato da planilha com colunas de grupo raiz, leitura e validação dos subgrupos contra o realm, regras de grupo inexistente e de linha sem grupo, modelo CSV, fluxo de quatro etapas e menu com os dois tipos de importação.

### Modified Capabilities

- `bulk-user-import`: o job passa a aceitar grupos por linha (além dos grupos selecionados), registra as linhas inválidas como `IGNORADO`, ganha o status de grupo `INEXISTENTE` e o relatório inclui as linhas ignoradas e os grupos inexistentes.
- `import-wizard-ui`: a tela de resultado ganha o cartão "Ignorados" e mostra os grupos inexistentes; o fluxo simples passa a enviar também as linhas inválidas para constarem no resultado.
- `project-documentation`: o README passa a documentar a importação completa.

## Impact

- **Backend**: `csv-import` (leitura das colunas de grupo), `GroupsService` (resolução por path), `ImportsController` (modo da prévia e do job, modelo da importação completa), `ImportJobsService` e `ImportProcessor` (grupos por linha, `IGNORADO`, `INEXISTENTE`), `job-view` (contagens e relatório).
- **API**: `POST /api/imports/preview?mode=completa`, `GET /api/imports/template.csv?mode=completa` e o corpo de `POST /api/imports` ganha `mode` e, por linha, `groups` (paths). Linhas inválidas deixam de causar erro 400 na criação do job e passam a ser registradas como `IGNORADO`. A importação simples continua compatível.
- **Frontend**: nova página `/completa`, menu com dois itens, store por modo, navegação das etapas por nome (não mais por número), Revisão e Confirmação com grupos por linha e status novos na tela de resultado.
- **RH-SSO**: a prévia da importação completa consulta a árvore de grupos (com o cache já existente). O número de grupos cujos membros são levantados passa a ser a união dos grupos citados na planilha.
- **Documentação**: README.
