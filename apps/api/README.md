# API

Módulos atuais:
- `auth`: login, logout, sessão atual e aceitação de convites para contas novas ou existentes.
- `organizations`: listar instituições, criar instituição (superadmin), convidar membros e gerir memberships.
- `events`: consultar/criar/editar/excluir eventos por instituição.
- `trips`: consultar/criar viagens, associar/desassociar eventos e ordenar o itinerário.
- `documents`: biblioteca privada, com upload/download autorizado e limite de 25 MiB por arquivo.
- `system/overview`: métricas globais para superadmin.

Endpoints principais:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/organizations`
- `POST /api/organizations` (superadmin)
- `POST /api/organizations/:organizationId/invitations` (gera convite de uso único; envio de e-mail ainda manual)
- `POST /api/auth/accept-invitation` (aceita convite e cria conta)
- `GET /api/organizations/:organizationId/members` (membros e convites pendentes, somente admin)
- `POST /api/organizations/:organizationId/members`
- `PATCH /api/organizations/:organizationId/members/:membershipId`
- `GET /api/organizations/:organizationId/events`
- `POST /api/organizations/:organizationId/events`
- `PATCH /api/organizations/:organizationId/events/:eventId`
- `DELETE /api/organizations/:organizationId/events/:eventId`
- `GET /api/organizations/:organizationId/trips`
- `POST /api/organizations/:organizationId/trips`
- `POST /api/organizations/:organizationId/trips/:tripId/events`
- `DELETE /api/organizations/:organizationId/trips/:tripId/events/:eventId`
- `PATCH /api/organizations/:organizationId/trips/:tripId/events` (substitui a lista ordenada; eventos devem ser da mesma organização)
- `GET /api/organizations/:organizationId/documents`
- `POST /api/organizations/:organizationId/documents?title=...&visibility=...` (corpo binário, `X-File-Name` e MIME permitido)
- `GET /api/organizations/:organizationId/documents/:documentId/download`
- `DELETE /api/organizations/:organizationId/documents/:documentId`

Convites geram tokens de uso único que expiram em sete dias; a entrega do link ainda é manual. O diretório privado de documentos usa `.private-documents` por padrão e pode ser alterado com `DOCUMENT_STORAGE_PATH`; em produção, configure um volume persistente e restrinja o acesso ao processo da API. A autorização usa as roles iniciais; `Permission` e `RolePermission` ainda não dirigem as verificações.
