## 1. Estrutura do repositório

- [x] 1.1 Criar `.gitignore` na raiz (node_modules, .env, logs, .nuxt, .output, dist)
- [x] 1.2 Criar o projeto NestJS em `backend/` (TypeScript, ESLint/Prettier, Jest)
- [x] 1.3 Copiar `materio-vuetify-nuxtjs-admin-template-free-v1.1.0/typescript-version` para `frontend/` e confirmar que `install` e `dev` funcionam
- [x] 1.4 Criar o esqueleto do `README.md` na raiz com as seções definidas em D13 (preenchidas no grupo 10) e substituir `backend/README.md` e `frontend/README.md` por um link para ele

## 2. Backend — configuração

- [x] 2.1 Adicionar `@nestjs/config` com schema de validação das variáveis (D12), com as variáveis do sistema prevalecendo sobre o `.env`
- [x] 2.2 Criar `backend/.env.example` com todas as variáveis, valores padrão e comentários curtos, sem segredos reais
- [x] 2.3 Garantir falha na inicialização com mensagem clara quando faltar variável obrigatória
- [x] 2.4 Implementar o parsing e a validação de `KC_NEW_USER_REQUIRED_ACTIONS` (lista separada por vírgula, padrão `UPDATE_PROFILE`, vazio = nenhuma, aliases conhecidos do Keycloak 16)

## 3. Backend — integração com o Keycloak

- [x] 3.1 Implementar o cliente HTTP com `undici` e `ProxyAgent` (`HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`)
- [x] 3.2 Implementar o limitador único (`KC_MAX_CONCURRENCY`, `KC_MIN_INTERVAL_MS`)
- [x] 3.3 Implementar retry com backoff exponencial e `Retry-After` para 429/502/503/504/erros de rede
- [x] 3.4 Implementar a classificação de erros: `WafBlockedError` (403 não-JSON), `KeycloakForbiddenError`, `UserAlreadyExistsError` (409), `KeycloakHttpError`
- [x] 3.5 Implementar `TokenService` (client credentials, cache, renovação antecipada e repetição única em 401)
- [x] 3.6 Implementar `KeycloakAdminClient`: `getGroupTree`, `listGroupMembers` (paginado), `findUserByUsername` (exact + filtro de igualdade), `createUser` (com `requiredActions` no corpo; ID extraído do `Location`), `addUserToGroup`
- [x] 3.7 Testes unitários do limitador, do retry, da classificação de erros e do token (com servidor HTTP simulado)
- [x] 3.8 Implementar `GET /api/health` (obtém token, consulta o realm e informa as ações obrigatórias de novos usuários; nunca expõe o secret)

## 4. Backend — grupos

- [x] 4.1 Implementar `GroupsService` com cache por TTL e atualização forçada
- [x] 4.2 Implementar `GET /api/groups?refresh=true` retornando `{ id, name, path, subGroups }`
- [x] 4.3 Testes do cache e do mapeamento da árvore

## 5. Backend — CSV

- [x] 5.1 Implementar a decodificação (BOM UTF-8, UTF-8 estrito, fallback Windows-1252) com `iconv-lite`
- [x] 5.2 Implementar o parsing com `csv-parse`, detecção de separador e cabeçalhos sem diferenciar caixa
- [x] 5.3 Implementar as validações por linha (vazios, formato de e-mail, UID duplicado sem diferenciar caixa) e os limites de tamanho e de linhas
- [x] 5.4 Implementar a normalização: username em minúsculas e divisão de NOME em `firstName`/`lastName`
- [x] 5.5 Implementar `POST /api/imports/preview` (multipart) e `GET /api/imports/template.csv`
- [x] 5.6 Testes com arquivos de exemplo: `;` + Windows-1252 com acentos, `,` + UTF-8 com BOM, coluna faltante, duplicados, arquivo vazio

## 6. Backend — job de importação

- [x] 6.1 Definir os modelos `ImportJob` e `LinhaResultado` e a máquina de estados (D7, D9)
- [x] 6.2 Implementar `ImportJobsService` (armazenamento em memória, expiração por `JOB_RETENTION_MINUTES`)
- [x] 6.3 Implementar a preparação: validar os IDs de grupo e levantar os membros de cada grupo selecionado
- [x] 6.4 Implementar o processamento por linha conforme D6/D6.1 (criar com ações obrigatórias + grupos; existente + faltantes, sem tocar em ações obrigatórias; `SEM_ALTERACAO`; 409 → fluxo de existente; avisos de divergência)
- [x] 6.5 Implementar o isolamento de falhas por linha e o status `ERRO` com detalhe por grupo
- [x] 6.6 Implementar pausa automática em `WafBlockedError` e pausar/retomar/cancelar manuais (`NAO_PROCESSADO` no cancelamento)
- [x] 6.7 Implementar `POST /api/imports`, `GET /api/imports/:id?since=n`, `pause`, `resume`, `cancel` e `retry-errors`
- [x] 6.8 Implementar `GET /api/imports/:id/report.csv`
- [x] 6.9 Implementar o log de auditoria em JSON Lines em `AUDIT_LOG_DIR`
- [x] 6.10 Testes unitários do processamento com `KeycloakAdminClient` simulado cobrindo todos os cenários da spec `bulk-user-import`

## 7. Frontend — base

- [x] 7.1 Definir `defaultTheme: 'dark'` e ajustar título/marca da aplicação em `nuxt.config.ts`
- [x] 7.2 Remover as páginas e componentes de demonstração e reduzir o menu lateral a "Importar usuários"
- [x] 7.3 Declarar `runtimeConfig.backendUrl` e criar a rota de servidor `server/api/[...path].ts` com `proxyRequest` para o backend (D2), validando upload multipart e download de CSV pelo proxy
- [x] 7.4 Criar `frontend/.env.example` com `NUXT_BACKEND_URL`, `HOST` e `PORT`
- [x] 7.5 Criar o store Pinia `useImportStore` (arquivo, linhas, grupos selecionados, job, resultados)
- [x] 7.6 Exibir o realm e o estado da conexão (`/api/health`) no cabeçalho

## 8. Frontend — fluxo de importação

- [x] 8.1 Montar a página com o stepper de 5 etapas, navegação para trás preservando o estado e bloqueio após iniciar
- [x] 8.2 Etapa Upload: área de arrastar e soltar acessível por teclado, botão de seleção, link para o modelo, erros junto ao campo
- [x] 8.3 Etapa Revisão: tabela paginada, destaque das linhas inválidas com motivo, filtro "só inválidas", remoção de linhas
- [x] 8.4 Etapa Grupos: árvore com seleção independente, busca com debounce mantendo os ancestrais, chips removíveis e botão "Atualizar grupos"
- [x] 8.5 Etapa Confirmação: resumo (usuários, ignorados, grupos com path, realm, estimativa de tempo), aviso de atualização de perfil obrigatória para usuários novos e botão "Importar"
- [x] 8.6 Progresso: polling incremental, barra, contagens, pausar/retomar/cancelar, alerta de bloqueio do WAF e região `aria-live`
- [x] 8.7 Etapa Resultado: cartões de totais clicáveis como filtro, tabela com detalhe por grupo, "Baixar relatório", "Reprocessar erros" e "Nova importação"
- [x] 8.8 Revisar a acessibilidade: foco visível, ordem de tabulação, status com ícone + texto, rótulos dos controles

## 9. Verificação ponta a ponta

- [x] 9.1 Subir um Keycloak 16 local (`quay.io/keycloak/keycloak:16.1.1`) com um realm de teste, grupos aninhados (ex.: `/APP.PORTAL/ROLE_PORTAL_USER`), e-mails duplicados permitidos e client com service account e papéis mínimos
- [x] 9.2 Executar a importação de uma planilha mista (novos, existentes sem grupo, existentes com parte dos grupos, existentes com todos) e conferir os status no resultado e no console
- [x] 9.3 Reexecutar a mesma planilha e confirmar que todas as linhas ficam `SEM_ALTERACAO`
- [x] 9.4 Confirmar no console que só os usuários criados têm a ação obrigatória `UPDATE_PROFILE` e que os existentes mantiveram as ações originais
- [x] 9.5 Fazer login com um usuário criado (após definir a senha pelo fluxo de redefinição) e confirmar que o Keycloak exibe o formulário de atualização de perfil
- [x] 9.6 Simular o bloqueio do WAF (servidor simulado devolvendo 403 HTML) e validar a pausa e a retomada sem perda
- [x] 9.7 Validar a execução através de um proxy HTTP local
- [x] 9.8 Validar o relatório CSV e o reprocessamento de erros

## 10. Documentação

- [x] 10.1 README — visão geral, diagrama de arquitetura e lista de funcionalidades
- [x] 10.2 README — fluxo da importação: as 5 etapas, árvore de decisão por usuário, tabela de status por linha e por grupo, ação obrigatória de Update Profile para usuários novos
- [x] 10.3 README — formato do CSV (colunas, separador, codificação, validações, divisão do NOME, UID em minúsculas, limites, modelo)
- [x] 10.4 README — pré-requisitos: versão do Node e gerenciador de pacotes; no RH-SSO, client confidencial com service account, papéis mínimos, Update Profile habilitado, e-mails duplicados e fluxo de redefinição de senha
- [x] 10.5 README — configuração do backend: tabela de variáveis (nome, obrigatória, padrão, descrição), exemplo de `backend/.env`, precedência das variáveis do sistema, proxy, `NODE_EXTRA_CA_CERTS` fora do `.env` e ajuste de taxa para o WAF
- [x] 10.6 README — configuração do frontend: tabela de variáveis, exemplo de `frontend/.env`, diferença entre dev (`.env` automático) e produção (variáveis do sistema ou `node --env-file`) e troca de backend sem rebuild
- [x] 10.7 README — comandos de instalação, desenvolvimento, build e produção de cada aplicação
- [x] 10.8 README — relatório CSV, reprocessamento de erros, log de auditoria, solução de problemas (401, 403 do Keycloak, 403 do WAF, proxy/certificado, acentos) e limitações conhecidas
- [x] 10.9 Conferir que as tabelas do README, os `.env.example` e os schemas de configuração (backend e `runtimeConfig`) listam exatamente as mesmas variáveis e padrões
- [x] 10.10 Validar o README configurando e executando a aplicação do zero, seguindo apenas o documento, contra o Keycloak 16 local do grupo 9

## 11. Formato de exemplo do UID (`t_abc1234`)

- [x] 11.1 Tela de Upload: trocar o UID da tabela "Formato esperado" de `abc1234` para `t_abc1234` (`frontend/components/import/StepUpload.vue`)
- [x] 11.2 Modelo CSV: trocar a linha de exemplo de `TEMPLATE_CSV` para `t_abc1234;Maria da Silva Santos;maria.santos@exemplo.com.br` (`backend/src/csv/csv-import.ts`)
- [x] 11.3 README, seção 5: trocar os UIDs do exemplo de CSV para `t_abc1234` e `t_xyz9876`
- [x] 11.4 Testes unitários: alinhar os UIDs de exemplo a `t_abc1234`, incluindo a normalização `T_ABC1234` → `t_abc1234`, e cobrir que um UID sem `t_` continua válido
- [x] 11.5 Conferir que a tela, o modelo baixado e o README mostram o mesmo exemplo
