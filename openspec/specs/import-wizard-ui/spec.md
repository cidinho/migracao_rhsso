# import-wizard-ui Specification

## Purpose

Define a interface do assistente de importação em etapas (Upload, Revisão, Grupos, Confirmação e Resultado), incluindo progresso em tempo real, tela de resultado, tema, acessibilidade e indicação de conectividade com o RH-SSO.

## Requirements

### Requirement: Fluxo guiado em etapas
O frontend SHALL apresentar a importação como um fluxo em etapas visíveis — **Upload**, **Revisão**, **Grupos**, **Confirmação** e **Resultado** —, indicando a etapa atual e permitindo voltar às etapas anteriores, sem perder os dados já informados, até que a importação seja iniciada.

#### Scenario: Voltar sem perder dados
- **WHEN** o usuário está na etapa Grupos com grupos selecionados e volta para Revisão
- **THEN** ao avançar novamente, os grupos selecionados continuam marcados

#### Scenario: Bloqueio de navegação após iniciar
- **WHEN** a importação foi iniciada
- **THEN** as etapas anteriores ficam bloqueadas e só é possível iniciar uma nova importação

### Requirement: Upload acessível
A etapa de Upload SHALL aceitar o arquivo tanto por arrastar e soltar quanto por seleção via botão, MUST ser operável apenas pelo teclado e MUST exibir o link "Baixar modelo CSV" e as colunas esperadas, com uma linha de exemplo em que o UID segue o formato `t_abc1234`.

#### Scenario: Formato esperado na tela
- **WHEN** o usuário abre a etapa de Upload
- **THEN** a tabela "Formato esperado" mostra a linha de exemplo `t_abc1234` | `Maria da Silva Santos` | `maria.santos@exemplo.com.br`, igual à do modelo CSV

#### Scenario: Upload pelo teclado
- **WHEN** o usuário foca a área de upload com Tab e pressiona Enter
- **THEN** abre o seletor de arquivos do sistema

#### Scenario: Arquivo inválido
- **WHEN** o arquivo enviado é rejeitado
- **THEN** a mensagem de erro aparece junto à área de upload, explicando o motivo e como corrigir

### Requirement: Revisão das linhas
A etapa de Revisão SHALL exibir uma tabela paginada com todas as linhas, mostrando username, firstName, lastName e e-mail, com destaque visual e textual para as linhas inválidas e seus motivos. O usuário MUST poder filtrar só as linhas inválidas e remover linhas antes de avançar.

#### Scenario: Somente linhas válidas avançam
- **WHEN** há 8 linhas válidas e 2 inválidas e o usuário avança
- **THEN** a interface informa que as 2 linhas inválidas serão ignoradas e apenas as 8 seguem

#### Scenario: Nenhuma linha válida
- **WHEN** todas as linhas são inválidas
- **THEN** não é possível avançar, e a interface orienta a corrigir a planilha

### Requirement: Confirmação antes de executar
A etapa de Confirmação SHALL resumir quantos usuários serão processados, quantas linhas serão ignoradas, os grupos selecionados (com path completo), o realm de destino e o tempo estimado, calculado a partir da configuração de taxa. A tela MUST informar que os usuários criados terão as ações obrigatórias configuradas no próximo login (por padrão, atualizar o perfil) e que os usuários existentes não serão alterados além dos grupos. A importação MUST ser iniciada somente por uma ação explícita "Importar".

#### Scenario: Resumo exibido
- **WHEN** o usuário chega à Confirmação com 500 linhas válidas e 2 grupos
- **THEN** a tela mostra 500 usuários, os 2 grupos, o realm de destino e uma estimativa de duração

#### Scenario: Aviso de ação obrigatória
- **WHEN** a configuração de ações obrigatórias para novos usuários contém `UPDATE_PROFILE`
- **THEN** a Confirmação exibe o aviso "Usuários novos deverão atualizar o perfil (nome e sobrenome) no próximo login"

### Requirement: Progresso em tempo real
Durante a execução, o frontend SHALL exibir uma barra de progresso, as contagens por status atualizadas periodicamente e os controles de pausar/retomar e cancelar. As mudanças de progresso MUST ser anunciadas para leitores de tela por uma região `aria-live` com atualização moderada.

#### Scenario: Job pausado pelo WAF
- **WHEN** o job entra em `PAUSADO` por bloqueio do WAF
- **THEN** a interface mostra um alerta explicando o bloqueio e oferece o botão "Retomar"

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

### Requirement: Tema e acessibilidade
O frontend SHALL usar o template Materio com o tema **dark** como padrão, MUST indicar status por texto e ícone além da cor e MUST manter foco visível e ordem de tabulação coerente em todos os controles.

#### Scenario: Primeiro acesso
- **WHEN** o usuário abre a aplicação pela primeira vez
- **THEN** a interface é exibida no tema dark

#### Scenario: Status sem depender de cor
- **WHEN** a tabela de resultado exibe uma linha com erro
- **THEN** o status aparece com ícone e texto ("Erro"), não apenas com a cor vermelha

### Requirement: Indicação de conectividade com o RH-SSO
O frontend SHALL exibir o realm de destino e o estado da conexão com o RH-SSO, consultando o endpoint de saúde do backend, e MUST impedir o início da importação quando a conexão estiver com falha.

#### Scenario: Falha de conexão
- **WHEN** o endpoint de saúde indica falha de autenticação
- **THEN** a interface mostra o alerta "Não foi possível conectar ao RH-SSO" e o botão "Importar" fica desabilitado
