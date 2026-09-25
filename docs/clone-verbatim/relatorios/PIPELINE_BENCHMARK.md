# Benchmark de custo do pipeline de clone

Gerado em 2026-07-17T15:23:31.324Z. Preços de referência: 2026-07-17.

Este relatório estima custo de tokens, não custo de navegador, armazenamento, banda, cache, ferramentas ou engenharia humana. A qualidade e a taxa de aprovação são hipóteses calibráveis, não garantias do provedor.

## Premissas

- Piso de qualidade: **0.60**.
- Captura e inventário: 140,000 tokens de entrada + 14,000 de saída por tentativa.
- Implementação: 95,000 tokens de entrada + 35,000 de saída por tentativa.
- QA visual e polimento: 115,000 tokens de entrada + 20,000 de saída por tentativa.
- Custo esperado = custo por tentativa × tentativas esperadas, limitado pelo máximo de cada etapa.

## Resultado

- Combinações avaliadas: **420**.
- Menor custo absoluto: **kimi-k2.7-code + kimi-k3 + kimi-k3**, $0.33, qualidade 0.860.
- Melhor custo x benefício acima do piso: **kimi-k2.7-code + kimi-k3 + kimi-k3**, $0.33, qualidade 0.860.
- Maior robustez entre os modelos avaliados: **gpt-5.6-sol + gpt-5.6-sol + claude-opus-4.8**, $4.06, qualidade 0.945.

## Sensibilidade ao piso de qualidade

| Piso | Combinação mais barata | Custo esperado | Qualidade |
|---:|---|---:|---:|
| 0.86 | kimi-k2.7-code + kimi-k3 + kimi-k3 | $0.33 | 0.860 |
| 0.90 | kimi-k2.7-code + grok-4.5 + claude-sonnet-5 | $1.00 | 0.900 |
| 0.92 | kimi-k2.7-code + claude-sonnet-5 + claude-opus-4.8 | $1.80 | 0.920 |

### Combinação recomendada

- Captura e inventário: kimi-k2.7-code ($0.05 esperado; 82% de primeira aprovação)
- Implementação: kimi-k3 ($0.16 esperado; 81% de primeira aprovação)
- QA visual e polimento: kimi-k3 ($0.12 esperado; 78% de primeira aprovação)

## Top 10 por custo esperado com o piso de qualidade

| # | Combinação | Custo esperado | Qualidade | Aprovação sem retry |
|---:|---|---:|---:|---:|
| 1 | kimi-k2.7-code + kimi-k3 + kimi-k3 | $0.33 | 0.860 | 51.8% |
| 2 | qwen3.7-plus + kimi-k3 + kimi-k3 | $0.36 | 0.852 | 49.9% |
| 3 | kimi-k3 + kimi-k3 + kimi-k3 | $0.39 | 0.865 | 53.1% |
| 4 | deepseek-r1 + kimi-k3 + kimi-k3 | $0.42 | 0.855 | 50.5% |
| 5 | kimi-k2.7-code + gpt-5.6-luna + kimi-k3 | $0.56 | 0.845 | 49.9% |
| 6 | claude-haiku-4.5 + kimi-k3 + kimi-k3 | $0.56 | 0.845 | 48.0% |
| 7 | qwen3.7-plus + gpt-5.6-luna + kimi-k3 | $0.59 | 0.837 | 48.1% |
| 8 | gpt-5.6-luna + kimi-k3 + kimi-k3 | $0.59 | 0.840 | 46.8% |
| 9 | kimi-k3 + gpt-5.6-luna + kimi-k3 | $0.61 | 0.850 | 51.1% |
| 10 | kimi-k2.7-code + kimi-k3 + grok-4.5 | $0.63 | 0.873 | 56.5% |

## Como calibrar

1. Rode uma amostra real de 5 a 10 páginas e registre tokens de entrada/saída por etapa.
2. Marque cada etapa como aprovada ou retrabalhada usando o mesmo checklist visual/offline deste projeto.
3. Atualize `benchmark/models.json` com preços e taxas observadas; execute `npm run benchmark:pipeline` novamente.

## Fontes de preço

- openai: https://developers.openai.com/api/docs/pricing
- anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
- xai: https://docs.x.ai/developers/pricing
- kimi: https://platform.kimi.ai/docs/pricing/chat-k27-code
- deepseek: https://api-docs.deepseek.com/quick_start/pricing/
- qwen: https://help.aliyun.com/zh/model-studio/model-pricing
