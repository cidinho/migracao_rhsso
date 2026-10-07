## MODIFIED Requirements

### Requirement: Criação do job de importação
O backend SHALL criar um job de importação a partir das linhas da planilha e dos grupos a atribuir — os IDs dos grupos selecionados, na importação simples, ou os grupos de cada linha, na importação completa —, revalidando as linhas no servidor, e MUST responder imediatamente com o identificador do job, processando-o em segundo plano. Linhas inválidas MUST NOT impedir a criação do job: elas MUST ser registradas no resultado com o status `IGNORADO` e o motivo, sem serem processadas. O job MUST ser recusado apenas se não houver nenhuma linha válida.

#### Scenario: Job criado
- **WHEN** o frontend envia 500 linhas válidas e 2 grupos
- **THEN** o backend responde com o `jobId` sem aguardar o processamento das linhas

#### Scenario: Grupo inexistente
- **WHEN** na importação simples um dos IDs de grupo enviados não existe no realm
- **THEN** o job não é criado e a resposta indica qual grupo é inválido

#### Scenario: Linhas inválidas junto com as válidas
- **WHEN** o frontend envia 8 linhas válidas e 2 inválidas
- **THEN** o job é criado, processa as 8 válidas e registra as 2 inválidas como `IGNORADO`, com o motivo

#### Scenario: Nenhuma linha válida
- **WHEN** todas as linhas enviadas são inválidas
- **THEN** o job não é criado e a resposta informa que não há linhas válidas

### Requirement: Acompanhamento do progresso
O backend SHALL expor o estado do job (status, total de linhas a processar, processadas, contagem por status e resultados por linha) para consulta periódica pelo frontend. As linhas `IGNORADO` MUST constar nas contagens e nos resultados desde a criação do job, mas MUST NOT contar no total a processar nem nas processadas.

#### Scenario: Consulta durante a execução
- **WHEN** o frontend consulta um job com 120 de 500 linhas processadas
- **THEN** a resposta informa 120 processadas, as contagens por status e os resultados dessas 120 linhas

#### Scenario: Job com linhas ignoradas
- **WHEN** o job foi criado com 500 linhas válidas e 3 inválidas e ainda não processou nada
- **THEN** a resposta informa 0 de 500 processadas, a contagem `IGNORADO` igual a 3 e os resultados das 3 linhas ignoradas

### Requirement: Relatório exportável
O backend SHALL gerar o relatório do job em CSV, com uma linha por linha da planilha contendo: linha da planilha, UID, username gravado, firstName e lastName gravados, status, ações obrigatórias aplicadas (somente para usuários criados), grupos adicionados, grupos que já possuía, grupos com falha, grupos inexistentes, avisos e mensagem. As linhas `IGNORADO` MUST constar no relatório com o motivo na mensagem.

#### Scenario: Download do relatório
- **WHEN** o usuário clica em "Baixar relatório" em um job concluído
- **THEN** o navegador baixa um CSV com o resultado de todas as linhas

#### Scenario: Linha ignorada no relatório
- **WHEN** o job registrou a linha 7 como `IGNORADO` por e-mail inválido
- **THEN** o relatório contém a linha 7 com o status `IGNORADO` e a mensagem "E-mail com formato inválido"

### Requirement: Reprocessamento de erros
O sistema SHALL permitir criar um novo job contendo apenas as linhas com status `ERRO` (e `NAO_PROCESSADO`, se houver) de um job finalizado, usando os mesmos grupos: os grupos selecionados, na importação simples, ou os grupos de cada linha, na importação completa. Linhas `IGNORADO` MUST NOT ser reprocessadas. Por causa das regras de idempotência, o reprocessamento MUST NOT duplicar usuários nem atribuições.

#### Scenario: Reprocessar após falha de grupo
- **WHEN** uma linha terminou em `ERRO` porque o usuário foi criado mas um grupo falhou, e o usuário reprocessa os erros
- **THEN** no novo job o usuário é tratado como existente e recebe apenas o grupo que faltava

#### Scenario: Reprocessar na importação completa
- **WHEN** uma linha da importação completa terminou em `ERRO` e o usuário reprocessa os erros
- **THEN** o novo job usa os grupos daquela linha, e não os de outras linhas
