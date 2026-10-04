# Exemplo: eventos do GitHub chegando ao n8n pelo relay

O caminho do evento:

```
GitHub  ->  relay (POST /in/github)  ->  n8n (Webhook)
```

O relay confere a assinatura do GitHub, guarda o evento e responde 202. Depois entrega ao n8n com novas tentativas se o n8n estiver fora do ar. Como a entrega é "pelo menos uma vez", o mesmo evento pode chegar duas vezes (o n8n processou, mas a resposta se perdeu). Por isso o fluxo deste exemplo guarda os `webhook-id` já vistos e responde `duplicate: true` quando o id se repete.

Versão testada: n8n 2.41.6, a mesma do serviço `n8n` do `docker-compose.yml`.

## O fluxo

O arquivo `docs/n8n/github-push.json` tem seis nós:

1. **Webhook do relay**: recebe o POST e só responde no fim (`Respond to Webhook`).
2. **Evitar duplicada**: lê o cabeçalho `webhook-id`, confere numa lista guardada no estado do fluxo e marca o id como visto.
3. **É duplicada?**: separa os dois caminhos.
4. **Responder: já processada**: devolve `{ "received": true, "duplicate": true }`.
5. **Resumir o push**: extrai repositório, branch, autor e número de commits do evento.
6. **Responder: processada**: devolve o resumo com `duplicate: false`.

A resposta do n8n fica gravada na tentativa do relay (os primeiros 2 KB), então dá para conferir o resultado sem abrir o n8n.

## Ensaio local, sem GitHub

Serve para ver tudo funcionando antes de publicar. Precisa do Postgres do projeto (`docker compose up -d postgres`) e de `ALLOW_PRIVATE_DESTINATIONS=true` no `.env`, que é o valor do `.env.example`.

1. Importe e publique o fluxo no n8n do compose, e suba o n8n:

   ```sh
   docker compose --profile n8n run --rm n8n import:workflow --input=/workflows/github-push.json
   docker compose --profile n8n run --rm n8n publish:workflow --id=relayGithubPush1
   docker compose --profile n8n up -d n8n
   ```

   Também dá para importar o arquivo pela interface do n8n (`http://localhost:5678`); esse caminho eu não testei.

2. Cadastre o endpoint e o destino. Guarde o `endpointSecret` que o comando imprime, porque o banco só guarda a versão cifrada:

   ```sh
   pnpm endpoint:add --slug github --scheme github \
     --destination-url http://localhost:5678/webhook/github-push --event-types push
   ```

3. Suba a API e o worker (`pnpm --filter @relay/api dev` e `pnpm --filter @relay/worker dev`) e mande um evento no formato do GitHub, assinado com o segredo:

   ```sh
   BODY='{"ref":"refs/heads/main","repository":{"full_name":"voce/repo"},"pusher":{"name":"voce"},"commits":[{"id":"a"}]}'
   SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$ENDPOINT_SECRET" -hex | sed 's/^.* //')
   curl -X POST http://localhost:3000/in/github \
     -H "content-type: application/json" \
     -H "x-hub-signature-256: sha256=$SIGNATURE" \
     -H "x-github-event: push" \
     -H "x-github-delivery: ensaio-1" \
     -d "$BODY"
   ```

4. Veja a tentativa e a resposta do n8n:

   ```sh
   docker compose exec -T postgres psql -U relay -d relay -c \
     "SELECT d.status, a.http_status, left(a.response_snippet, 120) FROM delivery d JOIN attempt a ON a.delivery_id = d.id ORDER BY a.started_at;"
   ```

   A resposta traz `"duplicate":false` e o resumo do push.

5. Para ver a duplicata, simule um worker que morreu depois de o n8n processar: deixe a entrega "em andamento" com a posse vencida, e o worker reenvia com o mesmo `webhook-id`.

   ```sh
   docker compose exec -T postgres psql -U relay -d relay -c \
     "UPDATE delivery SET status = 'in_progress', locked_until = now() - interval '1 second', succeeded_at = NULL;"
   ```

   Rode a consulta do passo 4 de novo: aparece uma segunda tentativa com `"duplicate":true`.

Para desfazer o ensaio: `docker compose --profile n8n rm -sf n8n` e `docker volume rm webhook-relay_n8n-data`. Não use `docker compose down -v`, que apaga também o volume do Postgres.

## Com o GitHub de verdade

Depende do relay publicado (`docs/publicacao.md`), porque o GitHub precisa de um endereço público, e de um n8n com endereço **https público**: em produção o relay recusa destinos em rede privada. Servem o n8n Cloud, um n8n no seu servidor, ou um n8n local atrás de um túnel.

1. No n8n, importe `docs/n8n/github-push.json`. **Troque o caminho do nó "Webhook do relay"** por um valor longo e aleatório (`openssl rand -hex 16`): neste exemplo o caminho é a proteção do destino, e é por isso que o relay não o mostra nos logs nem no painel. Publique o fluxo.
2. Cadastre o endpoint no banco do Neon, com o endereço **direto**, a mesma `ENCRYPTION_KEY` do Render e a URL de produção do n8n (`https://<seu n8n>/webhook/<caminho>`):

   ```sh
   DATABASE_URL='<endereço direto>' ENCRYPTION_KEY='<a chave do Render>' \
     pnpm endpoint:add --slug github --scheme github \
     --destination-url 'https://<seu n8n>/webhook/<caminho>' --event-types push
   ```

3. No repositório do GitHub, em `Settings` → `Webhooks` → `Add webhook`: **Payload URL** `https://<relay-server>.onrender.com/in/github`, **Content type** `application/json`, **Secret** o `endpointSecret` do passo anterior, e em "Which events would you like to trigger this webhook?" escolha "Let me select individual events" e marque só o push. Os nomes dos campos são os da documentação do GitHub; não testei esta tela, que depende do relay publicado.
4. Faça um push. No GitHub, a entrega recente deve aparecer com resposta 202; no n8n, a execução aparece na lista de execuções.

Se o serviço do Render estiver dormindo, a primeira entrega do GitHub vai falhar: ele espera 10 segundos por uma resposta 2xx, marca a entrega como falha e não tenta de novo sozinho, e o serviço leva cerca de 1 minuto para acordar. Reenvie a entrega pela lista de entregas recentes do webhook no GitHub, com o serviço já acordado (abra o `/health` antes).

## Limites e cuidados

- **A garantia do relay começa depois da resposta 202.** Quem envia o evento (o GitHub, aqui) precisa conseguir entregá-lo ao relay. No modo vitrine o serviço gratuito dorme, e por isso uma entrega do GitHub pode falhar antes de o relay aceitá-la; num serviço sempre ligado isso não acontece.
- **O relay não repassa os cabeçalhos do GitHub** (como `x-github-event`) ao destino. Só vão o corpo, o `content-type` e os cabeçalhos `webhook-*`. Por isso o destino se inscreve apenas nos tipos que o fluxo trata (`--event-types push`), e este fluxo trata `push`. Para outro tipo, cadastre outro endpoint e crie outro webhook no GitHub. O evento `ping`, que o GitHub manda ao criar o webhook, é aceito com 202 e não gera entrega.
- **Use `application/json`** como tipo de conteúdo no GitHub. No formato `x-www-form-urlencoded` o corpo chegaria como `payload=...` e o fluxo não o entenderia.
- **A lista de ids vistos** fica no estado do fluxo (`$getWorkflowStaticData`), limitada aos 500 mais recentes. Basta para o exemplo, mas não é uma trava atômica: duas entregas simultâneas com o mesmo id poderiam passar as duas. Para algo crítico, use uma restrição única num banco.
- **A assinatura de saída (`webhook-signature`) não é verificada neste exemplo.** Ela cobre os bytes exatos do corpo, e o nó Webhook entrega o corpo já interpretado. O código de verificação em Node e Python está no README.
- **O painel só mostra o endpoint `demo`**, então este endpoint não aparece nele. Confira pelas execuções do n8n ou pela consulta ao banco do passo 4.
