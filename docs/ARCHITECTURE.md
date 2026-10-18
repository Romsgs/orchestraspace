# Arquitetura

## Princípios
- Monólito modular: deploy e operação simples, módulos com responsabilidades claras.
- MongoDB compartilhado entre organizações, com `organizationId` em cada recurso institucional.
- Autenticação global separada dos papéis institucionais.
- Evento é independente; `TripEvent` permite associar o mesmo evento a uma ou mais viagens sem duplicação.
- Documentos guardam metadados no banco e o arquivo no storage privado.
- Toda operação de escrita institucional deve verificar membership e papel no backend.

## Domínios
- Identity: User, login, sessões e bootstrap do superadmin.
- Organizations: Organization, Membership, Role, Permission, invitations.
- Events: agenda e detalhes específicos por tipo.
- Trips: itinerário, paradas e vínculo com eventos.
- Documents: metadados e storage privado.
- Communications: comunicados e notificações (futuro).
- Audit: histórico administrativo.

## Isolamento
Não basta filtrar no frontend. Toda rota institucional deve validar o membership e conferir `organizationId` em cada registro. As relações `TripEvent` devem verificar que o evento e a viagem pertencem à mesma organização. O endpoint atual já verifica isso no vínculo de evento à viagem.
