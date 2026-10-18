# Roadmap e lacunas conhecidas

## Implementado nesta base
- API e frontend separados.
- Sessão persistida no MongoDB via Prisma.
- Login/logout/me.
- Bootstrap do superadmin.
- Criar/listar organizações.
- Criar/consultar/editar/excluir eventos.
- Criar/consultar viagens e vincular/desvincular eventos.
- Convites de uso único com expiração, aceitação de conta nova ou existente e gestão de membros no frontend.
- Gestão visual dos eventos e ordem de cada viagem.
- Biblioteca de documentos com armazenamento local privado, validação MIME/tamanho e controle de visibilidade.
- Testes automatizados do middleware de isolamento por organização.
- Papéis iniciais por organização e alteração básica de membership.
- Dashboard React inicial.

## Antes de produção
1. Configurar entrega de convites por e-mail transacional. O token de uso único é entregue atualmente para compartilhamento manual.
2. Implementar permissões granularmente a partir de `Permission` e `RolePermission`, em vez de verificar apenas chaves de papel.
3. Expandir os testes de isolamento para testes de integração com MongoDB replica set e cobrir todas as rotas institucionais.
4. Implementar CSRF conforme a estratégia final de cookies e implantação.
5. Completar edição de detalhes específicos de ensaio/concerto em transações.
6. Implementar gestão visual de paradas das viagens.
7. Adicionar varredura de malware e storage de objetos para documentos quando o ambiente de produção estiver definido.
8. Adicionar presença, participantes, notificações, comunicados e recibos de leitura.
9. Implementar auditoria para todas as operações sensíveis e evitar que falhas de auditoria ocultem a operação original.
10. Adicionar rate limit geral, política de senha, recuperação de conta e verificação de e-mail por token.
11. Rever remoções e retenção de dados, backups e restauração.
12. Executar instalação, geração Prisma, sincronização do schema, build e testes em staging.

## Limitações desta versão
- A API `GET /api/auth/me` fornece membership e papéis; o frontend pode precisar de uma atualização de estado depois de adicionar ou alterar membros.
- O link de convite precisa ser compartilhado manualmente; não há envio de e-mail transacional.
- O formulário de evento cria eventos e detalhes de concerto; edição dos detalhes específicos e anexos ainda precisam ser completados.
- A biblioteca grava arquivos localmente no diretório privado configurado; implantações com várias instâncias precisam de um storage compartilhado apropriado.
- A interface de viagens gere eventos vinculados, mas ainda não gere paradas.
- O campo `Permission` está modelado, mas a autorização usa papéis iniciais explícitos.
- É um starter funcional a validar, não uma declaração de prontidão para produção.
