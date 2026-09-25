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

---

## Adendo — segunda sessão, mesma data: três correções de alcance

A outra sessão mediu de novo com o Chromium do Playwright e concluiu o
oposto ("a origem opaca cacheia"). Reproduzi com um braço de controle que
faltava nas duas provas anteriores, e a divergência se resolveu. Ambas as
sessões convergiram e retiraram o que estava errado.

**1. O braço que faltava: o particionamento está sequer LIGADO?** Os
controles anteriores provavam "a prova detecta cache"; nenhum provava que o
particionamento — a coisa sob teste — estava ativo. Braço novo: o MESMO
asset, servido pela MESMA origem de frame, pedido a partir de dois
documentos de topo de sites diferentes. Se o segundo topo não pede, o cache
atravessou topos e o particionamento está desligado.

| binário | controle de partição | braço opaco |
|---|---|---|
| Chromium do Playwright | **DESLIGADO** | "cacheia" (artefato) |
| Chrome de marca, defaults | LIGADO | re-baixa |

Ou seja: o Chromium do Playwright não serve para medir esta pergunta, e o
resultado dele não transfere para o navegador do usuário.

**2. Não é revalidação barata — é corpo inteiro.** Contar pedidos ao servidor
não mede bytes: com ETag, um re-pedido poderia terminar em `304` e reusar o
corpo guardado. As provas anteriores não podiam ver isso porque o servidor
delas sempre devolvia `200` completo. Com o servidor honrando
`If-None-Match`, o segundo pedido do braço opaco chega **sem cabeçalho
condicional, `200`, corpo inteiro** (264KB de 264KB aqui; 269.884 de 269.884
na reprodução independente da outra sessão). A entrada de cache não está só
separada — está inalcançável, então nem revalidação acontece. A conta por
reload é de bytes cheios.

**3. Topologia mais forte que a da primeira rodada.** Esta corrida usou
domínios registráveis distintos de verdade (`localtest.me`, `lvh.me`,
`nip.io`, todos resolvendo para loopback), **sem `--host-resolver-rules`** —
o que retira tanto a ressalva de loopback registrada na conclusão acima
quanto a de "TLD desconhecido pode não formar site distinto". Cada abertura
assevera positivamente a decodificação da imagem (`naturalWidth`), então
"0 pedidos" significa servido do cache, e não "não chegou a pedir".

Resultado final, Chrome de marca, browser fechado e reaberto no mesmo perfil:

| braço | 1ª abertura | 2ª abertura | decodificou | veredito |
|---|---|---|---|---|
| sem iframe (linha de base) | 200, 264KB | 0 pedidos | 1600/1600 | cacheou |
| iframe cross-site, sem sandbox | 200, 264KB | 0 pedidos | 1600/1600 | cacheou |
| **iframe OPACO (o produto hoje)** | 200, 264KB | **200, 264KB** | 1600/1600 | **re-baixa inteiro** |
| controle `no-store` | 200, 264KB | 200, 264KB | 1600/1600 | re-baixa (correto) |
| controle de partição (outro topo) | 200, 264KB | 0 pedidos | 1600/1600 | partição LIGADA |

Numa segunda corrida, mesma sessão e sem fechar o navegador, o braço opaco
re-baixa em **todo reload** (`reload1` e `reload2`), enquanto o não-opaco não
pede nada. O custo é por reload, não por sessão.

**4. Ressalva causal — o que NÃO está isolado.** O braço de partição prova
que os dois binários diferem em reúso de cache entre topos, e que no Chrome
real o opaco re-baixa. Ele **não** identifica causalmente o mecanismo (uma
chave por nonce de origem opaca): para isso seria preciso alternar a flag
ligada/desligada dentro do MESMO binário e versão. Frases do tipo "porque o
particionamento vem desligado" são inferência, não medida. A decisão de
produto não depende disso; a redação do mecanismo depende.

**5. Alcance: Chrome. Safari e Firefox seguem ABERTOS** — e o motivo é a
parte instrutiva, porque os que falharam foram os instrumentos, não os
navegadores:
- **WebKit do Playwright (26.4)**: controle de partição deu DESLIGADO — o
  mesmo defeito do Chromium do Playwright. O braço opaco "cacheou", e é o
  mesmo artefato. Além disso, playwright-webkit não é o Safari que roda na
  máquina do usuário.
- **Firefox do Playwright (150.0.2)**: a LINHA DE BASE re-baixou, ou seja, o
  contexto persistente não guarda cache em disco entre execuções. O
  instrumento é cego; nada do que ele disse sobre o braço opaco vale.
- Safari de verdade exige `safaridriver --enable` (passo de administrador),
  não executado.

Provas: `prova-particao.mjs`, `prova-bytes.mjs`, `prova-3nav.mjs`,
`prova-final.mjs` (scratchpad da sessão). Revisão adversarial do Codex sobre
o desenho da prova produziu os itens 2, 4 e o controle positivo de perfil
frio; os dois primeiros foram verificados rodando, não aceitos por
argumento.
