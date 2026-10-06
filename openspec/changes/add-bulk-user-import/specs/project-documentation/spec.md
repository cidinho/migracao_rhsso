## ADDED Requirements

### Requirement: README principal na raiz
O repositório SHALL ter um `README.md` na raiz, em português, como referência única da aplicação. Os arquivos `backend/README.md` e `frontend/README.md`, se existirem, MUST apenas apontar para o README da raiz, e o README herdado do template Materio MUST ser substituído.

#### Scenario: Leitor novo no projeto
- **WHEN** uma pessoa abre o repositório pela primeira vez
- **THEN** o `README.md` da raiz explica o que a aplicação faz, como configurá-la e como executá-la, sem depender de outros documentos

### Requirement: Documentação das funcionalidades e do fluxo
O README SHALL descrever as funcionalidades da aplicação e o fluxo de uso nas cinco etapas (Upload, Revisão, Grupos, Confirmação, Resultado), incluindo um diagrama da arquitetura (navegador → Nuxt → NestJS → proxy/WAF → RH-SSO) e a tabela de decisão por usuário, com os status `CRIADO`, `GRUPOS_ADICIONADOS`, `SEM_ALTERACAO`, `ERRO` e `NAO_PROCESSADO` e os status por grupo `ADICIONADO`, `JA_POSSUIA` e `FALHOU`.

#### Scenario: Entender o resultado de uma linha
- **WHEN** o operador vê uma linha com status `SEM_ALTERACAO` no relatório
- **THEN** o README explica que o usuário já existia e já possuía todos os grupos selecionados, e que nada foi alterado

#### Scenario: Entender o efeito sobre usuários novos
- **WHEN** o operador consulta o README sobre usuários criados
- **THEN** o README informa que eles são criados sem senha, com a ação obrigatória de atualizar o perfil no próximo login, e explica o motivo (nome e sobrenome derivados da coluna NOME)

### Requirement: Documentação do formato do CSV
O README SHALL documentar as colunas esperadas (`UID`, `NOME`, `Email`), os separadores e codificações aceitos, as regras de validação, a regra de divisão de NOME em nome e sobrenome, a conversão do UID para minúsculas, os limites de tamanho e de linhas e onde baixar o modelo. Os UIDs dos exemplos MUST seguir o formato `t_abc1234`, coerente com a tela de Upload e com o modelo CSV.

#### Scenario: Exemplo de CSV no README
- **WHEN** o operador lê o exemplo de planilha no README
- **THEN** os UIDs aparecem no formato `t_abc1234` (por exemplo, `t_abc1234` e `t_xyz9876`)

#### Scenario: Preparar a planilha
- **WHEN** o operador prepara uma planilha seguindo apenas o README
- **THEN** a planilha é aceita pela aplicação sem erros de formato

### Requirement: Pré-requisitos no RH-SSO
O README SHALL listar a configuração necessária no realm de destino: client confidencial com *service account*, papéis `realm-management` (`manage-users`, `view-users`, `query-groups`), ação obrigatória Update Profile habilitada e a observação sobre e-mails duplicados e o fluxo de redefinição de senha.

#### Scenario: Preparar o client
- **WHEN** um administrador do RH-SSO segue a seção de pré-requisitos
- **THEN** o client criado permite que a aplicação obtenha token, liste grupos, busque e crie usuários e atribua grupos

### Requirement: Instruções de configuração do .env do backend
O README SHALL ter uma seção de configuração do backend com uma tabela de todas as variáveis (nome, obrigatória ou não, valor padrão e descrição), um exemplo completo de `backend/.env`, a regra de precedência (variáveis do sistema sobre o `.env`) e orientações específicas para proxy (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`), CA corporativa (`NODE_EXTRA_CA_CERTS`) e ajuste de taxa para o WAF. O repositório MUST conter `backend/.env.example` com as mesmas variáveis e nenhum segredo real.

#### Scenario: Configurar do zero
- **WHEN** a pessoa copia `backend/.env.example` para `backend/.env` e preenche as variáveis obrigatórias conforme o README
- **THEN** o backend inicia e o endpoint de saúde indica conexão com o RH-SSO

#### Scenario: Consistência entre README e código
- **WHEN** uma variável é adicionada, removida ou tem o padrão alterado no schema de configuração do backend
- **THEN** a tabela do README e o `backend/.env.example` refletem a mesma mudança

### Requirement: Instruções de configuração do .env do frontend
O README SHALL ter uma seção de configuração do frontend com a tabela das variáveis (`NUXT_BACKEND_URL`, host e porta do servidor Nuxt), um exemplo de `frontend/.env` e a diferença entre desenvolvimento (`.env` lido automaticamente) e produção (variáveis do sistema ou `node --env-file`). O repositório MUST conter `frontend/.env.example`.

#### Scenario: Apontar para outro backend sem rebuild
- **WHEN** a pessoa altera `NUXT_BACKEND_URL` no ambiente de produção e reinicia o servidor do frontend
- **THEN** o frontend passa a encaminhar `/api` para o novo endereço sem precisar de um novo build

### Requirement: Execução e solução de problemas
O README SHALL documentar os comandos de instalação, desenvolvimento, build e execução em produção de cada aplicação, além de uma seção de solução de problemas cobrindo, no mínimo: credenciais inválidas (401), permissão insuficiente (403 do Keycloak), bloqueio do WAF (403 HTML e job pausado), falha de proxy/certificado, acentos corrompidos no CSV e as limitações conhecidas (aplicação sem autenticação, jobs perdidos em reinício).

#### Scenario: Job pausado pelo WAF
- **WHEN** o operador vê o job pausado por bloqueio do WAF
- **THEN** o README explica o que aconteceu, como ajustar `KC_MAX_CONCURRENCY` e `KC_MIN_INTERVAL_MS` e como retomar o job
