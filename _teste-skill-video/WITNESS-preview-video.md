# Testemunha — custo da gravação do preview animado

- **Data (UTC):** 2026-08-21 (runs entre 03:44 e 04:00Z)
- **Repo/branch:** EzPrompter, `claude/skill-clone-comparison-fg9h0l` (HEAD destacado na ponta da branch)
- **Script medido:** `packages/web-shell/scripts/witness-preview-video.mjs` (não foi editado)
- **URLs pedidas:** `https://www.farmminerals.com/promo` (alvo) e `https://example.com` (contraste estático)

## RESULTADO: BLOQUEADO — nenhum número foi produzido

Os dois runs abortaram na PRIMEIRA navegação do produtor (`page.goto`), antes de
qualquer captura, com `net::ERR_CONNECTION_RESET`. Portanto:

- **(a) o vídeo é gravado de verdade?** — NÃO RESPONDIDO nesta sessão.
- **(b) quanto custa em tempo?** — NÃO RESPONDIDO nesta sessão.

Não há medida parcial: o script imprime tudo só no fim, e ele nunca chegou lá.

## O que cada número do script significaria (se tivesse rodado)

Lendo `witness-preview-video.mjs` (nada aqui é medida, é só a legenda):

| campo | significado |
|---|---|
| `vídeo presente` | existe um asset no caminho `PREVIEW_VIDEO_PATH` dentro do bundle capturado |
| `bytes` | tamanho do corpo desse asset |
| `assinatura` | 4 primeiros bytes; `1a 45 df a3` = container WebM |
| `com preview` | média (e valores individuais) do wall-clock de `captureNativeBundle(url,{preview:true})` |
| `sem preview` | idem com `{preview:false}` |
| `CUSTO` | `média(com) − média(sem)`, em ms e em % sobre a captura sem preview |
| `assets com/sem` | contagem de assets nos dois braços (esperado: com = sem + 1) |

O script alterna a ordem dos braços a cada repetição para rede/cache não
favorecerem sempre o mesmo lado.

## Passos executados, em ordem

### 1. `bun install` em `packages/web-shell` — OK

```
+ playwright-core@1.60.0
+ react@19.2.5
...
1770 packages installed [10.92s]
```

### 2. Confirmação de rede por curl — 200 nas duas URLs

```
$ curl -sS -o /dev/null -w "%{http_code}" https://www.farmminerals.com/promo
200
$ curl -sS -o /dev/null -w "%{http_code}" https://example.com
200
```

(Repetido às 04:00:01Z, ainda `farm=200 example=200`.)

Como o curl deu 200, a regra do pedido ("se não der 200, escreva WITNESS-BLOCKED
e pare") não disparou — o bloqueio apareceu depois, no navegador.

### 3. Ajuste de ambiente do Playwright (fora do repo, sem tocar código de produção)

O `playwright-core@1.60.0` procura o Chromium na revisão **1223**; a imagem tem a
revisão **1194** instalada em `/opt/pw-browsers`. Erro literal do primeiro launch:

```
browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell
```

Não existe variável de ambiente de `executablePath` no playwright-core 1.60
(varredura em `node_modules/playwright-core/lib` só acha `PLAYWRIGHT_MCP_EXECUTABLE_PATH`),
então o ajuste foi por **symlink em `/opt/pw-browsers`** (fora do repositório;
nenhum arquivo do produto foi editado):

```
/opt/pw-browsers/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell
  -> /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
/opt/pw-browsers/chromium-1223/chrome-linux64/chrome
  -> /opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

Depois disso o navegador ABRE. Versão realmente lançada (≠ da esperada pelo
playwright 1.60, que é 148.0.7778.96):

```
OK 141.0.7390.37
```

O `ffmpeg` que o Playwright usa para vídeo está na revisão que o 1.60 pede
(`ffmpeg-1011`), sem ajuste.

### 4. Run 1 — farmminerals (saída literal, `tail -30`)

```
$ node scripts/witness-preview-video.mjs https://www.farmminerals.com/promo 2
(node:19262) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///home/user/EzPrompter/packages/web-shell/lib/native-clone/capture-bundle.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /home/user/EzPrompter/packages/web-shell/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

page.goto: net::ERR_CONNECTION_RESET at https://www.farmminerals.com/promo
Call log:
  - navigating to "https://www.farmminerals.com/promo", waiting until "load"

    at captureNativeBundle (/home/user/EzPrompter/packages/web-shell/lib/native-clone/capture-bundle.js:253:16)
    at async rodada (/home/user/EzPrompter/packages/web-shell/scripts/witness-preview-video.mjs:21:15)
    at async file:///home/user/EzPrompter/packages/web-shell/scripts/witness-preview-video.mjs:31:29 {
  name: 'Error'
}

Node.js v22.22.2
```

(O primeiro run, às 03:44:21Z, deu exatamente o mesmo erro e durou 13s do
START ao END — tempo de abrir o navegador e falhar a navegação, não de captura.)

### 5. Run 2 — example.com (saída literal, `tail -25`)

```
$ node scripts/witness-preview-video.mjs https://example.com 2
(node:19696) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///home/user/EzPrompter/packages/web-shell/lib/native-clone/capture-bundle.js is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /home/user/EzPrompter/packages/web-shell/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

page.goto: net::ERR_CONNECTION_RESET at https://example.com/
Call log:
  - navigating to "https://example.com/", waiting until "load"

    at captureNativeBundle (/home/user/EzPrompter/packages/web-shell/lib/native-clone/capture-bundle.js:253:16)
    at async rodada (/home/user/EzPrompter/packages/web-shell/scripts/witness-preview-video.mjs:21:15)
    at async file:///home/user/EzPrompter/packages/web-shell/scripts/witness-preview-video.mjs:31:29 {
  name: 'Error'
}

Node.js v22.22.2
```

## Diagnóstico da falha (só o que foi medido)

Esta sessão roda atrás de um proxy de egresso que termina TLS
(`HTTPS_PROXY=http://127.0.0.1:42945`). Medidas:

1. **Sem proxy configurado no Chromium** (é como `captureNativeBundle` lança hoje:
   `chromium.launch({ headless: true })`, sem `proxy`):
   `net::ERR_CONNECTION_RESET` para `https://example.com`.
2. **Com `proxy: { server: 'http://127.0.0.1:42945' }`**: mesmo
   `net::ERR_CONNECTION_RESET`.
3. **HTTP simples pelo proxy** funciona e chega no proxy — resposta `405` e o
   endpoint `/__agentproxy/status` registra
   `{"kind":"not_connect","detail":"non-CONNECT request: GET http://example.com"}`.
   Ou seja, o Chromium fala com o proxy.
4. **O túnel CONNECT é aceito** e o reset vem depois, no handshake TLS. Bytes
   observados num relay local que só encaminha para 42945:
   ```
   CLIENT->PROXY: "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Connection: keep-alive\r\nUser-Agent: Mozilla/5.0 (X11; Lin..."
   PROXY->CLIENT: "HTTP/1.1 200 Connection Established\r\n\r\n"
   up err ECONNRESET
   ```
   O netlog do Chromium para o mesmo caso: `SOCKET_READ_ERROR net_error=-101,
   os_error=104` logo após `SSL_HANDSHAKE_MESSAGE_SENT`.
5. **curl pelo MESMO relay/túnel funciona**: `curl -x http://127.0.0.1:42999
   https://example.com` → `200`. Um cliente TLS em node pelo mesmo túnel também
   completa o handshake (`TLSv1.3`).
6. **`https://github.com` pelo proxy chega mais longe e falha por certificado**:
   `net::ERR_CERT_AUTHORITY_INVALID` — o banco NSS do Chromium
   (`/root/.pki/nssdb`) foi criado vazio pelo próprio Chromium neste run
   (timestamps 03:53) e não contém a CA `/root/.ccr/ca-bundle.crt`;
   `certutil` não está instalado na imagem.

Combinações de flags testadas contra `https://example.com`, TODAS com o mesmo
`ERR_CONNECTION_RESET`: `--ssl-version-max=tls1.2`, `--ssl-version-min=tls1.3`,
`--disable-http2`, `--disable-features=EncryptedClientHello`,
`--disable-features=X25519MLKEM768,PostQuantumKyber`,
`--disable-features=UseMLKEM,PostQuantumKyber,EncryptedClientHello`,
`--disable-features=TLS13EarlyData,GreaseTLS`.

O que isso diz, sem passar disso: **o handshake TLS do Chromium é derrubado pelo
egresso desta sessão, enquanto curl e node passam pelo mesmo túnel.** A causa
exata não foi isolada (a investigação por replay de handshake foi interrompida).

## O que falta para produzir os números pedidos

Um ambiente em que o Chromium do Playwright consiga completar TLS até
`https://www.farmminerals.com/promo` — máquina local do Adilson, ou uma sessão
com egresso que aceite o handshake do navegador e com a CA do proxy no banco
NSS. O script e o comando não precisam mudar.
