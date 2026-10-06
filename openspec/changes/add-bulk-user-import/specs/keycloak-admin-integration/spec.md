## ADDED Requirements

### Requirement: Configuração por variáveis de ambiente
O backend SHALL ler a configuração de acesso ao RH-SSO de variáveis de ambiente do sistema ou de um arquivo `.env`, sendo que variáveis do sistema MUST ter precedência sobre o `.env`. As variáveis obrigatórias são `KEYCLOAK_BASE_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` e `KEYCLOAK_CLIENT_SECRET`.

#### Scenario: Configuração completa
- **WHEN** o backend inicia com todas as variáveis obrigatórias definidas
- **THEN** a aplicação sobe normalmente e usa esses valores nas chamadas ao RH-SSO

#### Scenario: Variável obrigatória ausente
- **WHEN** o backend inicia sem `KEYCLOAK_CLIENT_SECRET`
- **THEN** a inicialização falha com uma mensagem indicando qual variável está faltando

#### Scenario: Variável do sistema sobrepõe o .env
- **WHEN** `KEYCLOAK_REALM` está definida no `.env` e também como variável de ambiente do sistema
- **THEN** o backend usa o valor da variável de ambiente do sistema

### Requirement: Autenticação via Client Credentials
O backend SHALL obter o access token no endpoint `{KEYCLOAK_BASE_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token` usando `grant_type=client_credentials`, MUST reutilizar o token em cache enquanto ele for válido e MUST renová-lo antes da expiração.

#### Scenario: Reuso do token
- **WHEN** duas chamadas administrativas são feitas dentro do prazo de validade do token
- **THEN** apenas uma requisição de token é feita ao RH-SSO

#### Scenario: Token expirado durante um job longo
- **WHEN** o token expira enquanto um job de importação está em andamento
- **THEN** o backend obtém um novo token e o job continua sem falhar linhas por causa disso

#### Scenario: Resposta 401 inesperada
- **WHEN** uma chamada administrativa retorna 401
- **THEN** o backend descarta o token em cache, obtém um novo e repete a chamada uma única vez

### Requirement: Controle de taxa de requisições
Todas as requisições ao RH-SSO SHALL passar por um limitador único que respeite `KC_MAX_CONCURRENCY` (padrão `1`) requisições simultâneas e `KC_MIN_INTERVAL_MS` (padrão `300`) milissegundos entre o início de requisições consecutivas.

#### Scenario: Concorrência padrão
- **WHEN** o job tem 100 linhas a processar e a configuração está no padrão
- **THEN** nunca há mais de uma requisição ao RH-SSO em andamento ao mesmo tempo

#### Scenario: Intervalo mínimo
- **WHEN** `KC_MIN_INTERVAL_MS=500`
- **THEN** o início de duas requisições consecutivas ao RH-SSO é separado por pelo menos 500 ms

### Requirement: Retry com backoff para falhas transitórias
O backend SHALL repetir requisições que falharem com status 429, 502, 503, 504 ou erro de rede, até `KC_MAX_RETRIES` vezes (padrão `5`), com backoff exponencial, e MUST respeitar o cabeçalho `Retry-After` quando presente.

#### Scenario: 429 com Retry-After
- **WHEN** o RH-SSO responde 429 com `Retry-After: 10`
- **THEN** o backend aguarda pelo menos 10 segundos antes de repetir a requisição

#### Scenario: Retentativas esgotadas
- **WHEN** uma requisição falha com 503 em todas as `KC_MAX_RETRIES` tentativas
- **THEN** a operação é considerada falha e o erro é propagado para quem a chamou

### Requirement: Detecção de bloqueio do WAF
O backend SHALL tratar como bloqueio do WAF qualquer resposta 403 cujo corpo não seja JSON (por exemplo, uma página HTML) e MUST sinalizar esse bloqueio de forma distinta de um erro de permissão do Keycloak, sem fazer novas tentativas automáticas.

#### Scenario: Página de bloqueio HTML
- **WHEN** uma requisição retorna 403 com `Content-Type: text/html`
- **THEN** o backend emite um erro do tipo "bloqueio do WAF" e não repete a requisição

#### Scenario: 403 do próprio Keycloak
- **WHEN** uma requisição retorna 403 com corpo JSON do Keycloak
- **THEN** o backend emite um erro de permissão insuficiente do client

### Requirement: Suporte a proxy e CA corporativa
O backend SHALL rotear as requisições ao RH-SSO pelo proxy definido em `HTTPS_PROXY`/`HTTP_PROXY`, respeitando `NO_PROXY`, e MUST funcionar com destinos HTTPS através de proxy HTTP (túnel `CONNECT`). Certificados adicionais MUST ser aceitos via `NODE_EXTRA_CA_CERTS`.

#### Scenario: Proxy configurado
- **WHEN** `HTTPS_PROXY=http://proxy.empresa:8080` está definido e `KEYCLOAK_BASE_URL` é HTTPS
- **THEN** todas as requisições ao RH-SSO passam pelo proxy informado

#### Scenario: Host em NO_PROXY
- **WHEN** o host de `KEYCLOAK_BASE_URL` está listado em `NO_PROXY`
- **THEN** as requisições ao RH-SSO são feitas diretamente, sem proxy

### Requirement: Verificação de conectividade
O backend SHALL expor um endpoint de saúde que informe se é possível obter token e acessar a Admin API do realm configurado.

#### Scenario: RH-SSO acessível
- **WHEN** o frontend consulta o endpoint de saúde e o token é obtido com sucesso
- **THEN** a resposta indica conexão OK e o nome do realm configurado

#### Scenario: Credenciais inválidas
- **WHEN** o RH-SSO recusa as credenciais do client
- **THEN** a resposta indica falha de autenticação, sem expor o secret

#### Scenario: Ações obrigatórias configuradas
- **WHEN** o frontend consulta o endpoint de saúde
- **THEN** a resposta inclui a lista de ações obrigatórias aplicadas a usuários novos (`KC_NEW_USER_REQUIRED_ACTIONS`)

### Requirement: Validação das ações obrigatórias configuradas
O backend SHALL validar na inicialização que cada item de `KC_NEW_USER_REQUIRED_ACTIONS` é um alias de ação obrigatória conhecido do Keycloak 16 (`UPDATE_PROFILE`, `UPDATE_PASSWORD`, `VERIFY_EMAIL`, `CONFIGURE_TOTP`, `terms_and_conditions`).

#### Scenario: Alias inválido
- **WHEN** `KC_NEW_USER_REQUIRED_ACTIONS=UPDATE_PROFILES`
- **THEN** a inicialização falha indicando o alias desconhecido
