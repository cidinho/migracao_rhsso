## ADDED Requirements

### Requirement: Listagem da árvore de grupos
O backend SHALL disponibilizar a árvore completa de grupos e subgrupos do realm configurado, com `id`, `name`, `path` e filhos de cada grupo, mantendo-a em cache por `GROUPS_CACHE_TTL_SECONDS` (padrão 300) para economizar requisições ao RH-SSO.

#### Scenario: Árvore com subgrupos
- **WHEN** o realm tem o grupo `APP.PORTAL` com o subgrupo `ROLE_PORTAL_USER`
- **THEN** a resposta contém o subgrupo dentro do grupo pai, com `path` igual a `/APP.PORTAL/ROLE_PORTAL_USER`

#### Scenario: Cache válido
- **WHEN** a árvore é solicitada duas vezes dentro do TTL
- **THEN** o RH-SSO é consultado apenas uma vez

#### Scenario: Atualização forçada
- **WHEN** o usuário aciona "Atualizar grupos"
- **THEN** o cache é ignorado e a árvore é buscada novamente no RH-SSO

### Requirement: Busca na árvore
O frontend SHALL permitir filtrar a árvore por texto, comparando com o nome e o path dos grupos sem diferenciar maiúsculas/minúsculas, e MUST manter visíveis os ancestrais dos grupos encontrados.

#### Scenario: Busca por parte do nome
- **WHEN** o usuário digita "portal"
- **THEN** são exibidos os grupos cujo nome ou path contém "portal", com seus grupos pais

### Requirement: Seleção independente por nó
A seleção de um grupo SHALL afetar apenas esse grupo: selecionar um grupo pai MUST NOT selecionar seus subgrupos, e selecionar um subgrupo MUST NOT selecionar o pai. Qualquer nó da árvore, de qualquer nível, MUST ser selecionável.

#### Scenario: Selecionar subgrupo
- **WHEN** o usuário seleciona `/APP.PORTAL/ROLE_PORTAL_USER`
- **THEN** apenas esse grupo fica selecionado, e o pai `/APP.PORTAL` não

#### Scenario: Selecionar pai
- **WHEN** o usuário seleciona `/APP.PORTAL`
- **THEN** os subgrupos de `/APP.PORTAL` continuam não selecionados

### Requirement: Resumo da seleção
O frontend SHALL exibir os grupos selecionados como itens removíveis que mostram o path completo, e MUST exigir pelo menos um grupo selecionado para avançar.

#### Scenario: Remover pelo resumo
- **WHEN** o usuário remove um grupo pelo resumo da seleção
- **THEN** o grupo é desmarcado também na árvore

#### Scenario: Nenhum grupo selecionado
- **WHEN** nenhum grupo está selecionado
- **THEN** a ação de avançar fica desabilitada, com a indicação de que é preciso escolher ao menos um grupo
