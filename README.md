# Webhook Relay

Serviço que recebe webhooks de qualquer sistema (GitHub, gateway de pagamento, n8n) e garante a entrega aos destinos cadastrados. A entrada verifica a assinatura da origem e grava o evento uma única vez; um worker entrega a cada destino com retentativas, fila de mensagens mortas e disjuntor por destino.

A garantia é de entrega **pelo menos uma vez**: todo evento aceito chega ao destino, mas pode chegar duas vezes (o destino processou e a resposta se perdeu na rede). Não há garantia de ordem.

## Como rodar localmente

Precisa de Node 24, pnpm 11 e Docker.

```sh
cp .env.example .env
# preencha ENCRYPTION_KEY com o resultado de: openssl rand -base64 32
docker compose up -d postgres
pnpm install
pnpm --filter @relay/db build
pnpm --filter @relay/db migrate:deploy
pnpm --filter @relay/api dev
pnpm --filter @relay/worker dev   # em outro terminal
```

Ainda não existe rota nem tela para cadastrar endpoints e destinos; isso chega com o painel e o seed de demonstração.

## Verificando a assinatura de saída

Toda entrega leva três headers, no padrão [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md):

| Header              | Conteúdo                                                           |
| ------------------- | ------------------------------------------------------------------ |
| `webhook-id`        | id da entrega; é o mesmo em todas as tentativas                    |
| `webhook-timestamp` | segundos desde 1970; é novo a cada tentativa                       |
| `webhook-signature` | `v1,<base64>`; pode trazer várias assinaturas separadas por espaço |

A assinatura é o HMAC-SHA256, em base64, do texto `webhook-id`, ponto, `webhook-timestamp`, ponto e os bytes do corpo. A chave é o segredo do destino, que tem o formato `whsec_<base64>`: o que vem depois do prefixo, decodificado, são os bytes da chave.

Para o destino verificar:

1. Use o corpo exatamente como chegou, em bytes. Se ele for lido como JSON e serializado de novo, a assinatura deixa de bater.
2. Recuse timestamps fora de uma janela (os exemplos usam 5 minutos), para impedir que uma mensagem capturada seja reenviada depois.
3. Compare em tempo constante.
4. Guarde os `webhook-id` já processados e ignore os repetidos: é assim que o destino lida com a entrega pelo menos uma vez.

### Node

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

// rawBody é o Buffer do corpo como chegou, antes de qualquer JSON.parse
export function verifyWebhook(secret, headers, rawBody) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestamp || !signatures) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!(ageSeconds <= TOLERANCE_SECONDS)) {
    return false;
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(rawBody).digest();

  return signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || value === undefined) {
      return false;
    }
    const received = Buffer.from(value, "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
```

Com a biblioteca oficial (`npm install standardwebhooks`), que lança um erro se algo não bater:

```js
import { Webhook } from "standardwebhooks";

const payload = new Webhook(secret).verify(rawBody, headers);
```

### Python

Precisa de Python 3.9 ou mais novo.

```python
import base64
import hashlib
import hmac
import time

TOLERANCE_SECONDS = 300


def verify_webhook(secret: str, headers: dict, raw_body: bytes) -> bool:
    # raw_body são os bytes do corpo como chegou, antes de qualquer json.loads
    msg_id = headers.get("webhook-id")
    timestamp = headers.get("webhook-timestamp")
    signatures = headers.get("webhook-signature")
    if not (msg_id and timestamp and signatures):
        return False

    try:
        age_seconds = abs(time.time() - int(timestamp))
    except ValueError:
        return False
    if age_seconds > TOLERANCE_SECONDS:
        return False

    key = base64.b64decode(secret.removeprefix("whsec_"))
    signed = f"{msg_id}.{timestamp}.".encode() + raw_body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest())

    for entry in signatures.split(" "):
        version, _, value = entry.partition(",")
        if version == "v1" and hmac.compare_digest(value.encode(), expected):
            return True
    return False
```

Com a biblioteca oficial (`pip install standardwebhooks`), que lança `WebhookVerificationError` se algo não bater:

```python
from standardwebhooks import Webhook

payload = Webhook(secret).verify(raw_body, headers)
```

Os dois primeiros trechos de cada linguagem (as funções completas) são extraídos deste arquivo e executados pelos testes do repositório contra uma requisição montada pelo código de envio do worker, então o que está escrito aqui é o que foi verificado.
