# Deploy do MVP

O monorepo continua em um único repositório Git. O Vercel publica o frontend e encaminha `/api/*` para a API no Render; assim o navegador usa uma origem só e a sessão HTTP-only funciona sem depender de cookies de terceiros. O Render Blueprint está em `render.yaml` e o projeto Vercel está configurado em `vercel.json`.

## 1. Banco no MongoDB Atlas

Crie um banco de produção e um usuário dedicado à aplicação. Copie a connection string para o segredo `DATABASE_URL` no Render, trocando os placeholders pelos dados do Atlas. Na lista de acesso do Atlas, autorize as faixas de saída (Outbound IPs) do serviço Render e mantenha a lista restrita; não use `0.0.0.0/0` em produção.

## 2. API no Render

Conecte o repositório ao Render e crie um Blueprint apontando para `render.yaml`. Ele prepara um Web Service Node pago de instância única, health check em `/health` e um disco persistente de 1 GB para documentos. O disco preserva uploads entre deploys, mas limita o serviço a uma instância; para escalar, migre os documentos para storage de objetos.

Na primeira criação, preencha os segredos solicitados pelo Blueprint:

- `DATABASE_URL`: URI do Atlas;
- `WEB_ORIGIN`: origem de produção que o Vercel mostrar, sem barra no final;
- `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD`: credenciais iniciais do superadministrador.

O Blueprint gera `SESSION_SECRET` e ativa cookies seguros e confiança em um proxy HTTPS.

O disco persistente é pago e mantém os documentos nesta instância. Configure backups do cluster Atlas e valide uma restauração antes de guardar documentos importantes; o banco e os arquivos ficam em serviços diferentes.

Depois que o serviço estiver criado, confira no Render o hostname real `onrender.com`. Se o nome disponível não for `orchestra-platform-api`, atualize o destino da regra em `vercel.json` para o hostname mostrado pelo Render e faça commit dessa alteração.

## 3. Frontend no Vercel

Importe o mesmo repositório como um projeto Vercel com Root Directory `.`. `vercel.json` define `npm ci`, `npm run build -w apps/web`, `apps/web/dist` e o proxy `/api/*` para o Render. Não configure `VITE_API_BASE_URL` em produção: a interface chama `/api` na mesma origem do site.

Faça o primeiro deploy do Vercel para obter a URL de produção. Cadastre essa origem como `WEB_ORIGIN` no Render e redeploye a API. Em seguida teste login, recarga da página, logout, upload e download de documento.

## 4. Preparar o banco e o primeiro administrador

O primeiro deploy não altera automaticamente o banco. No Shell do serviço Render, execute uma vez:

```sh
npm run prisma:push -w apps/api
npm run seed:superadmin -w apps/api
```

O seed é idempotente pelo e-mail. Guarde as credenciais iniciais no gerenciador de senhas e troque-as depois do primeiro acesso. Confirme no Atlas que o banco recebeu as coleções e índices antes de liberar o site.

## Desenvolvimento local

O `.env` local usa `mongodb://localhost:27017/orchestra?replicaSet=rs0`. Inicie o MongoDB local com `docker compose --profile local-db up -d`, depois rode `npm run prisma:generate -w apps/api`, `npm run prisma:push -w apps/api` e `npm run seed:superadmin -w apps/api`.

Para abrir o ambiente de desenvolvimento no celular, conecte o computador e o celular à mesma rede Wi-Fi, inicie a API (`npm run dev:api`) e o frontend (`npm run dev:web`) e abra no celular `http://IP-LOCAL-DO-COMPUTADOR:5173` (por exemplo, `http://192.168.1.20:5173`). O Vite encaminha `/api` para a API no computador e normaliza a origem somente nesse proxy local. Se o endereço não abrir, permita a porta 5173 no firewall da rede privada do computador. Para acesso fora da rede local, publique o site e use a URL do Vercel; o celular não consegue usar `localhost` do computador.

## Dados do PostgreSQL antigo

A troca do provider não copia dados do PostgreSQL do Orange Pi. O banco antigo e os arquivos de migration foram preservados; faça exportação, conversão e importação planejadas antes de abandonar qualquer dado existente.
