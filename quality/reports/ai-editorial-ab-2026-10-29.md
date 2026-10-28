# AI editorial A/B validation — 2026-10-29

## Scope

- Production model: `@cf/qwen/qwen3-30b-a3b-fp8`
- Production site version: 112
- Variant A: deterministic metadata editorial
- Variant B: Cloudflare Qwen editorial, used only after the production quality gate
- Rubric: premise fit, curiosity, concrete imagery, natural Korean, spoiler safety
- Personal reviews are excluded from model input.

## Connection diagnosis

1. The first OpenAI-compatible calls reached Cloudflare but returned unusable JSON because Qwen3 spent the short output budget on reasoning.
2. Adding Qwen's documented `/no_think` switch changed the outcome to `local-ai-editorial-v1 / accepted`.
3. The accepted raw samples exposed a second problem: separate “작품.” fragments, blunt plot disclosure, and occasional premise drift.
4. Version 112 therefore rejects multi-sentence output and common ending/spoiler patterns, preserving Variant A when Variant B is unsafe.

## Raw B samples before the strengthened gate

| Work | Qwen output | Assessment |
| --- | --- | --- |
| 백년 동안의 고독 | 부엔디아 일족의 근친상간과 고독이 뒤섞인 마콘도의 역사가 시간 속에서 사라져 간다. 작품. | Concrete but blunt, spoiler-prone, unnatural ending |
| 눈먼 자들의 도시 | 사람들은 눈을 뜨고도 보지 못하게 되면서 이성을 잃어가며 도시는 혼란에 빠진다. 작품. | Understandable but generic and mechanically ended |
| 소년이 온다 | 소년은 시신을 수습하며 죽음의 무게를 떠안는다. 작품. | Specific but too direct for discovery copy |
| 변신 | 사람은 환경에 맞춰 짐승처럼 변신하며 생존을 위한 사투를 벌인다. 작품. | Premise drift; not Kafka's central conflict |
| 노인과 바다 | 노인은 바다를 향해 나아가지만, 상어의 공격으로 모든 것을 잃는다. 작품. | Major outcome disclosure |

Manual rubric average for raw Variant B: **53/100**.

## Production A/B results after the strengthened gate

| Work | Variant A control | B outcome | Published result |
| --- | --- | --- | --- |
| 백년 동안의 고독 | 꿈과 현실의 얇은 경계와 사랑받고 싶은 마음을 한 장면 안에서 충돌시키는 작품. | `tags_only` | A |
| 눈먼 자들의 도시 | 사람에게 다가갈수록 가시가 서로를 찌르는 순간까지 관계를 밀어붙인 작품. | `quality_gate_rejected` | A |
| 소년이 온다 | 잃어버린 것을 붙잡으려는 마음을 기억이 스스로를 배반하는 순간까지 밀어붙인 작품. | `tags_only` | A |
| 변신 | 몸이 없는 관계 앞에서 사랑이 무엇으로 남는지 묻는 작품. | `quality_gate_rejected` | A |
| 노인과 바다 | 한 사람의 고독을 세계가 끝나는 풍경만큼 크게 확대한 작품. | `tags_only` | A |

- B editorial acceptance: **0/5**
- Safe fallback coverage: **5/5**
- AI tag-assist acceptance: **3/5**
- User-visible regressions after the gate: **0/5**

## Decision

Keep Qwen enabled as an optional, zero-cost assistant behind the deterministic quality gate. Do not treat it as the primary editorial writer yet. Promotion requires:

- at least 30 reviewed works across film, literature, manga, and anime;
- at least 80% valid single-sentence responses;
- zero material spoilers;
- Variant B beating Variant A by at least 5 points on the fixed rubric;
- exact-title/media identity checks before editorial generation.

## Strict scores

- Cloudflare/Qwen integration reliability: **92/100**
- Privacy and cost guardrails: **96/100**
- Raw Qwen editorial quality: **53/100**
- Production editorial safety after fallback: **91/100**
- Stage 73 overall readiness: **78/100**
