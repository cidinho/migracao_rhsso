## ADDED Requirements

### Requirement: Criação do job de importação
O backend SHALL criar um job de importação a partir da lista de linhas válidas e dos IDs dos grupos selecionados, revalidando as linhas no servidor, e MUST responder imediatamente com o identificador do job, processando-o em segundo plano.

#### Scenario: Job criado
- **WHEN** o frontend envia 500 linhas válidas e 2 grupos
- **THEN** o backend responde com o `jobId` sem aguardar o processamento das linhas

#### Scenario: Grupo inexistente
- **WHEN** um dos IDs de grupo enviados não existe no realm
- **THEN** o job não é criado e a resposta indica qual grupo é inválido

### Requirement: Levantamento prévio de membros dos grupos
Antes de processar as linhas, o job SHALL obter os membros diretos de cada grupo selecionado, de forma paginada (`KC_MEMBERS_PAGE_SIZE`, padrão 500), e MUST usar esse conjunto para decidir se um usuário existente já pertence ao grupo, sem consultar os grupos de cada usuário individualmente.

#### Scenario: Usuário já membro
- **WHEN** o username `t_abc1234` está entre os membros diretos do grupo selecionado
- **THEN** nenhuma requisição de atribuição desse grupo é feita para `t_abc1234`

### Requirement: Usuário inexistente é criado com os grupos
Para cada linha cujo username não existe no realm, o job SHALL criar o usuário com `username`, `email`, `firstName`, `lastName`, `enabled=true`, `emailVerified` conforme `KC_EMAIL_VERIFIED` (padrão `true`) e sem credenciais, e em seguida MUST atribuir todos os grupos selecionados.

#### Scenario: Criação bem-sucedida
- **WHEN** o username `t_abc1234` não existe e há 2 grupos selecionados
- **THEN** o usuário é criado, os 2 grupos são atribuídos e a linha fica com status `CRIADO` e os 2 grupos como `ADICIONADO`

#### Scenario: Usuário criado em paralelo por outro processo
- **WHEN** a criação retorna 409 porque o username passou a existir após a busca
- **THEN** o job busca o usuário novamente e segue o fluxo de usuário existente, sem adicionar ações obrigatórias

### Requirement: Atualização de perfil obrigatória para usuários criados
Como `firstName` e `lastName` são derivados automaticamente da coluna `NOME`, todo usuário criado pela importação SHALL ser criado com as ações obrigatórias definidas em `KC_NEW_USER_REQUIRED_ACTIONS` (padrão `UPDATE_PROFILE`), enviadas no próprio corpo da criação (`requiredActions`), sem requisição adicional. Usuários que já existiam MUST NOT receber ações obrigatórias nem ter as existentes alteradas.

#### Scenario: Usuário novo
- **WHEN** o usuário `t_abc1234` é criado pela importação
- **THEN** ele é criado com `requiredActions` contendo `UPDATE_PROFILE` e, no próximo login, o Keycloak exige que ele confirme ou corrija nome, sobrenome e demais dados do perfil

#### Scenario: Usuário existente
- **WHEN** o usuário já existe e recebe novos grupos pela importação
- **THEN** as ações obrigatórias do usuário permanecem exatamente como estavam

#### Scenario: Configuração personalizada
- **WHEN** `KC_NEW_USER_REQUIRED_ACTIONS=UPDATE_PROFILE,UPDATE_PASSWORD`
- **THEN** os usuários criados recebem as duas ações obrigatórias

#### Scenario: Configuração vazia
- **WHEN** `KC_NEW_USER_REQUIRED_ACTIONS` está definida como vazia
- **THEN** os usuários são criados sem ações obrigatórias

### Requirement: Usuário existente recebe apenas os grupos faltantes
Para cada linha cujo username já existe, o job SHALL atribuir somente os grupos selecionados que o usuário ainda não possui e MUST NOT alterar nome, e-mail, status, credenciais ou ações obrigatórias do usuário.

#### Scenario: Faltam alguns grupos
- **WHEN** o usuário existe e possui 1 dos 2 grupos selecionados
- **THEN** apenas o grupo faltante é atribuído; a linha fica com status `GRUPOS_ADICIONADOS`, o grupo atribuído como `ADICIONADO` e o outro como `JA_POSSUIA`

#### Scenario: Dados divergentes
- **WHEN** o usuário existe com e-mail diferente do informado na planilha
- **THEN** o e-mail no RH-SSO não é alterado e o resultado da linha registra um aviso de divergência

### Requirement: Usuário existente que já possui todos os grupos
Quando o usuário já existe e já possui todos os grupos selecionados, o job SHALL não fazer nenhuma alteração e MUST registrar a linha com status `SEM_ALTERACAO`, indicando que o usuário já existia e já possuía os grupos.

#### Scenario: Nada a fazer
- **WHEN** o usuário existe e já é membro de todos os grupos selecionados
- **THEN** nenhuma requisição de escrita é feita para esse usuário e a linha aparece como "Usuário já existia e já possuía o(s) grupo(s)"

### Requirement: Isolamento de falhas por linha
Uma falha ao processar uma linha SHALL NOT interromper o processamento das demais (exceto em bloqueio do WAF). A linha com falha MUST ficar com status `ERRO` e a mensagem do erro; quando o usuário tiver sido criado mas algum grupo falhar, o resultado MUST indicar o que foi concluído e o que falhou.

#### Scenario: Falha na atribuição de um grupo
- **WHEN** o usuário é criado, mas a atribuição de um dos grupos falha após as retentativas
- **THEN** a linha fica com status `ERRO`, o usuário é indicado como criado, o grupo que falhou como `FALHOU` e o job segue para a próxima linha

### Requirement: Pausa automática em bloqueio do WAF
Quando uma requisição for identificada como bloqueio do WAF, o job SHALL entrar no estado `PAUSADO`, sem marcar a linha em andamento como erro, e MUST poder ser retomado pelo usuário a partir dessa linha.

#### Scenario: Bloqueio no meio do job
- **WHEN** o WAF bloqueia uma requisição durante o processamento da linha 230
- **THEN** o job fica `PAUSADO`, as linhas 1 a 229 mantêm seus resultados e a linha 230 continua pendente

#### Scenario: Retomada
- **WHEN** o usuário aciona "Retomar" em um job pausado
- **THEN** o processamento recomeça pela linha pendente

### Requirement: Cancelamento
O usuário SHALL poder cancelar um job em andamento ou pausado; as linhas já processadas MUST manter seus resultados e as não processadas MUST ficar com status `NAO_PROCESSADO`.

#### Scenario: Cancelar no meio
- **WHEN** o usuário cancela o job após 100 de 300 linhas
- **THEN** o job termina como `CANCELADO`, com 100 resultados e 200 linhas `NAO_PROCESSADO`

### Requirement: Acompanhamento do progresso
O backend SHALL expor o estado do job (status, total de linhas, processadas, contagem por status e resultados por linha) para consulta periódica pelo frontend.

#### Scenario: Consulta durante a execução
- **WHEN** o frontend consulta um job com 120 de 500 linhas processadas
- **THEN** a resposta informa 120 processadas, as contagens por status e os resultados dessas 120 linhas

### Requirement: Relatório exportável
O backend SHALL gerar o relatório do job em CSV, com uma linha por usuário contendo: linha da planilha, UID, username gravado, firstName e lastName gravados, status, ações obrigatórias aplicadas (somente para usuários criados), grupos adicionados, grupos que já possuía, grupos com falha e mensagem.

#### Scenario: Download do relatório
- **WHEN** o usuário clica em "Baixar relatório" em um job concluído
- **THEN** o navegador baixa um CSV com o resultado de todas as linhas

### Requirement: Reprocessamento de erros
O sistema SHALL permitir criar um novo job contendo apenas as linhas com status `ERRO` (e `NAO_PROCESSADO`, se houver) de um job finalizado, usando os mesmos grupos. Por causa das regras de idempotência, o reprocessamento MUST NOT duplicar usuários nem atribuições.

#### Scenario: Reprocessar após falha de grupo
- **WHEN** uma linha terminou em `ERRO` porque o usuário foi criado mas um grupo falhou, e o usuário reprocessa os erros
- **THEN** no novo job o usuário é tratado como existente e recebe apenas o grupo que faltava

### Requirement: Registro de auditoria
O backend SHALL registrar, em arquivo de log estruturado, cada job com data/hora de início e fim, nome do arquivo, grupos selecionados, contagens por status e o resultado de cada linha, sem registrar o secret do client.

#### Scenario: Job concluído
- **WHEN** um job termina, com qualquer status final
- **THEN** o log de auditoria contém o registro desse job com o resumo e os resultados
