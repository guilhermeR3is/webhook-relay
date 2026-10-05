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

O `DEMO_QUOTA_SALT` o Render gera sozinho. Se um nome já estiver em uso, o Render troca o endereço: depois de criar, confira os endereços reais no painel do Render e corrija as três variáveis de endereço. 4. **Não** defina `METRICS_ENABLED` nem `ALLOW_PRIVATE_DESTINATIONS`: ficam no padrão (desligados) em produção. O `TRUST_PROXY` entra no passo 6, depois que os serviços estiverem no ar.

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

## 6. TRUST_PROXY

A API só confia no `X-Forwarded-For` dos proxies listados em `TRUST_PROXY`. Vazio, ela enxerga o endereço do proxy do Render como se fosse o visitante, e todos dividem a mesma cota de 5 eventos por hora (a cota global de 200 por dia continua protegendo). Defina a variável no `relay-server`, numa linha só, sem espaços e sem aspas:

```
loopback,uniquelocal,173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

Por que esse valor: a documentação do Render não diz como o endereço do visitante chega, então ele foi medido no serviço publicado. Uma chamada de visitante chega ao processo pelo proxy local do container (`127.0.0.1`), e o `X-Forwarded-For` vem como `visitante, borda do Cloudflare, salto interno do Render`, por exemplo `177.41.211.90, 162.159.115.35, 10.24.0.151`. O proxy do Render não limpa o cabeçalho que o visitante manda: ele só acrescenta endereços no fim, e um endereço forjado fica no começo da lista (`9.9.9.9, 177.41.211.90, ...`). Por isso a API precisa confiar nos três tipos de salto (`loopback`, `uniquelocal` para a rede interna e as faixas do Cloudflare) e parar no primeiro endereço que não é de confiança, lendo a lista da direita para a esquerda: esse é o visitante, e o que vem antes dele é ignorado.

As faixas são as publicadas em `https://www.cloudflare.com/ips-v4` e `https://www.cloudflare.com/ips-v6`. Se o Cloudflare as mudar, atualize o valor.

Como conferir: do seu computador, mande o botão de teste 6 vezes na mesma hora, cada vez com um `X-Forwarded-For` diferente.

```sh
for i in 1 2 3 4 5 6; do
  curl -4 -s -o /dev/null -w '%{http_code}\n' -X POST -H "X-Forwarded-For: 9.9.9.$i" \
    -H "Origin: https://<relay-web>.onrender.com" https://<relay-server>.onrender.com/panel/test-event
done
```

O esperado é 201 cinco vezes e 429 na sexta: o endereço forjado não troca a cota. Para ver que cada visitante tem a cota dele, use o botão do painel pelo celular, no 4G e com o Wi-Fi desligado, depois de esgotar a cota do computador: o do celular deve funcionar. Os nomes `onrender.com` só têm endereço IPv4, então `curl -6` não serve de segundo visitante: ele usa o mesmo endereço IPv4.

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

## O que foi confirmado publicando

Estes pontos dependiam do Render e foram conferidos no serviço publicado:

- o Render repassa `RELAY_TARGET` como argumento de build e cada serviço sobe a imagem certa;
- o `/health` da API mostra o commit publicado (`RENDER_GIT_COMMIT`) e o banco do Neon pelo endereço pooled;
- o botão de teste funciona com a origem real do painel, e o worker entrega ao `/demo/flaky` pelo endereço HTTPS público, com a proteção contra SSRF ativa, o limite de 10 segundos e a nova tentativa;
- o valor de `TRUST_PROXY` do passo 6.

O que continua sem confirmação: a tela de webhook do GitHub e o exemplo do n8n com um n8n público (`docs/n8n.md`).
