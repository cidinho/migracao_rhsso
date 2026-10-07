## MODIFIED Requirements

### Requirement: Tela de resultado
A etapa de Resultado SHALL mostrar cartões com os totais por status (Criados, Grupos adicionados, Sem alteração, Erros e, quando houver, Ignorados e Não processados) e uma tabela filtrável por status, com o detalhe dos grupos de cada usuário, incluindo os grupos inexistentes. A tela MUST oferecer "Baixar relatório", "Reprocessar erros" (quando houver erros) e "Nova importação".

#### Scenario: Usuário criado
- **WHEN** uma linha terminou como `CRIADO`
- **THEN** a tabela indica que o usuário foi criado e que deverá atualizar o perfil no próximo login

#### Scenario: Usuário já existia e já possuía o grupo
- **WHEN** uma linha terminou como `SEM_ALTERACAO`
- **THEN** a tabela mostra, para essa linha, que o usuário já existia e já possuía os grupos selecionados

#### Scenario: Filtrar erros
- **WHEN** o usuário clica no cartão "Erros"
- **THEN** a tabela passa a mostrar apenas as linhas com status `ERRO`

#### Scenario: Linhas ignoradas
- **WHEN** a planilha tinha 2 linhas inválidas
- **THEN** o cartão "Ignorados" mostra 2 e a tabela exibe essas linhas com o motivo

#### Scenario: Grupo inexistente
- **WHEN** uma linha da importação completa citou um grupo inexistente
- **THEN** o detalhe da linha mostra esse grupo como "Inexistente", distinto por ícone e texto dos grupos atribuídos
