# csv-user-upload Specification

## Purpose

Define o recebimento, a leitura e a validação da planilha CSV de usuários (colunas UID, NOME e Email), incluindo detecção de separador e codificação, mapeamento de nome e login, limites do arquivo e o modelo de planilha para download.

## Requirements

### Requirement: Formato da planilha
O sistema SHALL aceitar arquivos `.csv` com cabeçalho contendo as colunas `UID`, `NOME` e `Email`. Os nomes das colunas MUST ser reconhecidos sem diferenciar maiúsculas/minúsculas nem espaços nas extremidades. Colunas extras MUST ser ignoradas.

#### Scenario: Cabeçalho com caixa diferente
- **WHEN** o arquivo tem o cabeçalho `uid;nome;EMAIL`
- **THEN** as três colunas são reconhecidas corretamente

#### Scenario: Coluna obrigatória ausente
- **WHEN** o arquivo não tem a coluna `Email`
- **THEN** o upload é rejeitado com uma mensagem indicando a coluna faltante

#### Scenario: Arquivo que não é CSV
- **WHEN** o usuário envia um arquivo `.xlsx`
- **THEN** o upload é rejeitado com uma mensagem orientando a exportar como CSV

### Requirement: Detecção de separador e codificação
O sistema SHALL detectar automaticamente o separador (`;` ou `,`) e a codificação do arquivo (UTF-8, UTF-8 com BOM ou Windows-1252), preservando corretamente caracteres acentuados.

#### Scenario: CSV exportado pelo Excel em português
- **WHEN** o arquivo usa `;` como separador e codificação Windows-1252 com o nome "João Conceição"
- **THEN** o nome é lido como "João Conceição", sem caracteres corrompidos

#### Scenario: UTF-8 com BOM
- **WHEN** o arquivo é UTF-8 com BOM
- **THEN** o BOM não aparece no nome da primeira coluna e o cabeçalho é reconhecido

### Requirement: Validação das linhas
O sistema SHALL validar cada linha e reportar os erros por linha, sem interromper a leitura das demais. Uma linha MUST ser considerada inválida quando: `UID` estiver vazio, `NOME` estiver vazio, `Email` estiver vazio ou com formato inválido, ou o `UID` (comparado sem diferenciar maiúsculas/minúsculas) se repetir no arquivo. Espaços nas extremidades dos valores MUST ser removidos.

#### Scenario: Linhas válidas e inválidas misturadas
- **WHEN** o arquivo tem 10 linhas, sendo 2 com e-mail inválido
- **THEN** o resultado lista 8 linhas válidas e 2 inválidas, cada uma com o número da linha e o motivo

#### Scenario: UID duplicado no arquivo
- **WHEN** as linhas 3 e 7 têm os UIDs `T_ABC1234` e `t_abc1234`
- **THEN** a linha 7 é marcada como inválida por duplicidade com a linha 3

#### Scenario: E-mail repetido em UIDs diferentes
- **WHEN** duas linhas com UIDs diferentes têm o mesmo e-mail
- **THEN** ambas são consideradas válidas, pois o realm permite e-mails duplicados

### Requirement: Mapeamento do nome
O sistema SHALL mapear `NOME` para `firstName` (primeira palavra) e `lastName` (restante do nome). Quando `NOME` tiver uma única palavra, `lastName` MUST ficar vazio.

#### Scenario: Nome composto
- **WHEN** `NOME` é "Maria da Silva Santos"
- **THEN** `firstName` é "Maria" e `lastName` é "da Silva Santos"

#### Scenario: Nome com uma palavra
- **WHEN** `NOME` é "Maria"
- **THEN** `firstName` é "Maria" e `lastName` é vazio

### Requirement: Normalização do login
O sistema SHALL usar o `UID` como `username`, convertido para minúsculas, e MUST exibir na revisão o valor que será gravado no RH-SSO.

#### Scenario: UID em maiúsculas
- **WHEN** o `UID` é "T_ABC1234"
- **THEN** o username a ser criado é "t_abc1234" e a revisão mostra esse valor

### Requirement: Limites do arquivo
O sistema SHALL rejeitar arquivos maiores que `UPLOAD_MAX_BYTES` (padrão 5 MB) ou com mais linhas que `UPLOAD_MAX_ROWS` (padrão 10.000), e MUST rejeitar arquivos sem nenhuma linha de dados.

#### Scenario: Arquivo vazio
- **WHEN** o arquivo contém apenas o cabeçalho
- **THEN** o upload é rejeitado com a mensagem de que não há usuários na planilha

#### Scenario: Arquivo acima do limite
- **WHEN** o arquivo tem 6 MB e o limite é 5 MB
- **THEN** o upload é rejeitado informando o tamanho máximo permitido

### Requirement: Modelo de planilha
O sistema SHALL disponibilizar para download um arquivo CSV modelo com o cabeçalho `UID;NOME;Email` e uma linha de exemplo. O UID de exemplo MUST seguir o formato `t_abc1234`. O prefixo `t_` é apenas ilustrativo: a validação MUST NOT exigi-lo.

#### Scenario: Download do modelo
- **WHEN** o usuário clica em "Baixar modelo CSV"
- **THEN** o navegador baixa o arquivo modelo, cuja linha de exemplo é `t_abc1234;Maria da Silva Santos;maria.santos@exemplo.com.br`

#### Scenario: UID sem o prefixo do exemplo
- **WHEN** a planilha tem o UID `abc1234`, sem `t_`
- **THEN** a linha é considerada válida e o username a ser criado é `abc1234`
