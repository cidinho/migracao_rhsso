## Context

O repositório hoje contém apenas o OpenSpec e o template `materio-vuetify-nuxtjs-admin-template-free-v1.1.0` (Nuxt 3.14, Vuetify 3.7.5, Pinia, temas `light`/`dark` em `plugins/vuetify/theme.ts`). Não há código de aplicação.

O destino é um RH-SSO baseado em **Keycloak 16** (WildFly), com estas características relevantes:

- A Admin REST API fica sob o prefixo `/auth` (`https://host/auth/admin/realms/{realm}/...`).
- **Não há federação LDAP**: os usuários são locais do Keycloak.
- O realm **permite e-mails duplicados**, então não há conflito de e-mail na criação.
- O acesso passa por um **WAF que bloqueia excesso de requisições**, e o ambiente pode exigir **proxy HTTP(S)** corporativo.
- O realm é fixo (configurado no `.env`).
- A redefinição de senha dos usuários importados fica fora do escopo (o usuário usará o fluxo do próprio Keycloak).
- O nome e o sobrenome são **arbitrados pela aplicação** (primeira palavra de `NOME` em `firstName`, o restante em `lastName`). Por isso, todo usuário criado recebe a ação obrigatória `UPDATE_PROFILE`, que o leva a confirmar ou corrigir o perfil no próximo login.

Endpoints usados (Keycloak 16):

| Operação | Endpoint |
|---|---|
| Token | `POST /auth/realms/{realm}/protocol/openid-connect/token` |
| Árvore de grupos | `GET /auth/admin/realms/{realm}/groups` (inclui `subGroups` recursivos e `path`) |
| Membros de um grupo | `GET /auth/admin/realms/{realm}/groups/{id}/members?first=&max=` |
| Buscar usuário | `GET /auth/admin/realms/{realm}/users?username={u}&exact=true` |
| Criar usuário | `POST /auth/admin/realms/{realm}/users` (201 + `Location`) |
| Atribuir grupo | `PUT /auth/admin/realms/{realm}/users/{id}/groups/{groupId}` (idempotente, 204) |

## Goals / Non-Goals

**Goals:**
- Importar usuários a partir de CSV de forma **idempotente**: reexecutar a mesma planilha não duplica nada.
- Relatar o resultado por usuário **e** por grupo (adicionado / já possuía / falhou).
- Minimizar e espaçar as requisições ao RH-SSO para não acionar o WAF, e se recuperar sem perda quando ele bloquear.
- Funcionar atrás de proxy corporativo com inspeção TLS.
- Oferecer uma interface guiada, acessível e coerente com uma operação em massa.

**Non-Goals:**
- Autenticação/autorização da própria aplicação (decisão explícita: uso interno, restrito por rede).
- Definir senhas ou enviar e-mails aos usuários (o `execute-actions-email` não é usado; a ação obrigatória só é cobrada quando o usuário fizer login).
- Alterar ações obrigatórias de usuários que já existiam.
- Atualizar dados (nome/e-mail) de usuários existentes, remover usuários ou remover grupos.
- Atribuição de *roles* diretamente (apenas grupos).
- Persistência de jobs entre reinícios do backend, ou execução com múltiplas instâncias.
- Suporte a `.xlsx`.

## Decisions

### D1. Monorepo com `backend/` e `frontend/` independentes
Duas aplicações Node no mesmo repositório, cada uma com seu `package.json`. O frontend é uma **cópia** de `typescript-version` em `frontend/`, limpa das páginas de demonstração. O template original fica intocado como referência.
- *Alternativa*: workspaces (pnpm/npm). Descartada por ora: as duas apps não compartilham código, e workspaces complicariam o uso do lockfile do template.

### D2. Frontend fala só com o próprio Nuxt; o Nuxt faz proxy para o backend
Uma rota de servidor do Nitro (`frontend/server/api/[...path].ts`) encaminha `/api/**` com `proxyRequest(event, backendUrl + path)`, em que `backendUrl` vem de `useRuntimeConfig().backendUrl`, sobrescrevível por `NUXT_BACKEND_URL`. Uploads multipart e downloads de CSV passam pelo mesmo proxy. O navegador nunca chama o NestJS diretamente.
- *Por quê*: elimina CORS, deixa uma única origem a publicar na rede interna e esconde a topologia.
- *Por quê não `routeRules.proxy`*: as `routeRules` do `nuxt.config.ts` são fixadas no build, e só o `runtimeConfig` aceita sobrescrita por variáveis `NUXT_*` em tempo de execução. Com `routeRules`, mudar o endereço do backend no `.env` de produção exigiria um novo build.
- *Alternativa*: CORS no NestJS. Viável, mas exige configurar origens e expor duas portas.

### D3. Chamadas HTTP diretas à Admin API (sem `@keycloak/keycloak-admin-client`)
Um `KeycloakAdminClient` próprio no NestJS implementa apenas os 6 endpoints da tabela.
- *Por quê*: as versões atuais da biblioteca acompanham o Keycloak 2x e podem divergir da API do 16; precisamos controlar cada requisição (limitador, retry, detecção do WAF, proxy).
- *Alternativa*: a biblioteca oficial fixada numa versão antiga. Descartada pela dificuldade de injetar o limitador e o proxy de forma confiável.

### D4. Cliente HTTP: `undici` com `ProxyAgent`
Usar `undici` (`request`/`fetch`) com `ProxyAgent` quando houver `HTTPS_PROXY`/`HTTP_PROXY`, respeitando `NO_PROXY`. A CA corporativa entra por `NODE_EXTRA_CA_CERTS`, nativo do Node.
- *Por quê*: o suporte embutido a proxy do `axios` tem problemas conhecidos com destino HTTPS via túnel `CONNECT`.
- *Alternativa*: `axios` + `https-proxy-agent`. Equivalente; fica como plano B se houver incompatibilidade com o proxy do ambiente.

### D5. Limitador único de requisições + retry + detecção do WAF
Todas as chamadas, inclusive a de token, passam por uma única fila (`p-queue` ou implementação própria) configurada com `KC_MAX_CONCURRENCY` (padrão 1) e `KC_MIN_INTERVAL_MS` (padrão 300).

```
 chamada ─▶ fila(concorrência, intervalo) ─▶ undici(+proxy) ─▶ WAF ─▶ Keycloak
                                                 │
            ┌────────────────────────────────────┴───────────────────────┐
            │ 2xx/201/204          → sucesso                              │
            │ 401                  → renova token, repete 1×              │
            │ 429/502/503/504/rede → backoff exp. (Retry-After), até N×   │
            │ 403 + corpo não-JSON → WafBlockedError (sem retry)          │
            │ 403 + JSON           → KeycloakForbiddenError               │
            │ 409 (criação)        → UserAlreadyExistsError               │
            │ demais               → KeycloakHttpError(status, corpo)     │
            └─────────────────────────────────────────────────────────────┘
```

O padrão conservador (1 requisição por vez, ~3 req/s) favorece a segurança contra o WAF; os valores são ajustáveis sem mudar código.

### D6. Estratégia de requisições: linha a linha + membros dos grupos
Antes do processamento, o job lista os membros diretos de cada grupo selecionado (paginado), formando um `Set<username>` por grupo. Depois, para cada linha:

```
 buscar username (exact) ──┬── não existe ─▶ POST /users ─▶ PUT grupo × G       → CRIADO
                           │                 (requiredActions: [UPDATE_PROFILE])
                           │                    └ 409 → rebusca e segue como existente
                           │                            (sem ações obrigatórias)
                           └── existe ──▶ para cada grupo:
                                            username ∈ membros(grupo)? → JA_POSSUIA
                                            senão → PUT grupo                → ADICIONADO
                                         nenhum ADICIONADO → SEM_ALTERACAO
                                         algum ADICIONADO  → GRUPOS_ADICIONADOS
```

Custo: usuário novo = `2 + G` requisições; usuário existente = `1 + grupos faltantes`; mais `G × páginas` no início.
- *Por quê*: elimina o `GET /users/{id}/groups` por usuário existente usando só os papéis `manage-users`, `view-users` e `query-groups`.
- *Alternativa descartada*: `partialImport` em lote (cerca de 8× menos requisições), porque exige `manage-realm` no client.
- O snapshot de membros pode ficar defasado durante o job; isso é seguro porque o `PUT` é idempotente.

### D6.1. Ação obrigatória no corpo da criação
O `POST /users` envia `requiredActions` com a lista de `KC_NEW_USER_REQUIRED_ACTIONS` (padrão `["UPDATE_PROFILE"]`) no mesmo corpo da criação, sem custo de requisição extra. Usuários existentes nunca recebem `PUT /users/{id}` para isso.
- *Por quê configurável*: permite incluir `UPDATE_PASSWORD` ou desligar a ação (lista vazia) sem mudar código, mantendo `UPDATE_PROFILE` como padrão seguro.
- *Alternativa descartada*: aplicar a ação obrigatória a todos os usuários da planilha, inclusive existentes. Descartada porque os existentes não tiveram o nome arbitrado pela aplicação e a regra é não alterá-los além dos grupos.
- *Alternativa descartada*: `PUT /users/{id}/execute-actions-email`. Exige SMTP, gera e-mails em massa e custa uma requisição por usuário.

### D7. Jobs em memória, com consulta periódica (polling)
Um `ImportJobsService` mantém os jobs num `Map` em memória, com expiração após `JOB_RETENTION_MINUTES` (padrão 120). O processamento roda em segundo plano (promise desacoplada da requisição). O frontend consulta `GET /api/imports/:id` a cada 1–2 s.

Estados do job: `PREPARANDO → EXECUTANDO ⇄ PAUSADO → CONCLUIDO | CANCELADO | FALHOU`.

- *Por quê polling e não SSE*: proxies corporativos e o proxy do Nitro podem fazer buffer de SSE; o polling é previsível e o volume é baixo (uma consulta a cada 1–2 s, só entre navegador e backend, sem impacto no WAF do RH-SSO).
- Para evitar respostas grandes, `GET /api/imports/:id` devolve o resumo e os resultados a partir de um cursor (`?since=<índice>`); o frontend acumula.
- *Alternativa*: fila com Redis/BullMQ. Desnecessária para uma ferramenta interna de instância única.

### D8. Parsing do CSV no backend
`POST /api/imports/preview` (multipart) recebe o arquivo e devolve as linhas normalizadas e os erros. Usa `iconv-lite` para decodificar (BOM UTF-8 → UTF-8; senão tenta UTF-8 estrito e cai para Windows-1252) e `csv-parse` com detecção de separador pela primeira linha (`;` vs `,`).
O `POST /api/imports` recebe as linhas já normalizadas (JSON) e os IDs dos grupos, e **revalida** no servidor.
- *Por quê*: uma única implementação de regras (usada no preview e no job) e controle sobre a codificação.
- *Alternativa*: parsing no navegador (PapaParse). Daria feedback instantâneo, mas duplicaria as regras de validação.

### D9. Modelo de resultado
```
LinhaResultado {
  linha: number            // número da linha na planilha
  uid: string              // como veio na planilha
  username: string         // como gravado (minúsculas)
  status: CRIADO | GRUPOS_ADICIONADOS | SEM_ALTERACAO | ERRO | NAO_PROCESSADO
  usuarioCriado: boolean
  firstName: string
  lastName: string
  acoesObrigatorias: string[]  // preenchido só quando usuarioCriado = true
  grupos: { path: string, status: ADICIONADO | JA_POSSUIA | FALHOU, erro?: string }[]
  avisos: string[]         // ex.: "e-mail no RH-SSO difere da planilha"
  erro?: string
}
```
O aviso de divergência compara e-mail, `firstName` e `lastName` retornados na busca do usuário (sem requisição extra).

### D10. API do backend
| Método | Rota | Função |
|---|---|---|
| GET | `/api/health` | conectividade com o RH-SSO, realm configurado, parâmetros de taxa (para a estimativa) e ações obrigatórias de novos usuários |
| GET | `/api/groups?refresh=true` | árvore de grupos (cache com TTL) |
| GET | `/api/imports/template.csv` | modelo de planilha |
| POST | `/api/imports/preview` | upload e validação do CSV |
| POST | `/api/imports` | cria o job `{ fileName, rows, groupIds }` |
| GET | `/api/imports/:id?since=n` | estado e resultados incrementais |
| POST | `/api/imports/:id/pause` / `resume` / `cancel` | controle do job |
| POST | `/api/imports/:id/retry-errors` | novo job só com `ERRO`/`NAO_PROCESSADO` |
| GET | `/api/imports/:id/report.csv` | relatório |

### D11. Interface
- Página única `pages/index.vue` com `VStepper` (ou stepper próprio sobre `VWindow`, caso o `VStepper` do Vuetify 3.7 limite a customização) e estado num store Pinia `useImportStore`.
- Árvore de grupos com `VTreeview` em modo de seleção independente (se disponível de forma estável na versão do template; senão, uma árvore própria com `VList` aninhada e `VCheckbox`), campo de busca com debounce e chips da seleção.
- `defaultTheme: 'dark'` em `plugins/vuetify/index.ts`; menu lateral reduzido a "Importar usuários"; textos em pt-BR.
- Status sempre com ícone + texto + cor; região `aria-live="polite"` para o progresso, com anúncios limitados (por exemplo, a cada 10% concluído).

### D12. Configuração
`@nestjs/config` com validação na inicialização (Joi ou zod). As variáveis do sistema prevalecem sobre o `.env`. Um `backend/.env.example` documenta todas:

```
KEYCLOAK_BASE_URL=https://sso.exemplo.com.br/auth
KEYCLOAK_REALM=
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
KC_EMAIL_VERIFIED=true
KC_NEW_USER_REQUIRED_ACTIONS=UPDATE_PROFILE   # lista separada por vírgula; vazio = nenhuma
KC_MAX_CONCURRENCY=1
KC_MIN_INTERVAL_MS=300
KC_MAX_RETRIES=5
KC_MEMBERS_PAGE_SIZE=500
GROUPS_CACHE_TTL_SECONDS=300
UPLOAD_MAX_BYTES=5242880
UPLOAD_MAX_ROWS=10000
JOB_RETENTION_MINUTES=120
AUDIT_LOG_DIR=./logs
HTTPS_PROXY=
HTTP_PROXY=
NO_PROXY=localhost,127.0.0.1
HOST=127.0.0.1
PORT=3001
```

`NODE_EXTRA_CA_CERTS` **não** funciona dentro do `.env`: o Node só lê essa variável na inicialização do processo, antes de o `@nestjs/config` carregar o arquivo. Ela precisa ser definida como variável do sistema (ou no comando de execução). O README destaca isso. Já as variáveis de proxy funcionam no `.env`, porque o próprio código monta o `ProxyAgent` a partir da configuração.

Frontend (`frontend/.env.example`), lido via `runtimeConfig`:

```
NUXT_BACKEND_URL=http://localhost:3001   # endereço do NestJS visto pelo servidor Nuxt
HOST=0.0.0.0                             # interface do servidor Nuxt
PORT=3000                                # porta do servidor Nuxt
```

Em desenvolvimento (`nuxt dev`), o `.env` é lido automaticamente. Em produção (`node .output/server/index.mjs`), o servidor **não** lê o `.env`: as variáveis vêm do sistema ou de `node --env-file=.env .output/server/index.mjs` (Node ≥ 20.6). O README documenta as duas formas.

### D13. Documentação
O `README.md` da raiz é a referência única, em português, com esta estrutura:

```
README.md
├── 1. Visão geral (o que faz, para quem, limitações principais)
├── 2. Arquitetura (diagrama navegador → Nuxt → NestJS → proxy/WAF → RH-SSO)
├── 3. Funcionalidades
├── 4. Fluxo da importação
│   ├── as 5 etapas, com o que acontece em cada uma
│   ├── árvore de decisão por usuário (novo / existente / já possuía)
│   └── tabela de status por linha e por grupo
├── 5. Formato do CSV (colunas, separador, codificação, validações, NOME → nome/sobrenome, modelo)
├── 6. Pré-requisitos
│   ├── Node.js e gerenciador de pacotes
│   └── RH-SSO: client + service account + papéis, Update Profile habilitado, e-mails duplicados
├── 7. Configuração
│   ├── 7.1 Backend: tabela de variáveis, exemplo de .env, precedência, proxy, CA, ajuste para WAF
│   └── 7.2 Frontend: tabela de variáveis, exemplo de .env, dev x produção
├── 8. Execução (instalação, dev, build, produção para cada aplicação)
├── 9. Relatório, reprocessamento e log de auditoria
└── 10. Solução de problemas e limitações conhecidas
```

- As tabelas de variáveis do README são escritas a partir do schema de validação do backend e do `runtimeConfig` do frontend, e conferidas contra os arquivos `.env.example`, para que as três fontes não divirjam.
- `backend/README.md` e `frontend/README.md` contêm apenas um link para o README da raiz (o README do template Materio é substituído).
- A documentação é escrita depois das funcionalidades e validada no teste ponta a ponta: a configuração é feita do zero seguindo apenas o README.

## Risks / Trade-offs

- **[Aplicação sem autenticação com credenciais administrativas]** → Publicar apenas em rede interna, fazer o backend escutar só no host do Nuxt quando estiverem na mesma máquina, dar ao client somente os papéis mínimos e manter o log de auditoria. Fica registrado como risco aceito.
- **[Bloqueio do WAF mesmo com a taxa padrão]** → Pausa automática sem perda de progresso; os parâmetros de taxa são ajustáveis; a estimativa de tempo na confirmação deixa o custo visível.
- **[Jobs perdidos se o backend reiniciar]** → A idempotência permite reenviar a mesma planilha sem efeitos colaterais; o log de auditoria preserva o que já foi feito.
- **[Grupos com muitos membros (ex.: 50 mil)]** → Isso custa cerca de `membros / KC_MEMBERS_PAGE_SIZE` requisições no início do job. É aceitável; se for um problema, uma alternativa futura é consultar `GET /users/{id}/groups` apenas para usuários existentes quando o grupo passar de um limite configurável.
- **[`exact=true` na busca]** → Além do parâmetro, o backend filtra a resposta por igualdade exata do username (minúsculas), protegendo contra comportamento de busca parcial.
- **[E-mails duplicados e recuperação de senha]** → Com e-mails duplicados no realm, a recuperação de senha pelo e-mail pode ser ambígua; o usuário deve informar o UID. Isso está fora do escopo, mas deve ser comunicado aos usuários finais.
- **[Recuperação de senha depende do realm]** → O fluxo "Esqueci minha senha" precisa estar habilitado e com SMTP configurado no realm de destino; fora do escopo da aplicação.
- **[Ação "Update Profile" desabilitada no realm]** → Se a ação estiver desabilitada em *Authentication → Required Actions*, o Keycloak não a cobra no login, e os nomes arbitrados ficam sem revisão. Mitigação: incluir essa verificação no plano de implantação. Uma checagem automática exigiria o papel `view-realm`, que preferimos não conceder.
- **[O usuário pode alterar o e-mail no formulário de perfil]** → No Keycloak 16, o formulário de Update Profile permite editar também o e-mail (e o username, se "Edit username" estiver habilitado no realm). Isso é aceitável; quem quiser restringir deve ajustar as configurações do realm.
- **[Ordem com a redefinição de senha]** → O usuário importado não tem senha. Ele primeiro passa pelo fluxo "Esqueci minha senha" e, ao concluir o login, o Keycloak exibe o formulário de Update Profile, já que as ações pendentes são cobradas ao final da autenticação. Isso deve ser validado no teste ponta a ponta.
- **[Grupos padrão do realm]** → Se um grupo selecionado for grupo padrão (*default group*), o usuário novo já o recebe na criação; o `PUT` idempotente mantém o resultado correto (reportado como `ADICIONADO`).
- **[Disponibilidade estável do `VTreeview` no Vuetify 3.7.5]** → Verificar na implementação; existe a alternativa de uma árvore própria (D11).

## Migration Plan

1. Configurar no realm de destino um client confidencial com *service account* habilitada e os papéis `realm-management`: `manage-users`, `view-users`, `query-groups`.
2. Confirmar no realm de destino que a ação obrigatória **Update Profile** está habilitada (*Authentication → Required Actions*).
3. Preencher `backend/.env` e `frontend/.env` (ou as variáveis do sistema) conforme a seção de configuração do README, incluindo proxy e CA, se aplicável.
4. Validar a conexão pela indicação na interface (`/api/health`).
5. Fazer uma importação piloto com poucas linhas e conferir no console do RH-SSO, incluindo a ação obrigatória nos usuários criados.
6. Ajustar `KC_MAX_CONCURRENCY` e `KC_MIN_INTERVAL_MS` conforme o comportamento do WAF.

Rollback: a aplicação não altera nada além de criar usuários e adicionar membros a grupos. O relatório CSV lista exatamente o que foi criado e atribuído, caso seja preciso reverter manualmente.

## Open Questions

- `emailVerified` dos usuários criados: assumido `true` (os e-mails foram validados antes), configurável por `KC_EMAIL_VERIFIED`. Confirmar.
- Manter ou remover a pasta original do template depois de copiá-la para `frontend/`?
- Haverá hospedagem definida (servidor Windows/Linux, container)? Isso pode motivar Dockerfiles numa mudança futura.
