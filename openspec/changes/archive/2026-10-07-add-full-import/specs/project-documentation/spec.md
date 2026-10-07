## ADDED Requirements

### Requirement: Documentação da importação completa
O README SHALL explicar a diferença entre a importação simples e a completa, documentar o formato da planilha da importação completa (colunas de grupo raiz, subgrupos separados por `|`, apenas um nível), as regras de grupo inexistente e de linha sem grupo válido, o status `IGNORADO` e o status de grupo `INEXISTENTE`, usando nomes de grupo genéricos nos exemplos.

#### Scenario: Preparar a planilha da importação completa
- **WHEN** o operador prepara uma planilha da importação completa seguindo apenas o README
- **THEN** a planilha é aceita e cada usuário recebe os subgrupos indicados na sua linha
