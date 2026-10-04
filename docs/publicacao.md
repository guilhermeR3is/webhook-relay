# Publicação em modo vitrine

A demonstração roda em dois serviços gratuitos do Render e um banco gratuito do Neon:

- `relay-server`: API, worker e limpeza dos dados de demonstração, tudo no mesmo processo (imagem `server` do Dockerfile).
- `relay-web`: o painel (imagem `web`).
- Neon: o Postgres, que também é a fila.

Limites do plano gratuito que explicam as escolhas:

- O Render derruba um serviço após 15 minutos sem requisição e leva cerca de 1 minuto para acordar. Enquanto dorme, o worker não roda: as retentativas só andam depois que ele acorda, e isso não quebra a garantia "pelo menos uma vez".
- As 750 horas por mês valem para o workspace inteiro, não por serviço, e um serviço só consome horas enquanto está acordado. Se as horas acabarem, o Render suspende todos os serviços gratuitos até o início do mês seguinte. Dois serviços acordados ao mesmo tempo gastam o dobro, então não os mantenha acordados de propósito: o portfólio deve chamar o `/health` quando um visitante abre a página, e não de tempos em tempos.
- O Render não oferece worker nem cron gratuitos, e por isso API e worker dividem o processo.
- O Neon suspende o banco após 5 minutos sem consulta (não dá para desligar). Com o serviço acordado, o worker consulta a cada segundo e mantém o banco ligado.
- O Neon avisa que projetos gratuitos inativos há 90 dias ou mais podem ser apagados a partir de 5 de outubro de 2026. Se isso acontecer, veja "Se o banco for apagado" no fim.

## 1. Neon

1. Crie um projeto em `aws-us-east-2` (Ohio). O `render.yaml` usa a região `ohio`, e as duas precisam ficar juntas porque o worker consulta o banco o tempo todo. Se o Render não oferecer Ohio no plano gratuito, use `virginia` no `render.yaml` e `aws-us-east-1` no Neon.
2. Na tela de conexão, copie os dois endereços do mesmo banco:
   - o **direto** (sem `-pooler` no nome), para as migrations e o seed;
   - o **pooled** (com `-pooler`), para o servidor no Render. O pooler mantém as conexões do app abertas quando o Neon suspende o banco.

## 2. Migrations

Do seu computador, com o endereço **direto** entre aspas simples (ele tem `&`):

```sh
DATABASE_URL='<endereço direto>' pnpm --filter @relay/db migrate:deploy
```

A variável digitada no terminal vence a do `.env` local. As imagens não trazem o Prisma, então as migrations sempre rodam daqui. Rode de novo, antes do deploy, sempre que uma migration nova entrar.

## 3. Render

1. Gere a chave de cifra e guarde-a: `openssl rand -base64 32`. Ela cifra os segredos no banco e vai ser usada de novo no passo 4.
2. No Render, `New` → `Blueprint`, escolha este repositório e aplique o `render.yaml`. Ele cria `relay-server` e `relay-web`.
3. Preencha as variáveis que o Render pedir:

| Serviço        | Variável         | Valor                                                                    |
| -------------- | ---------------- | ------------------------------------------------------------------------ |
| `relay-server` | `DATABASE_URL`   | o endereço pooled do Neon                                                |
| `relay-server` | `ENCRYPTION_KEY` | a chave do item 1                                                        |
| `relay-server` | `PANEL_ORIGIN`   | endereço público do painel, por exemplo `https://relay-web.onrender.com` |
| `relay-web`    | `API_URL`        | endereço público da API, por exemplo `https://relay-server.onrender.com` |
| `relay-web`    | `PUBLIC_API_URL` | o mesmo endereço da API                                                  |

O `DEMO_QUOTA_SALT` o Render gera sozinho. Se um nome já estiver em uso, o Render troca o endereço: depois de criar, confira os endereços reais no painel do Render e corrija as três variáveis de endereço. 4. **Não** defina `METRICS_ENABLED`, `ALLOW_PRIVATE_DESTINATIONS` nem `TRUST_PROXY` agora. Os dois primeiros ficam no padrão (desligados) em produção, e o terceiro é descoberto no passo 6.

O `autoDeployTrigger: checksPass` faz o Render publicar só commits com o CI verde.

## 4. Dados de demonstração

Do seu computador, com o endereço **direto**, a mesma chave do Render e o endereço público da API:

```sh
DATABASE_URL='<endereço direto>' \
ENCRYPTION_KEY='<a chave do Render>' \
PUBLIC_API_URL='https://relay-server.onrender.com' \
pnpm seed:demo
```

O comando recria o endpoint `demo` do zero e imprime o `endpointSecret` uma única vez; guarde-o. Rodar de novo apaga os eventos de demonstração e troca o segredo. Outros endpoints não são tocados.

## 5. Conferir

1. `https://<relay-server>/health` e `https://<relay-web>/health` devolvem 200 (a primeira chamada pode levar cerca de 1 minuto, porque o serviço estava dormindo).
2. O painel abre sem erro. Enquanto a API acorda, ele mostra "Acordando a demonstração".
3. O botão "Enviar evento de teste" cria um evento e uma entrega para o `/demo/flaky`, que falha 40% das vezes e deixa a linha do tempo de tentativas cheia.
4. O `/health` público da API mostra só o banco. A profundidade da fila fica no `/health` do worker, que é interno e não aparece no Render.

Para acordar a demonstração antes de um visitante chegar, o portfólio pode chamar o `/health` dos dois serviços quando a página é aberta.

## 6. TRUST_PROXY (descobrir com o serviço publicado)

A API só confia no `X-Forwarded-For` dos proxies listados em `TRUST_PROXY`; vazio, ela enxerga o endereço do proxy do Render como se fosse o visitante, e todos dividem a mesma cota de 5 eventos por hora (a cota global de 200 por dia continua protegendo). A documentação do Render não diz quais cabeçalhos ele manda nem quais são os endereços dos proxies, então o valor precisa ser descoberto testando:

1. Com `TRUST_PROXY` vazio, faça uma requisição e veja nos logs do Render o `remoteAddress` dela: é o endereço do proxy.
2. Defina `TRUST_PROXY` com esse endereço (ou com `uniquelocal`, se for um endereço privado) e publique de novo.
3. Confirme que o `X-Forwarded-For` forjado não vale: mande o botão de teste mais de 5 vezes na mesma hora, cada uma com um `X-Forwarded-For` diferente. A sexta tem que devolver 429 com `scope: "ip"`; se todas passarem, o cabeçalho forjado está sendo aceito e o valor está largo demais.

## Assinar uma chamada a `/in/demo`

O endpoint de demonstração recusa chamadas sem assinatura (401). Para enviar um evento seu, assine o corpo com o `endpointSecret` do passo 4:

```sh
BODY='{"hello":"world"}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$ENDPOINT_SECRET" -hex | sed 's/^.* //')
curl -X POST "https://relay-server.onrender.com/in/demo" \
  -H "content-type: application/json" \
  -H "x-signature-256: sha256=$SIGNATURE" \
  -d "$BODY"
```

## Se o banco for apagado

Crie outro projeto no Neon, troque o `DATABASE_URL` no Render pelo novo endereço pooled e repita os passos 2 e 4 com o novo endereço direto. Os endpoints e destinos não ficam no repositório: o `seed:demo` recria a demonstração e o `pnpm endpoint:add` recria os outros, como o do GitHub com n8n descrito em `docs/n8n.md`.

## O que só se confirma publicando

Estes pontos foram preparados e testados localmente, mas dependem do Render e ficam sem confirmação até a primeira publicação:

- o Render repassa `RELAY_TARGET` como argumento de build e escolhe a imagem certa (localmente, `docker build --build-arg RELAY_TARGET=web .` e o padrão geram as imagens esperadas);
- a região `ohio` existe no plano gratuito;
- os endereços reais dos serviços;
- o valor de `TRUST_PROXY`;
- o caminho https do destino com a proteção contra SSRF (a consulta de DNS guardada), que só se valida contra um destino público de verdade, como o próprio `/demo/flaky` publicado.
