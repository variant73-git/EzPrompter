# SALVAR-pack — sessões remotas 2026-08-20/21 (skill Meng → telemetria → harness)

> Este arquivo existe porque a sessão foi REMOTA: o vault Brain e a pasta de
> memória vivem na máquina do Adilson. O ritual local copia daqui. O CLAUDE.md
> já foi atualizado NESTA branch (item 184 + 2 lições permanentes).

## 1) Memo → `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/checkpoint_2026-08-21_telemetria-harness.md`

Conteúdo sugerido: o item 184 do CLAUDE.md expandido com: números do experimento
(74 frames/72s; builder cego 991 linhas/142k tokens/24min; pares em
`_teste-skill-video/comparison/`), harness table (capture=0-LLM;
motion-controls=terra; iter9+extract.clone+failover=gpt-5.5↔opus-4-7;
compose=picker+auto-gpt-5.5), conta do Terra (input-heavy → −43%), pesquisa
legal (fontes no transcript/artifact), e a fila local (merge → pill DEV → Sol →
A/B → roteamento).

## 2) Nota de sessão → vault `Uncraft/Sessões/2026-08-21 — Telemetria por clone e harness switch.md`

```markdown
# 2026-08-21 — Telemetria por clone e harness switch
Sessão remota (claude.ai/code). Origem: skill [[video-to-superprompt]] do MengTo.
- Experimento: clone por vídeo (protocolo cego) vs [[Clone native]] — estrutura/copy/motion atravessam, identidade não; skill manual ~3-8min; vídeo serve pra VERIFY de movimento/preview/fallback, não pro motor.
- Telemetria: todo clone grava tempo por etapa + custo US$ no meta ([[Widget DEV]]); wall-clock do usuário no cliente; billing expõe µ¢.
- Harness: [[Pricing]] — baseline gpt-5.5 × terra ($2/$12, −43% projetado); Kimi K2.6/Qwen como candidatos via host ocidental ([[Legal — modelos chineses]]).
- Decisões em aberto: default Terra (após A/B), 3º harness, vídeo-como-fonte.
Ligações: [[🏠 Uncraft Home]], [[Estratégia/Pricing]], checkpoint 184.
```

## 3) Findings → `Findings/🔍 Findings — quando a ideia do Adilson venceu.md`

**F-2026-08-20a — "Eu fiz manual em minutos"**
Contexto: relatório do experimento apresentou "a skill leva 35min".
Proposta do agente: 35min como número da skill. Contra-ideia: a experiência
manual dele (vídeo+prompt) era muito mais rápida. Por que venceu: 24 dos 35min
eram o builder-agente isolado do MEU protocolo anti-contaminação.
Princípio: custo do método ≠ custo do protocolo que o mede; reportar separado.

**F-2026-08-20b — "Nosso clone não demora só isso / custa zero?"**
Contexto: comparação citava "24s, ~US$0, SSIM 0,987".
Proposta do agente: números do native como "o clone". Contra-ideia: a vivência
dele no produto é minutos e pago. Por que venceu: 22-24s é o MOTOR isolado;
zero-IA só no capture-bundle (motion-controls usa Terra; iter9/estático pagam).
Princípio: capacidade de motor ≠ experiência do usuário; telemetria por caminho.

**F-2026-08-20c — "O widget dev existe sim"**
Contexto: afirmei "não existe widget dev" após varredura exaustiva.
Proposta do agente: não existe → criei um novo. Contra-ideia: existe, com foto.
Por que venceu (parcial): existia NA MÁQUINA — o espelho GitHub está atrás dos
branches codex/*. Princípio: ausência no espelho ≠ ausência no produto;
conferir divergência local×remoto antes de qualquer "não existe".

**F-2026-08-21d — "Não era sobre o clone do Meng"**
Contexto: perguntado "o que encurtar", respondi otimizando o funil DA SKILL.
Contra-ideia: a pergunta era o que da skill serve PRO NATIVE.
Por que venceu: reancorou a análise no produto (verify de movimento, preview,
fallback — não substituição de motor). Princípio: otimização se ancora no
caminho do PRODUTO, não no objeto em análise.

## 4) Vault housekeeping
- Atualizar [[🏠 Uncraft Home]] (frente nova: telemetria/harness; A/B pendente)
- `git -C ~/Desktop/IA/Brain add -A && git commit -m "salvar 2026-08-21"`
