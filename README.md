# Orchestra Space

Plataforma multi-orquestra em TypeScript, Express, Prisma, MongoDB Atlas e React.

## Estado desta versão

Implementação inicial executável com:
- API Express com validação Zod, logs Pino e tratamento centralizado de erros.
- Prisma schema para usuários, organizações, memberships, papéis/permissões, eventos, detalhes de ensaios/concertos, viagens e documentos.
- Autenticação por sessão em cookie HTTP-only com Argon2id.
- Bootstrap do superusuário via variáveis de ambiente.
- Organização e membership endpoints com isolamento por organização.
- CRUD básico de eventos e viagens, incluindo vínculo de eventos a viagens.
- Frontend React/Vite com login, seleção de organização, dashboard e formulários básicos.
- Docker Compose opcional para desenvolvimento local.

Não é ainda uma plataforma pronta para produção: ver `docs/ROADMAP.md`.

## Requisitos

- Node.js 22 LTS ou versão compatível com as dependências
- npm
- MongoDB local em replica set para desenvolvimento; MongoDB Atlas para produção
- O PostgreSQL do Orange Pi não é usado diretamente por esta versão MongoDB

## 1. Configurar MongoDB local

Inicie o replica set local:

```bash
docker compose --profile local-db up -d
```

O `.env.example` usa `mongodb://localhost:27017/orchestra?replicaSet=rs0`. Em produção, configure a URI do Atlas no painel do provedor; não a grave no repositório. MongoDB não usa as migrations SQL antigas; elas foram mantidas como histórico e não são aplicadas.

## 2. Configurar API

```bash
cd apps/api
cp .env.example .env
```

Edite `.env`, especialmente `DATABASE_URL`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD`.

```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run seed:superadmin
npm run dev
```

API: `http://localhost:3000`
Health check: `http://localhost:3000/health`

O comando de seed só cria o superusuário se o e-mail ainda não existir. Use uma senha longa e exclusiva.

### Backup manual do MongoDB

Instale o MongoDB Database Tools na máquina que tem acesso ao Atlas e confirme que `mongodump` está no `PATH`. Depois, na raiz do repositório, rode:

```bash
npm run make_mongo_backup
```

O comando lê `apps/api/.env`, usa `DATABASE_URL` e grava um arquivo compactado em `backups/mongodb/`. Os backups são ignorados pelo Git; o arquivo não é criptografado e contém dados pessoais, então guarde-o em disco protegido (por exemplo, com BitLocker) e mantenha uma cópia externa protegida. O script não faz upload nem substitui snapshots automáticos do Atlas.

Faça um backup antes de sincronizar alterações do Prisma com o banco. Para confiar nele, ensaie também uma restauração em um banco de teste separado; criar o arquivo, por si só, não comprova que a restauração funcionará.

## 3. Configurar frontend

Em outro terminal:

```bash
cd apps/web
cp .env.example .env
npm install
npm run dev
```

Frontend: `http://localhost:5173`

A API permite CORS apenas para a origem definida em `WEB_ORIGIN`.

## 4. Banco já existente

O schema ainda não deve ser aplicado sobre tabelas existentes sem revisão. Faça backup antes da primeira migração. `prisma migrate dev` cria migrações de desenvolvimento; para implantação, use `prisma migrate deploy`.

## Segurança importante

- Sessão em cookie HTTP-only, `sameSite=lax`; em produção, configure HTTPS e `COOKIE_SECURE=true`.
- Senhas com Argon2id.
- O superusuário não pode ser criado por cadastro público.
- Toda rota institucional valida membership/role no backend.
- Os arquivos não são enviados a um diretório público: o módulo de documentos ainda precisa de storage e autorização de download antes de uso real.
- Configure backups e teste a restauração antes de guardar dados importantes.
