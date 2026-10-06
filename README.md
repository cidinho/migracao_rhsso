# Importação de usuários em lote no RH-SSO

Aplicação web para criar usuários em lote no RH-SSO (Keycloak 16) a partir de uma planilha CSV e atribuir a eles, em massa, os grupos escolhidos numa árvore.

- [1. Visão geral](#1-visão-geral)
- [2. Arquitetura](#2-arquitetura)
- [3. Funcionalidades](#3-funcionalidades)
- [4. Fluxo da importação](#4-fluxo-da-importação)
- [5. Formato do CSV](#5-formato-do-csv)
- [6. Pré-requisitos](#6-pré-requisitos)
- [7. Configuração](#7-configuração)
- [8. Execução](#8-execução)
- [9. Relatório, reprocessamento e log de auditoria](#9-relatório-reprocessamento-e-log-de-auditoria)
- [10. Solução de problemas e limitações conhecidas](#10-solução-de-problemas-e-limitações-conhecidas)

## 1. Visão geral

O operador envia um CSV com as colunas `UID`, `NOME` e `Email`, confere as linhas, escolhe os grupos (por exemplo `/APP.PORTAL/ROLE_PORTAL_USER`) e clica em **Importar**. Para cada linha, a aplicação:

- **cria o usuário** se ele não existir no realm, já com os grupos selecionados e com a ação obrigatória de **atualizar o perfil** no próximo login;
- **acrescenta apenas os grupos que faltam** se o usuário já existir, sem alterar nenhum outro dado dele;
- **não faz nada** se o usuário já existir e já possuir todos os grupos, e informa isso no resultado ("já existia e já possuía os grupos").

A comunicação com o RH-SSO usa um client com *Client Credentials* configurado no backend. As requisições são enfileiradas e espaçadas para não acionar o WAF, e podem passar por um proxy corporativo.

O repositório tem duas aplicações:

| Pasta | Tecnologia | Papel |
| --- | --- | --- |
| `backend/` | NestJS 12 (Node.js) | Fala com o RH-SSO, valida o CSV, executa e acompanha as importações. |
| `frontend/` | Nuxt 3 + Vuetify 3 (template Materio, tema escuro) | Assistente de importação em 5 etapas. |

## 2. Arquitetura

```mermaid
flowchart LR
    U[Navegador do operador] -->|HTTP /| N[Frontend Nuxt<br/>porta 3000]
    N -->|/api/* repassado pelo servidor Nuxt| B[Backend NestJS<br/>porta 3001]
    B -->|token client_credentials<br/>Admin REST API| P{Proxy corporativo<br/>opcional}
    P --> W[WAF]
    W --> K[(RH-SSO / Keycloak 16<br/>realm de destino)]
    B -.->|JSONL| L[(Log de auditoria<br/>AUDIT_LOG_DIR)]
```

- O navegador fala **somente** com o frontend. O servidor Nuxt repassa tudo o que começa com `/api` para o backend (`NUXT_BACKEND_URL`), então não há CORS nem endereço do backend exposto ao navegador.
- O **segredo do client** fica apenas no backend.
- O backend obtém o token com `client_credentials`, guarda-o em cache e renova antes de expirar.
- Todas as chamadas ao RH-SSO passam por um **limitador de taxa** (concorrência máxima + intervalo mínimo entre requisições) e por uma política de **retentativas com backoff** exponencial.
- As importações (*jobs*) ficam **em memória** no backend. O frontend acompanha o progresso consultando o job a cada 1,5 s.

Endpoints do backend (prefixo `/api`):

| Método e caminho | Uso |
| --- | --- |
| `GET /health?refresh=true` | Testa a conexão com o RH-SSO e devolve o realm e os parâmetros de taxa. |
| `GET /groups?refresh=true` | Árvore de grupos e subgrupos do realm (cache de `GROUPS_CACHE_TTL_SECONDS`). |
| `GET /imports/template.csv` | Modelo de planilha. |
| `POST /imports/preview` | Recebe o CSV (`multipart/form-data`, campo `file`) e devolve as linhas validadas. |
| `POST /imports` | Cria e inicia uma importação (`fileName`, `groupIds`, `rows`). |
| `GET /imports/:id?since=n` | Situação do job e resultados novos desde o cursor `since`. |
| `POST /imports/:id/pause` · `resume` · `cancel` | Controle do job. |
| `POST /imports/:id/retry-errors` | Cria um novo job só com as linhas com erro ou não processadas. |
| `GET /imports/:id/report.csv` | Relatório da importação. |

## 3. Funcionalidades

- **Upload de CSV** por arrastar e soltar ou pelo botão, acessível por teclado, com detecção automática de separador (`;` ou `,`) e de codificação (UTF-8 ou padrão do Excel).
- **Revisão** das linhas antes de importar: linhas inválidas destacadas com o motivo, filtro "só inválidas", busca e remoção de linhas.
- **Árvore de grupos** com busca (mantém os grupos pais visíveis), seleção independente de cada grupo e subgrupo, chips dos selecionados e botão para recarregar do RH-SSO.
- **Confirmação** com resumo: usuários, linhas ignoradas, grupos com caminho completo, realm de destino e estimativa de tempo.
- **Execução controlada**: barra de progresso, contadores, botões **Pausar**, **Retomar** e **Cancelar**, e pausa automática se o WAF bloquear.
- **Resultado** com cartões de totais que funcionam como filtro, tabela com o detalhe de cada grupo por usuário, avisos de divergência e as ações **Baixar relatório**, **Reprocessar erros** e **Nova importação**.
- **Idempotência**: reexecutar a mesma planilha não duplica nada; as linhas já aplicadas aparecem como "Sem alteração".
- **Proxy HTTP/HTTPS** e **CA corporativa** configuráveis.
- **Log de auditoria** em JSON Lines com o resultado de cada importação.
- Indicador do **realm e do estado da conexão** no cabeçalho, tema escuro e textos em português.

## 4. Fluxo da importação

### 4.1 As cinco etapas

1. **Upload**: envie o CSV. O backend valida o arquivo e as linhas e devolve a prévia.
2. **Revisão**: confira as linhas. As inválidas são ignoradas na importação; corrija a planilha e envie de novo se quiser incluí-las. Também é possível remover linhas válidas.
3. **Grupos**: marque os grupos que serão atribuídos a **todos** os usuários da planilha. Marcar um grupo não marca os subgrupos, e vice-versa.
4. **Confirmação**: confira o resumo e clique em **Importar**. O botão só fica habilitado com o RH-SSO acessível.
5. **Resultado**: acompanhe o progresso e, ao final, consulte o resultado e baixe o relatório.

Antes de iniciar, é possível voltar a qualquer etapa sem perder o que foi preenchido. Depois de iniciar, o assistente fica preso na etapa 5 até você clicar em **Nova importação**. Fechar a aba durante a execução pede confirmação, mas o job continua rodando no backend.

### 4.2 O que acontece com cada usuário

Antes de processar as linhas (situação **Preparando**), o backend lê os membros atuais de cada grupo selecionado. Em seguida, para cada linha:

```mermaid
flowchart TD
    A[Linha do CSV] --> B{Usuário existe?<br/>busca exata pelo username}
    B -- não --> C[Cria o usuário<br/>enabled, emailVerified,<br/>ação obrigatória UPDATE_PROFILE]
    C --> D[Atribui todos os grupos selecionados]
    D --> S1([CRIADO])
    B -- sim --> E{Já possui todos<br/>os grupos?}
    E -- sim --> S3([SEM_ALTERACAO<br/>nada é alterado])
    E -- não --> F[Atribui só os grupos que faltam]
    F --> S2([GRUPOS_ADICIONADOS])
    D -. falha em algum grupo .-> S4([ERRO])
    F -. falha em algum grupo .-> S4
```

- Usuários existentes **nunca** têm nome, e-mail, senha ou ações obrigatórias alterados. Se o nome ou o e-mail do RH-SSO divergir da planilha, a linha recebe um **aviso**, mas nada é mudado.
- Se outro processo criar o usuário entre a busca e a criação (resposta 409), ele é tratado como existente.
- Os grupos são apenas **acrescentados**; a aplicação não remove ninguém de grupo algum.

**Status por linha**

| Status | Rótulo na tela | Significado |
| --- | --- | --- |
| `CRIADO` | Criado | O usuário não existia: foi criado e recebeu os grupos. Deverá atualizar o perfil no próximo login. |
| `GRUPOS_ADICIONADOS` | Grupos adicionados | O usuário já existia e recebeu os grupos que faltavam. |
| `SEM_ALTERACAO` | Sem alteração | O usuário já existia e já possuía todos os grupos selecionados. Nada foi alterado. |
| `ERRO` | Erro | A linha falhou, ou ao menos um grupo não pôde ser atribuído. A mensagem diz o motivo e se o usuário chegou a ser criado. |
| `NAO_PROCESSADO` | Não processado | A importação foi cancelada antes de chegar a esta linha. |

**Status por grupo** (no detalhe de cada linha e no relatório)

| Status | Rótulo na tela | Significado |
| --- | --- | --- |
| `ADICIONADO` | Adicionado | O grupo foi atribuído agora. |
| `JA_POSSUIA` | Já possuía | O usuário já era membro; nenhuma requisição foi feita. |
| `FALHOU` | Falhou | A atribuição falhou; a mensagem do RH-SSO aparece junto. |

**Situação do job**: `PREPARANDO` → `EXECUTANDO` ⇄ `PAUSADO` → `CONCLUIDO`, `CANCELADO` ou `FALHOU`. Um job vai para `FALHOU` quando não consegue nem preparar a execução, por exemplo se o client não tiver permissão para listar os membros dos grupos.

### 4.3 Usuários novos: atualização de perfil obrigatória

Os usuários criados:

- ficam **habilitados** (`enabled`), com `emailVerified` conforme `KC_EMAIL_VERIFIED` (padrão `true`, já que os e-mails foram validados na origem);
- são criados **sem senha**. A senha é definida pelo próprio usuário no fluxo de redefinição do RH-SSO (veja a seção [6.2](#62-no-rh-sso-realm-de-destino));
- recebem a ação obrigatória **Update Profile** (`UPDATE_PROFILE`), configurável em `KC_NEW_USER_REQUIRED_ACTIONS`.

O motivo da ação obrigatória: o nome e o sobrenome são **derivados automaticamente** da coluna `NOME` (a primeira palavra vira o nome e o restante o sobrenome), e essa divisão pode estar errada para nomes compostos ("Ana Maria" + "Novo" em vez de "Ana" + "Maria Novo"). No primeiro login, o RH-SSO mostra o formulário de perfil para o usuário corrigir. Usuários que já existiam **não** recebem essa ação.

### 4.4 Pausar, retomar e cancelar

- **Pausar**: termina a linha em andamento e para. **Retomar** continua de onde parou.
- **Bloqueio do WAF**: se o RH-SSO responder `403` com corpo que não é JSON (página HTML do WAF), o job **pausa sozinho** e mostra um alerta. A linha em andamento volta para a fila, e o que já tinha sido feito nela (por exemplo, o usuário já criado) é preservado, então retomar não duplica nada.
- **Cancelar** pede confirmação. As linhas já processadas mantêm o resultado e as restantes ficam como `NAO_PROCESSADO`, podendo ser reprocessadas depois.

## 5. Formato do CSV

Baixe o modelo pelo link **Baixar modelo CSV** na etapa de Upload (ou em `GET /api/imports/template.csv`).

```csv
UID;NOME;Email
t_abc1234;Maria da Silva Santos;maria.santos@exemplo.com.br
t_xyz9876;João Conceição;joao.conceicao@exemplo.com.br
```

| Coluna | Obrigatória | Regra |
| --- | --- | --- |
| `UID` | sim | Vira o **login** (username) **em minúsculas**. Não pode ter espaços nem se repetir na planilha (a comparação ignora maiúsculas e minúsculas). |
| `NOME` | sim | Nome completo. A **primeira palavra** vira o *nome* (`firstName`) e **o restante** vira o *sobrenome* (`lastName`). Com uma só palavra, o sobrenome fica vazio. Espaços repetidos são normalizados. |
| `Email` | sim | Precisa ter formato de e-mail. Pode se repetir entre usuários se o realm permitir e-mails duplicados. |

- O cabeçalho é obrigatório. Os nomes das colunas não diferenciam maiúsculas e minúsculas e podem estar em qualquer ordem. Colunas extras são ignoradas.
- **Separador**: `;` ou `,`, detectado pela primeira linha. Valores com separador ou aspas devem estar entre aspas duplas, como de costume no CSV.
- **Codificação**: UTF-8 (com ou sem BOM) ou Windows-1252 (o "CSV" padrão do Excel em português), detectada automaticamente.
- **Extensão**: `.csv`. Arquivos do Excel (`.xlsx`/`.xls`) são recusados com instruções para salvar como CSV.
- Linhas totalmente vazias são ignoradas.
- **Limites**: até 5 MB (`UPLOAD_MAX_BYTES`) e 10.000 linhas de dados (`UPLOAD_MAX_ROWS`).

Linhas com problema aparecem na Revisão com o motivo: `UID vazio`, `UID não pode conter espaços`, `NOME vazio`, `E-mail vazio`, `E-mail com formato inválido` ou `UID duplicado (já aparece na linha N)`. Elas são ignoradas na importação.

> No Excel, use **Arquivo › Salvar como › CSV UTF-8 (delimitado por vírgulas)**. O formato "CSV (separado por vírgulas)" também funciona.

## 6. Pré-requisitos

### 6.1 Ferramentas

- **Node.js 22 LTS ou superior** (desenvolvido e testado com o Node.js 24). O simulador do Keycloak usado nos testes roda arquivos `.ts` direto, o que exige o Node.js 22.18+ ou 23.6+.
- **npm** para o backend (já vem com o Node.js).
- **pnpm 9** para o frontend: `npm install -g pnpm@9` ou `corepack enable`.
- Acesso de rede do servidor do backend ao RH-SSO, direto ou via proxy.

### 6.2 No RH-SSO (realm de destino)

As telas abaixo são do console administrativo do RH-SSO 7.x / Keycloak 16.

1. **Client confidencial com service account** (*Clients › Create*):
   - *Client ID*: por exemplo `importador-usuarios`. Esse valor vai em `KEYCLOAK_CLIENT_ID`.
   - *Access Type*: `confidential`.
   - *Service Accounts Enabled*: **ON**. Desligue *Standard Flow* e *Direct Access Grants*, que não são usados.
   - Salve e copie o segredo na aba *Credentials*. Esse valor vai em `KEYCLOAK_CLIENT_SECRET`.
2. **Papéis mínimos** (aba *Service Account Roles* › *Client Roles* › `realm-management`):
   - `query-groups`: listar a árvore de grupos;
   - `view-users`: buscar usuários e listar os membros dos grupos;
   - `manage-users`: criar usuários e atribuir grupos.
3. **Ação obrigatória Update Profile habilitada** (*Authentication › Required Actions*): `Update Profile` com *Enabled* **ON**. Sem isso, o RH-SSO ignora a ação nos usuários criados.
4. **E-mails duplicados** (*Realm Settings › Login*): se a planilha tiver o mesmo e-mail para mais de um usuário, ligue *Duplicate emails*. O Keycloak exige *Login with email* **desligado** nesse caso. Com a opção desligada, a criação de um segundo usuário com o mesmo e-mail falha e a linha fica com `ERRO`.
5. **Redefinição de senha**: os usuários são criados sem senha. Para eles definirem a senha, habilite *Forgot password* (*Realm Settings › Login*) com o SMTP configurado (*Realm Settings › Email*), ou envie *Credentials › Reset Actions › Update Password* pelo console. Esse processo está fora do escopo desta aplicação.

## 7. Configuração

### 7.1 Backend

O backend lê as variáveis **do ambiente do sistema** e do arquivo **`backend/.env`**. Se uma variável estiver nos dois lugares, **vale a do sistema**. O `.env` é procurado no diretório de onde o processo é iniciado, portanto rode os comandos dentro de `backend/`.

Para começar:

```bash
cd backend
cp .env.example .env   # no Windows (cmd): copy .env.example .env
```

Preencha ao menos as quatro variáveis obrigatórias. Se faltar alguma ou houver valor inválido, o backend não sobe e lista os problemas:

```text
Error: Configuração inválida. Verifique o .env ou as variáveis de ambiente:
  - KEYCLOAK_CLIENT_SECRET: variável obrigatória KEYCLOAK_CLIENT_SECRET não definida
```

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `KEYCLOAK_BASE_URL` | sim | — | URL base do RH-SSO **incluindo o contexto `/auth`** (padrão do Keycloak 16). Ex.: `https://sso.exemplo.com.br/auth`. |
| `KEYCLOAK_REALM` | sim | — | Realm de destino (fixo; a tela não permite trocar). |
| `KEYCLOAK_CLIENT_ID` | sim | — | Client ID do client com service account. |
| `KEYCLOAK_CLIENT_SECRET` | sim | — | Segredo do client. Nunca o versione. |
| `KC_EMAIL_VERIFIED` | não | `true` | `emailVerified` dos usuários criados (`true`/`false`). |
| `KC_NEW_USER_REQUIRED_ACTIONS` | não | `UPDATE_PROFILE` | Ações obrigatórias dos usuários criados, separadas por vírgula. Aceitas: `UPDATE_PROFILE`, `UPDATE_PASSWORD`, `VERIFY_EMAIL`, `CONFIGURE_TOTP`, `terms_and_conditions`. Vazio = nenhuma. |
| `KC_MAX_CONCURRENCY` | não | `1` | Requisições simultâneas ao RH-SSO (1 a 20). |
| `KC_MIN_INTERVAL_MS` | não | `300` | Intervalo mínimo, em ms, entre o início de duas requisições consecutivas. |
| `KC_MAX_RETRIES` | não | `5` | Retentativas em `429`, `502`, `503`, `504` e falhas de rede (0 a 20). |
| `KC_RETRY_BASE_DELAY_MS` | não | `1000` | Base do backoff exponencial: espera base, 2× base, 4× base… até 60 s. O cabeçalho `Retry-After` é respeitado. |
| `KC_REQUEST_TIMEOUT_MS` | não | `30000` | Tempo máximo de cada requisição ao RH-SSO (mínimo 1000). |
| `KC_MEMBERS_PAGE_SIZE` | não | `500` | Tamanho da página ao listar os membros dos grupos (1 a 5000). |
| `GROUPS_CACHE_TTL_SECONDS` | não | `300` | Cache da árvore de grupos, em segundos. `0` desliga. O botão "Atualizar grupos" ignora o cache. |
| `UPLOAD_MAX_BYTES` | não | `5242880` | Tamanho máximo do CSV, em bytes (5 MB). |
| `UPLOAD_MAX_ROWS` | não | `10000` | Número máximo de linhas de dados no CSV. |
| `JOB_RETENTION_MINUTES` | não | `120` | Por quanto tempo um job finalizado continua disponível para consulta e download do relatório. |
| `AUDIT_LOG_DIR` | não | `./logs` | Pasta do log de auditoria (relativa ao diretório de execução). |
| `HTTPS_PROXY` | não | — | Proxy para URLs `https://`. Ex.: `http://proxy.empresa:8080` ou `http://usuario:senha@proxy.empresa:8080`. Aceita também `https_proxy`. |
| `HTTP_PROXY` | não | — | Proxy para URLs `http://`. Aceita também `http_proxy`. |
| `NO_PROXY` | não | — | Hosts que **não** passam pelo proxy, separados por vírgula (ex.: `localhost,127.0.0.1,.empresa.local`). Aceita também `no_proxy`. |
| `HOST` | não | `127.0.0.1` | Interface onde o backend escuta. `127.0.0.1` aceita só conexões da própria máquina, o recomendado quando o frontend roda no mesmo servidor. |
| `PORT` | não | `3001` | Porta do backend. |

Exemplo completo de `backend/.env`:

```dotenv
KEYCLOAK_BASE_URL=https://sso.exemplo.com.br/auth
KEYCLOAK_REALM=meu-realm
KEYCLOAK_CLIENT_ID=importador-usuarios
KEYCLOAK_CLIENT_SECRET=coloque-o-segredo-aqui

KC_EMAIL_VERIFIED=true
KC_NEW_USER_REQUIRED_ACTIONS=UPDATE_PROFILE

KC_MAX_CONCURRENCY=1
KC_MIN_INTERVAL_MS=300
KC_MAX_RETRIES=5
KC_RETRY_BASE_DELAY_MS=1000
KC_REQUEST_TIMEOUT_MS=30000
KC_MEMBERS_PAGE_SIZE=500

GROUPS_CACHE_TTL_SECONDS=300
UPLOAD_MAX_BYTES=5242880
UPLOAD_MAX_ROWS=10000
JOB_RETENTION_MINUTES=120
AUDIT_LOG_DIR=./logs

HTTPS_PROXY=http://proxy.empresa:8080
HTTP_PROXY=
NO_PROXY=localhost,127.0.0.1

HOST=127.0.0.1
PORT=3001
```

#### Proxy corporativo

- O proxy é usado só nas chamadas do backend ao RH-SSO. Como o `KEYCLOAK_BASE_URL` normalmente é `https://`, o que vale na prática é `HTTPS_PROXY`.
- Para `https://`, a conexão passa por túnel (`CONNECT`) e o TLS continua de ponta a ponta com o RH-SSO.
- Se o RH-SSO estiver na rede interna e não deve passar pelo proxy, inclua o host em `NO_PROXY`.

#### CA corporativa (`NODE_EXTRA_CA_CERTS`)

Se o proxy ou o RH-SSO usam certificado emitido por uma CA interna, o Node.js recusa a conexão com erros como `unable to get local issuer certificate` ou `self-signed certificate in certificate chain`. Informe o arquivo PEM da CA em `NODE_EXTRA_CA_CERTS`.

> **Atenção:** `NODE_EXTRA_CA_CERTS` **não funciona no `.env`**, porque o Node.js lê essa variável na inicialização, antes de a aplicação carregar o `.env`. Defina-a no ambiente do sistema ou na linha de comando:
>
> ```bash
> # Linux / Git Bash
> NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-empresa.pem npm run start:prod
> ```
>
> ```powershell
> # Windows PowerShell (sessão atual)
> $env:NODE_EXTRA_CA_CERTS = "C:\certs\ca-empresa.pem"; npm run start:prod
> # Windows (permanente, para novos terminais)
> setx NODE_EXTRA_CA_CERTS "C:\certs\ca-empresa.pem"
> ```

Não use `NODE_TLS_REJECT_UNAUTHORIZED=0`: ele desliga a verificação de certificado de todas as conexões.

#### Ajuste de taxa para o WAF

Com os padrões (`KC_MAX_CONCURRENCY=1`, `KC_MIN_INTERVAL_MS=300`), o backend faz no máximo cerca de 3 requisições por segundo, uma de cada vez. Cada linha custa:

- 1 busca do usuário;
- mais 1 criação, se o usuário for novo;
- mais 1 requisição por grupo que ele ainda não tem.

Antes de começar, há também 1 requisição por página de membros de cada grupo selecionado. Por exemplo, 1.000 usuários novos com 2 grupos dão cerca de 4.000 requisições, ou uns 20 minutos com os padrões. A tela de Confirmação mostra uma estimativa.

- **Se o WAF bloquear** (job pausado com o alerta "bloqueio do WAF"): aumente `KC_MIN_INTERVAL_MS` (por exemplo para `500` ou `1000`) e mantenha `KC_MAX_CONCURRENCY=1`. Reinicie o backend para aplicar. Jobs pausados se perdem no reinício, mas reimportar a planilha é seguro (veja a [seção 10](#10-solução-de-problemas-e-limitações-conhecidas)).
- **Se o WAF for tolerante** e você quiser mais velocidade: reduza `KC_MIN_INTERVAL_MS` aos poucos antes de aumentar a concorrência.
- `429` (*Too Many Requests*) e `503` são tratados com espera e nova tentativa automática, sem pausar o job.

### 7.2 Frontend

O frontend só precisa saber onde está o backend. Todas as chamadas do navegador vão para `/api` no próprio frontend, e o servidor Nuxt as repassa para `NUXT_BACKEND_URL`.

```bash
cd frontend
cp .env.example .env   # no Windows (cmd): copy .env.example .env
```

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `NUXT_BACKEND_URL` | não | `http://localhost:3001` | Endereço do backend **visto a partir do servidor Nuxt**. O navegador nunca acessa esse endereço diretamente. |
| `HOST` | não | todas as interfaces | Interface onde o servidor Nuxt escuta (ex.: `0.0.0.0` ou `127.0.0.1`). |
| `PORT` | não | `3000` | Porta do servidor Nuxt. |

Exemplo de `frontend/.env`:

```dotenv
NUXT_BACKEND_URL=http://localhost:3001
HOST=0.0.0.0
PORT=3000
```

**Desenvolvimento × produção**

- Em **desenvolvimento** (`pnpm dev`), o `frontend/.env` é lido **automaticamente**.
- Em **produção** (`node .output/server/index.mjs`), o `.env` **não** é lido. Defina as variáveis no ambiente do sistema ou carregue o arquivo explicitamente com `node --env-file=.env .output/server/index.mjs`.
- `NUXT_BACKEND_URL` é lido **ao iniciar** o servidor, não no build. Para apontar para outro backend, basta alterar a variável e reiniciar o frontend, **sem novo build**.

## 8. Execução

**Atalho:** os scripts na raiz do repositório sobem backend e frontend juntos. Eles instalam as dependências se `node_modules` não existir e avisam se o `backend/.env` estiver faltando.

```bash
./start.sh          # Linux, macOS ou Git Bash: saída dos dois no mesmo terminal, Ctrl+C encerra ambos
./start.sh prod     # build e execução em modo produção
```

```bat
start.bat           :: Windows (cmd/PowerShell): abre uma janela para cada aplicação
start.bat prod      :: build e execução em modo produção
```

As seções abaixo descrevem os mesmos passos manualmente.

### 8.1 Instalação

```bash
cd backend && npm install
cd ../frontend && pnpm install   # também gera os ícones (postinstall)
```

### 8.2 Desenvolvimento

Em dois terminais:

```bash
# Terminal 1 — backend com recarga automática (http://127.0.0.1:3001/api)
cd backend
npm run start:dev
```

```bash
# Terminal 2 — frontend com recarga automática (http://localhost:3000)
cd frontend
pnpm dev
```

Abra `http://localhost:3000`. O chip no cabeçalho mostra **Realm …** em verde quando o backend consegue falar com o RH-SSO.

**Sem um RH-SSO à mão?** O backend inclui um simulador da Admin API do Keycloak 16, com grupos e usuários de exemplo:

```bash
cd backend
node test/e2e/keycloak-simulator.ts   # http://127.0.0.1:8180/auth, realm "teste"
```

Para usá-lo, configure no `backend/.env`:

```dotenv
KEYCLOAK_BASE_URL=http://127.0.0.1:8180/auth
KEYCLOAK_REALM=teste
KEYCLOAK_CLIENT_ID=importador
KEYCLOAK_CLIENT_SECRET=segredo
```

O simulador aceita estes comandos de controle para provocar situações de erro:

- `POST /__sim/waf?active=true|false` liga ou desliga o bloqueio do WAF;
- `POST /__sim/fail-group?username=x` faz a atribuição de grupo desse usuário falhar;
- `GET /__sim/state` mostra o estado atual.

**Keycloak 16 real em Docker.** Para testar contra a mesma versão do RH-SSO de destino, suba a imagem oficial e prepare um realm de teste com o script `backend/test/e2e/keycloak16-setup.sh`:

```bash
docker run -d --name keycloak16 -p 8081:8080 \
  -e KEYCLOAK_USER=admin -e KEYCLOAK_PASSWORD=admin quay.io/keycloak/keycloak:16.1.1

cd backend
docker exec -i keycloak16 bash -s < test/e2e/keycloak16-setup.sh
# Docker dentro do WSL, chamado do Windows:
#   wsl -e sh -c 'docker exec -i keycloak16 bash -s' < test/e2e/keycloak16-setup.sh
```

O script cria o realm `importador-teste` aplicando os passos da seção [6.2](#62-no-rh-sso-realm-de-destino):

- client `importador-usuarios` confidencial com service account e os três papéis;
- Update Profile habilitado e e-mails duplicados permitidos;
- os grupos `/APP.PORTAL/...`, `/APP.FINANCEIRO/...` e `/Colaboradores`;
- os usuários `bsilva` (sem grupo), `csouza` (com parte dos grupos) e `dlima` (com todos e a ação `CONFIGURE_TOTP`).

No fim, ele imprime as linhas para o `backend/.env`, com o segredo gerado. O script não altera outros realms. Para apagar e recriar o realm de teste, rode com `-e RESET=1` no `docker exec`.

### 8.3 Build e produção

```bash
# Backend
cd backend
npm run build          # gera dist/
npm run start:prod     # node dist/main — execute dentro de backend/ para o .env ser encontrado
```

```bash
# Frontend
cd frontend
pnpm build                                            # gera .output/ (autocontido)
node --env-file=.env .output/server/index.mjs         # ou defina NUXT_BACKEND_URL, HOST e PORT no sistema
```

A pasta `frontend/.output` pode ser copiada sozinha para o servidor; ela não precisa de `node_modules`. Em produção, mantenha o backend com `HOST=127.0.0.1` atrás do frontend e use um gerenciador de processos (systemd, PM2, NSSM no Windows) para reiniciar os serviços.

### 8.4 Testes

```bash
cd backend
npm test            # testes unitários
npm run test:e2e    # ponta a ponta: backend real contra o simulador do Keycloak 16 (inclui WAF e proxy)
npm run lint
```

## 9. Relatório, reprocessamento e log de auditoria

### Relatório CSV

O botão **Baixar relatório** (`GET /api/imports/:id/report.csv`) gera um CSV em UTF-8 com BOM e separador `;`, que abre direto no Excel. Há uma linha por usuário, com as colunas:

`Linha` · `UID` · `Username` · `Nome` · `Sobrenome` · `Email` · `Status` · `Ações obrigatórias` · `Grupos adicionados` · `Grupos que já possuía` · `Grupos com falha` · `Avisos` · `Mensagem`

Os grupos de uma mesma célula são separados por ` | `. O relatório fica disponível por `JOB_RETENTION_MINUTES` após o fim do job, e enquanto o backend não for reiniciado.

### Reprocessar erros

Quando o job termina com linhas `ERRO` ou `NAO_PROCESSADO`, o botão **Reprocessar erros** cria um **novo job** só com essas linhas, os mesmos grupos e as mesmas regras. O novo job aparece com o selo "Reprocessamento de erros". Como o processamento é idempotente, um usuário criado na primeira tentativa aparece agora como "Grupos adicionados" ou "Sem alteração", e não é criado de novo.

### Log de auditoria

Ao fim de cada job (concluído, cancelado ou com falha), o backend acrescenta uma linha JSON em `AUDIT_LOG_DIR/importacoes-AAAA-MM.jsonl`. A linha traz:

- identificação do job (`jobId`, `sourceJobId`, `fileName`, `realm`);
- situação, horários e grupos (com caminho);
- ações obrigatórias aplicadas e totais por status;
- o resultado de cada linha.

O log não contém senhas nem o segredo do client. Guarde e faça rotação dessa pasta conforme a política de retenção da sua organização.

## 10. Solução de problemas e limitações conhecidas

### Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| O backend não inicia: "Configuração inválida…" | Variável obrigatória ausente ou valor inválido. | Corrija as variáveis listadas na mensagem (seção [7.1](#71-backend)). |
| Chip vermelho com **"Falha na autenticação do client"** (401/400) | Client ID ou segredo errados, client não confidencial ou service account desligada. | Confira `KEYCLOAK_CLIENT_ID` e `KEYCLOAK_CLIENT_SECRET` e o passo 1 da seção [6.2](#62-no-rh-sso-realm-de-destino). |
| **"Realm … não encontrado"** (404) | `KEYCLOAK_BASE_URL` sem `/auth` ou realm com nome errado. | No Keycloak 16 a URL termina em `/auth`. Confira `KEYCLOAK_REALM`. |
| **"Permissão insuficiente…"** (403 do Keycloak, em JSON) | Faltam papéis de `realm-management` na service account. | Atribua `manage-users`, `view-users` e `query-groups` (passo 2 da seção [6.2](#62-no-rh-sso-realm-de-destino)). |
| Job **pausado** com alerta **"bloqueio do WAF"** (403 em HTML) | O WAF entendeu o volume como abuso. | Aguarde alguns minutos e clique em **Retomar**; nada se perde. Se repetir, aumente `KC_MIN_INTERVAL_MS`, mantenha `KC_MAX_CONCURRENCY=1` e reinicie o backend (seção [7.1](#ajuste-de-taxa-para-o-waf)). |
| **"Falha de rede ao acessar o RH-SSO"**, timeout ou `ECONNREFUSED` | Sem rota até o RH-SSO, proxy errado ou host faltando em `NO_PROXY`. | Teste o acesso a partir do servidor do backend. Confira `HTTPS_PROXY`, `HTTP_PROXY` e `NO_PROXY`. |
| `unable to get local issuer certificate` / `self-signed certificate in certificate chain` | Certificado de CA corporativa (proxy com inspeção TLS ou RH-SSO interno). | Defina `NODE_EXTRA_CA_CERTS` **no ambiente do sistema**, não no `.env` (seção [7.1](#ca-corporativa-node_extra_ca_certs)). |
| Acentos trocados (`JoÃ£o`, `Jo�o`) na Revisão | Arquivo numa codificação não suportada (por exemplo UTF-16, o "Texto Unicode" do Excel). | Salve como **CSV UTF-8** e envie de novo. |
| "Planilhas do Excel (.xlsx/.xls) não são aceitas" | Foi enviado o arquivo do Excel. | Use *Salvar como › CSV UTF-8*. |
| "O arquivo excede o tamanho máximo" (413) / "máximo permitido é N linhas" | Limites de upload. | Divida a planilha ou ajuste `UPLOAD_MAX_BYTES` / `UPLOAD_MAX_ROWS`. |
| Linha com `ERRO` "User exists with same email" | Realm não permite e-mails duplicados. | Ligue *Duplicate emails* no realm (passo 4 da seção [6.2](#62-no-rh-sso-realm-de-destino)) e use **Reprocessar erros**. |
| Frontend: **"Não foi possível conectar ao backend em …"** (502) | Backend parado ou `NUXT_BACKEND_URL` errado. | Inicie o backend e confira `NUXT_BACKEND_URL`. Em produção, lembre que o `.env` não é lido automaticamente. |
| Usuário criado não vê o formulário de perfil no login | *Update Profile* desabilitado em *Required Actions*. | Habilite a ação (passo 3 da seção [6.2](#62-no-rh-sso-realm-de-destino)). |
| Aviso "E-mail/Nome no RH-SSO difere da planilha" | O usuário já existia com outros dados. | Informativo: a aplicação não altera usuários existentes. Corrija no console do RH-SSO se necessário. |

### Limitações conhecidas

- **Sem autenticação própria**: qualquer pessoa que acesse o frontend pode importar usuários no realm configurado. Publique-o apenas em rede interna ou VPN, ou atrás de um proxy reverso com autenticação, e mantenha o backend em `127.0.0.1`.
- **Jobs em memória**: reiniciar o backend perde os jobs em andamento e os relatórios ainda não baixados. Para continuar, importe a mesma planilha de novo: o que já foi aplicado aparece como "Sem alteração".
- **Uma instância só**: não rode vários backends atrás de um balanceador, porque cada um teria seus próprios jobs e seu próprio limite de taxa.
- **Somente acréscimo**: a aplicação não altera dados de usuários existentes, não remove usuários de grupos e não define senhas.
- **Realm fixo**: para outro realm, rode outra instância do backend com outro `.env`.
- **Grupos grandes**: a preparação lê todos os membros dos grupos selecionados. Grupos com dezenas de milhares de membros tornam essa fase mais longa.
