## Why

A migração para o RH-SSO (Keycloak 16) exige criar muitos usuários e vinculá-los a grupos (ex.: `/APP.PORTAL/ROLE_PORTAL_USER`). Fazer isso pelo console administrativo é lento, sujeito a erro e não deixa registro claro do que foi criado, do que já existia e do que falhou. Precisamos de uma aplicação que faça essa carga em lote a partir de uma planilha CSV, de forma idempotente e respeitando as restrições de rede do ambiente (WAF que bloqueia excesso de requisições e proxy corporativo).

## What Changes

- Nova aplicação no repositório, composta por:
  - **Backend NestJS** (`backend/`) que se autentica no RH-SSO via Client Credentials (client configurado em `.env` ou variáveis de ambiente) e executa as operações administrativas.
  - **Frontend Nuxt 3 + Vuetify** (`frontend/`) baseado no template Materio (`typescript-version`), com tema **dark** como padrão.
- Upload de planilha CSV com as colunas `UID` (login), `NOME` e `Email`, com validação e revisão das linhas antes de prosseguir. Na tela, no modelo CSV e no README, o UID de exemplo segue o formato `t_abc1234`. O prefixo `t_` é só ilustrativo e não é validado.
- Listagem da árvore de grupos e subgrupos do realm com busca e seleção múltipla para atribuição em massa.
- Importação em lote executada como job assíncrono com progresso:
  - usuário inexistente → é criado (`enabled=true`, sem credencial) com a ação obrigatória **Update Profile** (`UPDATE_PROFILE`) no próximo login, para que ele confirme ou corrija o nome e o sobrenome, que foram derivados automaticamente da coluna `NOME`, e recebe os grupos selecionados;
  - usuário existente → recebe apenas os grupos que ainda não possui;
  - usuário existente que já possui o grupo → nada é feito, e isso é informado no resultado.
- Tela de conclusão com resultado por usuário e por grupo, exportação do relatório em CSV e reprocessamento apenas das linhas com erro.
- Controle de taxa de requisições ao RH-SSO (concorrência, intervalo mínimo, retry com backoff e pausa automática em bloqueio do WAF) e suporte a proxy HTTP(S) e CA corporativa.
- Documentação no `README.md` da raiz: visão geral, arquitetura, funcionalidades, fluxo da importação e regras de decisão por usuário, formato do CSV, pré-requisitos no RH-SSO, instruções de configuração do `.env` do **backend** e do **frontend** (com `.env.example` em cada aplicação), execução em desenvolvimento e produção e solução de problemas.

## Capabilities

### New Capabilities

- `keycloak-admin-integration`: comunicação do backend com a Admin REST API do Keycloak 16 — autenticação Client Credentials com cache e renovação de token, controle de taxa, retry/backoff, detecção de bloqueio do WAF e suporte a proxy.
- `csv-user-upload`: recebimento, decodificação, parsing e validação da planilha CSV (UID, NOME, Email), incluindo download de modelo e mapeamento de NOME para `firstName`/`lastName`.
- `group-selection`: listagem da árvore de grupos/subgrupos do realm e seleção dos grupos a atribuir.
- `bulk-user-import`: execução do job de importação (criação de usuários, atribuição de grupos, regras de idempotência), acompanhamento de progresso, pausa/retomada, relatório de resultados e reprocessamento de erros.
- `import-wizard-ui`: fluxo guiado no frontend (upload → revisão → grupos → confirmação → resultado), tema dark e requisitos de acessibilidade e usabilidade.
- `project-documentation`: conteúdo mínimo obrigatório do `README.md` e dos arquivos `.env.example` do backend e do frontend, mantidos consistentes com a configuração real das aplicações.

### Modified Capabilities

<!-- Nenhuma: não há specs existentes em openspec/specs/. -->

## Impact

- **Código novo**: `backend/` (NestJS) e `frontend/` (Nuxt 3 + Vuetify 3, cópia adaptada de `materio-vuetify-nuxtjs-admin-template-free-v1.1.0/typescript-version`).
- **Sistemas externos**: RH-SSO / Keycloak 16 (Admin REST API sob `/auth`). O client usado precisa de *service account* com os papéis `realm-management`: `manage-users`, `view-users` e `query-groups`.
- **Configuração**: novas variáveis de ambiente no backend (URL do Keycloak, realm, client id/secret, proxy, limites de taxa, ações obrigatórias) e no frontend (URL do backend, host e porta).
- **Documentação**: `README.md` na raiz como referência única; `backend/.env.example` e `frontend/.env.example`; o `README.md` herdado do template no frontend é substituído.
- **Dependências novas (backend)**: NestJS, cliente HTTP com suporte a proxy (`undici` ou `axios` + `https-proxy-agent`), parser CSV e detecção de codificação.
- **Segurança**: a aplicação não terá autenticação própria (decisão explícita); deve ser publicada apenas em rede interna.
