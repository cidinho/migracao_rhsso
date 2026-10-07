## 1. Backend — CSV e grupos

- [x] 1.1 `parseCsv` com modo: na completa, reconhecer as colunas de grupo raiz (combinando repetidas), rejeitar arquivo sem coluna de grupo e produzir, por linha, os paths pedidos a partir das células separadas por `|` (D2)
- [x] 1.2 Modelo CSV da importação completa (`TEMPLATE_FULL_CSV`) com a coluna `APP.PORTAL` e subgrupos separados por `|`
- [x] 1.3 `GroupsService.resolvePaths`: path exato, depois único sem diferenciar maiúsculas, recarga única do cache, motivos para inexistente, ambíguo e mais de um nível (D3)
- [x] 1.4 Prévia da completa: resolver os grupos de cada linha, marcar `OK`/`INEXISTENTE` e aplicar os erros "Nenhum grupo informado" e "Nenhum grupo válido"
- [x] 1.5 Testes do parser (colunas de grupo, `|`, espaços, repetidos, níveis, sem coluna de grupo) e de `resolvePaths`

## 2. Backend — job e relatório

- [x] 2.1 Tipos: `RowStatus` `IGNORADO`, `GroupStatus` `INEXISTENTE`, `ImportRow.groups`/`missingGroups`/`requestedGroups`, `job.mode` e `job.ignored` (D5)
- [x] 2.2 `ImportJobsService.create`: aceitar `mode`, linhas com `groups` e `removed`; registrar inválidas e removidas como `IGNORADO`; recusar só sem linhas válidas; na completa, resolver os paths de cada linha e formar `job.groups` como a união
- [x] 2.3 `ImportProcessor`: grupos da linha (`row.groups ?? job.groups`), inexistentes como `INEXISTENTE` com aviso, sem afetar o status da linha
- [x] 2.4 Reprocessamento de erros com os grupos de cada linha na completa e sem as linhas `IGNORADO`
- [x] 2.5 `job-view`: `total`/`processed` sem as ignoradas, contagem `IGNORADO`, coluna "Grupos inexistentes" no relatório e linhas ignoradas com o motivo
- [x] 2.6 Controller: `mode` na prévia, no modelo e na criação do job (validação com zod)
- [x] 2.7 Testes: job completo com grupos diferentes por linha, grupo inexistente, `SEM_ALTERACAO` com aviso, grupo apagado depois da prévia, linhas ignoradas nas duas importações, relatório e reprocessamento
- [x] 2.8 Testes ponta a ponta da importação completa contra o simulador

## 3. Frontend

- [x] 3.1 Tipos e rótulos: `IGNORADO`, `INEXISTENTE`, grupos da prévia e modo
- [x] 3.2 Store por modo (`createImportStore`), `provide`/`inject`, etapas por nome com `next()`/`back()`, envio de todas as linhas ao criar o job (D7)
- [x] 3.3 Componente `ImportWizard` com o stepper a partir da lista de etapas; páginas `/` (simples) e `/completa`
- [x] 3.4 Menu com "Importação simples" e "Importação completa"
- [x] 3.5 Upload da completa: formato esperado com a coluna de grupo, dicas sobre `|` e um nível, link para o modelo da completa
- [x] 3.6 Revisão da completa: coluna "Grupos" com chips de válido e inexistente
- [x] 3.7 Confirmação da completa: grupos com a contagem de usuários, grupos inexistentes e estimativa de tempo
- [x] 3.8 Resultado: cartão "Ignorados", grupos `INEXISTENTE` no detalhe e no resumo da linha
- [x] 3.9 Typecheck, lint e build do frontend

## 4. Documentação e verificação

- [x] 4.1 README: importação simples e completa, formato da planilha completa, regras de grupo inexistente e linha sem grupo, status `IGNORADO` e `INEXISTENTE`, novas rotas da API
- [x] 4.2 Verificação no navegador das duas importações contra o simulador: prévia, confirmação, resultado e relatório
