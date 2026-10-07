# full-user-import Specification

## Purpose

Define a importação completa: planilha com uma coluna por grupo raiz e os subgrupos de cada usuário na célula, validação desses grupos contra o realm, tratamento de grupos inexistentes e de linhas sem grupo válido, e atribuição dos grupos de cada linha no job.

## Requirements

### Requirement: Dois tipos de importação no menu
O frontend SHALL oferecer no menu lateral dois itens: **Importação simples**, com o fluxo atual em que os grupos são escolhidos na tela, e **Importação completa**, em que os grupos vêm na planilha. Cada tipo MUST manter seu próprio estado, de forma que alternar entre eles não misture arquivos, linhas ou resultados.

#### Scenario: Alternar entre os tipos
- **WHEN** o usuário envia uma planilha na Importação completa, abre a Importação simples e depois volta
- **THEN** a Importação simples está vazia e a Importação completa continua com a planilha enviada

### Requirement: Formato da planilha da importação completa
A planilha da importação completa SHALL ter as colunas `UID`, `NOME` e `Email`, com as mesmas regras da importação simples (cabeçalho sem diferenciar maiúsculas, separador `;` ou `,` e codificação detectados automaticamente, limites de tamanho e de linhas). Toda outra coluna com cabeçalho não vazio MUST ser tratada como uma coluna de **grupo raiz**, cujo cabeçalho é o nome da raiz. Colunas com o mesmo nome de raiz MUST ser combinadas. O arquivo MUST ser rejeitado se não tiver nenhuma coluna de grupo.

#### Scenario: Colunas de grupo
- **WHEN** o cabeçalho é `UID;NOME;Email;APP.PORTAL;APP.FINANCEIRO`
- **THEN** `APP.PORTAL` e `APP.FINANCEIRO` são reconhecidas como colunas de grupo raiz

#### Scenario: Sem colunas de grupo
- **WHEN** o cabeçalho da importação completa é apenas `UID;NOME;Email`
- **THEN** o upload é rejeitado com uma mensagem explicando que é preciso ao menos uma coluna com o nome de um grupo raiz depois de `Email`

### Requirement: Subgrupos na célula
Cada célula de uma coluna de grupo SHALL conter zero ou mais nomes de **subgrupos diretos** da raiz da coluna, separados por `|`. Espaços em volta dos nomes MUST ser ignorados, valores vazios MUST ser descartados e nomes repetidos MUST contar uma vez. Cada nome MUST corresponder ao grupo de path `/<raiz>/<nome>`; a raiz sozinha MUST NOT ser atribuída e nomes com `/` (níveis mais profundos) MUST NOT ser aceitos.

#### Scenario: Dois subgrupos
- **WHEN** a coluna `APP.PORTAL` tem a célula `ROLE_PORTAL_USER | ROLE_PORTAL_ADMIN`
- **THEN** os grupos da linha são `/APP.PORTAL/ROLE_PORTAL_USER` e `/APP.PORTAL/ROLE_PORTAL_ADMIN`

#### Scenario: Nível mais profundo
- **WHEN** a célula contém `ROLE_PORTAL_ADMIN/ROLE_PORTAL_AUDITOR`
- **THEN** esse valor é sinalizado como grupo inválido por ter mais de um nível e não é atribuído

### Requirement: Validação dos grupos contra o realm
A prévia da importação completa SHALL resolver cada grupo citado contra a árvore de grupos do realm, procurando primeiro o path exato e, se não houver, um único path igual sem diferenciar maiúsculas. Um grupo que não for encontrado (raiz ou subgrupo inexistente, ou correspondência ambígua) MUST ser marcado como `INEXISTENTE` com o motivo, sem invalidar a linha. Os demais grupos da linha MUST seguir normalmente.

#### Scenario: Um subgrupo inexistente
- **WHEN** a linha cita `/APP.PORTAL/ROLE_PORTAL_USER` (existe) e `/APP.PORTAL/ROLE_INEXISTENTE` (não existe)
- **THEN** a linha é válida, `ROLE_PORTAL_USER` aparece como válido e `ROLE_INEXISTENTE` aparece como inexistente, e só o primeiro será atribuído

#### Scenario: Raiz inexistente
- **WHEN** o cabeçalho tem a coluna `APP.NAO_EXISTE` e uma linha tem valores nela
- **THEN** os grupos dessa coluna ficam como inexistentes e a linha segue com os grupos das outras colunas

#### Scenario: Diferença de maiúsculas
- **WHEN** a célula traz `role_portal_user` e o realm tem apenas `/APP.PORTAL/ROLE_PORTAL_USER`
- **THEN** o grupo é resolvido para `/APP.PORTAL/ROLE_PORTAL_USER`

### Requirement: Linha sem grupo válido
Na importação completa, uma linha SHALL ser inválida quando todas as colunas de grupo estiverem vazias ("Nenhum grupo informado") ou quando todos os grupos citados forem inexistentes ("Nenhum grupo válido"). Linhas inválidas MUST NOT ser importadas e MUST aparecer na Revisão e no relatório com o motivo.

#### Scenario: Colunas de grupo vazias
- **WHEN** uma linha tem UID, NOME e Email válidos, mas nenhuma coluna de grupo preenchida
- **THEN** a linha é inválida com o motivo "Nenhum grupo informado"

#### Scenario: Todos os grupos inexistentes
- **WHEN** todos os grupos citados por uma linha são inexistentes
- **THEN** a linha é inválida com o motivo "Nenhum grupo válido"

### Requirement: Grupos por linha no job
Na importação completa, o job SHALL atribuir a cada usuário apenas os grupos válidos da sua linha, aplicando as mesmas regras da importação simples: usuário novo é criado com as ações obrigatórias e recebe os grupos; usuário existente recebe só os grupos que não possui; nenhum grupo é removido. O levantamento prévio de membros MUST considerar a união dos grupos válidos de todas as linhas. Os grupos inexistentes MUST aparecer no resultado da linha com status `INEXISTENTE` e um aviso, e MUST NOT tornar a linha `ERRO`.

#### Scenario: Usuários com grupos diferentes
- **WHEN** a linha 2 cita `/APP.PORTAL/ROLE_PORTAL_USER` e a linha 3 cita `/APP.FINANCEIRO/ROLE_FIN_CONSULTA`
- **THEN** cada usuário recebe apenas o grupo da própria linha

#### Scenario: Usuário completo com grupo inexistente
- **WHEN** o usuário já existe, já possui todos os grupos válidos da linha e a linha cita também um grupo inexistente
- **THEN** a linha fica `SEM_ALTERACAO`, o grupo inexistente aparece como `INEXISTENTE` e o resultado registra um aviso

#### Scenario: Grupo apagado depois da Revisão
- **WHEN** um grupo válido na Revisão é apagado do realm antes de o job começar
- **THEN** o job é criado normalmente e esse grupo aparece como `INEXISTENTE` nas linhas que o citavam

### Requirement: Fluxo da importação completa
A importação completa SHALL ter as etapas **Upload**, **Revisão**, **Confirmação** e **Resultado**, sem a etapa de seleção de grupos. A Revisão MUST mostrar, para cada linha, os grupos válidos e os inexistentes, distinguindo-os por ícone e texto. A Confirmação MUST resumir os grupos que serão atribuídos, com a quantidade de usuários de cada um, e os grupos inexistentes encontrados.

#### Scenario: Revisão com grupos
- **WHEN** a planilha é enviada na Importação completa
- **THEN** a tabela de Revisão tem a coluna "Grupos" com os grupos de cada linha, e os inexistentes aparecem marcados como "Inexistente"

#### Scenario: Confirmação
- **WHEN** 300 linhas válidas citam `/APP.PORTAL/ROLE_PORTAL_USER` e 40 citam `/APP.FINANCEIRO/ROLE_FIN_CONSULTA`
- **THEN** a Confirmação lista os dois grupos com 300 e 40 usuários, respectivamente

### Requirement: Modelo da importação completa
O sistema SHALL disponibilizar um modelo CSV da importação completa com o cabeçalho `UID;NOME;Email;APP.PORTAL` e uma linha de exemplo `t_abc1234;Maria da Silva Santos;maria.santos@exemplo.com.br;ROLE_PORTAL_USER|ROLE_PORTAL_ADMIN`, e a etapa de Upload MUST mostrar esse formato e o link para o modelo.

#### Scenario: Download do modelo
- **WHEN** o usuário clica em "Baixar modelo CSV" na Importação completa
- **THEN** o navegador baixa o modelo com a coluna de grupo raiz e os subgrupos separados por `|`
