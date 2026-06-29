---
type: Decision
title: Diffusion Research Basis
description: Research context behind the pipeline design — diffusion LLM principles (parallel denoising, progressive refinement, bidirectional context) applied to multi-pass code generation.
resource: ./docs/research-diffusion-llm-code-generation.md
tags: [pi-extensions, decision, research, diffusion, llm, multi-pass, code-generation, architecture]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Diffusion Research Basis

## Context

The 3-Wave pipeline architecture was informed by research into diffusion LLMs and their application to multi-pass code generation.

## Diffusion Analogy to Code Generation

| Diffusion Concept | Code Generation Equivalent |
|---|---|
| t=1.0 (full noise) | Empty scaffold / specification only |
| t=0.7 (high noise) | Structural skeleton: signatures, imports, types |
| t=0.4 (medium noise) | Core implementation: function bodies, logic |
| t=0.2 (low noise) | Edge cases, error handling, validation |
| t=0.0 (clean) | Production-ready code with formatting, tests |

## Key Principles Adopted

1. **Progressive refinement** — each pass refines from a coarser to finer state (spec -> scaffold -> implementation -> edge cases -> polish)
2. **Bidirectional context** — each pass has access to the full context of all other files at their current refinement level (the Implementer sees all signatures, not just the file it's working on)
3. **Revisability** — if a later pass reveals structural insufficiency, earlier passes can be re-run (re-scaffolding) without regenerating everything
4. **Quality-compute trade-off** — more passes = higher quality, fewer passes = faster (mirrors step-count trade-off in diffusion sampling)

## 3-Wave Mapping

- **Wave 1 (Council)** = Pass 0 (Specification Ingestion) + Pass 1 (Structural Scaffolding)
- **Wave 0 (Prototype)** = Pass 2 (Core Implementation)
- **Wave 1 (Review + TODOs)** = Pass 3 (Refinement)
- **Wave 2 (Dev Sprint)** = Pass 4 (Polish & Verification) with compliance scoring

## Failure Modes Noted

- **Pass boundary incoherence** — mitigated by each pass receiving full output of all previous passes
- **Scaffolding lock-in** — mitigated by allowing re-scaffolding triggers when structural insufficiency is detected
- **Over-refinement/oscillation** — mitigated by monotonically increasing confidence thresholds

## Key References

MDLM (NeurIPS 2024), SEDD (ICML 2024 Best Paper), LLaDA (NeurIPS 2025), Block Diffusion (ICLR 2025), DiffuCoder (Apple 2025), Mercury 2 (Inception Labs).

## Related Concepts

- [Three-Wave Architecture](../architecture/three-wave-architecture.md)
- [Fast Track vs Three-Wave](./fast-track-vs-three-wave.md)
- [System Architecture](../architecture/system-architecture.md)
