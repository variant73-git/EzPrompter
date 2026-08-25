# Medido: origem opaca re-baixa TUDO a cada reload — no Chrome real do dono

**Pergunta** (disputa entre sessões sobre custo/preço do clone): o cache HTTP
sobrevive dentro do iframe sandbox de origem opaca que serve o clone?

**Método** (`_prova-cache-opaco.mjs`): servidor local com contador por caminho
(0 pedidos novos = veio do cache); asset com `private, max-age=14400,
immutable` + ETag; perfil persistido (fechar e reabrir o navegador = "voltar
amanhã"); **Chrome de marca instalado, defaults de fábrica, versão
151.0.7922.174** — depois que o controle pegou o Chromium do Playwright com
particionamento DESLIGADO (field trials off), invalidando a primeira rodada.

**Braços** — diferem em exatamente um atributo (`allow-same-origin` presente
ou não no sandbox; mesmo frame, mesmo servidor, mesmos cabeçalhos):

| braço | carga | reload | volta amanhã |
|---|---|---|---|
| OPACO (o produto hoje) | 1 | **+1 re-baixa** | **+1 re-baixa** |
| ORIGEM PRÓPRIA (desenho B) | 1 | +0 cache ✓ | +0 cache ✓ |
| controle `no-store` | 1 | +1 ✓ instrumento vê | +1 ✓ |
| controle particionamento (2 topos) | 1 | +1 ✓ ativo | — |

**Conclusão, no alcance exato:** neste Chrome e nesta topologia — que
reproduz a relação cross-site exigida em produção (localhost ≠ 127.0.0.1;
loopback tem tratamento especial e a equivalência integral com os domínios
reais não foi demonstrada) — o recurso do frame de origem **opaca é
re-baixado em todo reload e após reabrir o navegador**; o de origem própria é
reutilizado nos dois casos.

**O que isso decide:**
1. A alegação do Sol da outra sessão **confirma** — e é PIOR que o documento
   corrigido deles: o custo de transferência do produto de hoje é **por
   reload**, não por sessão; o ponto de equilíbrio "482 sessões" ainda era
   otimista.
2. **B (origem própria não-opaca, hostname isolado) é pré-requisito
   econômico.** O desenho A (banco público passivo) só paga em cima de B.
   "Desacoplar o token" sozinho não consertaria nem o cache.
3. Retiro afirmações minhas anteriores de "o navegador guarda dentro da
   sessão": mediam um Chromium **sem particionamento**. E a primeira rodada
   desta prova deu +0 no opaco — o **controle** é que pegou o instrumento.
   Zero sem controle, de novo.

**Pendências na fila do monitor do Neon:** os 33MB reais na topologia viva, e
a repetição nos hosts efetivos de produção.
