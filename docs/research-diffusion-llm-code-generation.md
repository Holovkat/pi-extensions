# Diffusion LLMs: Architecture Analysis & Application to Multi-Agent Code Generation

**Date:** 2026-03-04  
**Purpose:** Technical reference for designing a diffusion-inspired multi-pass code generation pipeline.

---

## 1. Piecemeal Tokenization: How Diffusion LLMs Generate Tokens vs. Autoregressive Models

### Autoregressive (AR) Baseline
Traditional LLMs (GPT, LLaMA, Claude) generate tokens **left-to-right, one at a time**. Each token is sampled from a conditional probability distribution `P(x_t | x_1, ..., x_{t-1})`. This is serial by nature — token `t` cannot be computed until token `t-1` is finalized.

### Diffusion LLM Approach
Diffusion LLMs operate on the **entire sequence simultaneously**. The core mechanism varies by model family:

| Model | Mechanism | Key Innovation |
|-------|-----------|----------------|
| **MDLM** (Sahoo et al., NeurIPS 2024) | Masked diffusion. Starts with all tokens `[MASK]`. Iteratively unmasks tokens over `T` steps using a weighted mixture of masked cross-entropy losses. | Rao-Blackwellized variational objective; semi-autoregressive sampling at arbitrary lengths. |
| **SEDD** (Lou et al., ICML 2024 Best Paper) | Score entropy discrete diffusion. Estimates **ratios of the data distribution** rather than predicting tokens directly. Parameterizes the reverse diffusion via a score function over discrete tokens. | Novel "score entropy" loss for discrete spaces; 25-75% perplexity reduction over prior diffusion LMs; 16× fewer function evaluations than AR for matched quality. |
| **LLaDA** (Nie et al., NeurIPS 2025) | Forward masking + reverse denoising via Transformer. Each token masked independently with probability proportional to diffusion timestep `t`. | Scaled to 8B params; competitive with LLaMA3 8B; addresses the "reversal curse" (beats GPT-4o on reverse poem completion). |
| **LLaDA 2.0** (2025) | Converts pre-trained AR models to diffusion via 3-phase block-level training. | Scales to 100B params; inherits AR model knowledge; parallel decoding. |
| **Mercury/Plaid** (Inception Labs, 2025-2026) | Proprietary diffusion architecture generating "blocks" in parallel. Production-deployed. | 1,000+ tokens/sec on Blackwell GPUs; 5-10× faster than AR models; 128K context window. |
| **DiffuCoder** (Apple, 2025) | 7B-param masked diffusion model for code. Trained on 130B code tokens. Coupled-GRPO RL fine-tuning. | +4.4% on EvalPlus over prior dLLMs; controls causality without semi-AR decoding; analyzes temperature-diversity trade-offs. |
| **Block Diffusion** (Arriola et al., ICLR 2025 Oral) | Interpolates between AR and diffusion via block-wise generation. Data-driven noise schedules. | Supports arbitrary-length generation with KV caching; state-of-the-art among diffusion LMs on language benchmarks. |

### Tokenization Differences
- **AR models** tokenize then consume tokens serially; each token's probability is conditioned only on **preceding** tokens.
- **Diffusion LLMs** tokenize the full sequence, then **corrupt it** (mask or noise all tokens), and iteratively recover the clean sequence. Each denoising step conditions on **bidirectional context** — both preceding and following tokens (even if still partially masked).
- **MDLM/LLaDA** use discrete masking: `x → [MASK]` with probability `β(t)`. The model predicts all masked tokens in parallel at each step.
- **SEDD** uses a continuous score over discrete states: the model learns log-ratios `log p(x_t = v) / p(x_t = v')` for each token position, enabling finer-grained updates than binary mask/unmask.

---

## 2. Parallel Denoising vs. Left-to-Right Generation: Architectural Differences

### AR Architecture (Serial)
```
Input:  [x_1, x_2, ..., x_{n-1}]
Output: P(x_n | x_1, ..., x_{n-1})
Decoding: n sequential forward passes for n tokens
Attention: Causal mask (each token attends only to its left)
```

### Diffusion Architecture (Parallel)
```
Input:  [m_1, m_2, ..., m_n] (corrupted/masked sequence)
Output: P(x_1, x_2, ..., x_n | m_1, ..., m_n) (all positions simultaneously)
Decoding: T denoising steps, each processes all n positions in parallel
Attention: Full bidirectional (each position attends to all others)
```

### Key Architectural Differences

**1. Attention Pattern**  
AR models use a **causal attention mask** — token at position `i` cannot attend to positions `> i`. Diffusion LLMs use **full bidirectional attention** — every position attends to every other position, including partially-revealed tokens. This is architecturally identical to BERT-style encoders, not GPT-style decoders.

**2. Computation Pattern**  
- AR: `O(n)` sequential forward passes, each generating 1 token. Hardware utilization is poor during inference because batch dimension = 1 per sequence.
- Diffusion: `O(T)` forward passes (typically `T = 32-256` steps), each generating/refining **all `n` tokens simultaneously**. Higher arithmetic intensity per forward pass → better GPU utilization.

**3. Conditioning**  
- AR: Each token is conditioned on a **growing prefix**. No future context.
- Diffusion: Each token is conditioned on **the entire sequence at its current noise level**. Partially-revealed tokens provide bidirectional signal. This enables global planning.

**4. Generation Order**  
- AR: Strict left-to-right.
- Diffusion: **Non-deterministic, content-adaptive order**. Tokens that the model is most confident about tend to be revealed first. DiffuCoder analysis shows that diffusion models naturally generate code in a non-linear order — e.g., function signatures before bodies, high-confidence tokens before ambiguous ones (JetBrains, 2025).

**5. Editability**  
- AR: No native mechanism to revise earlier tokens once generated (requires regeneration from that point).
- Diffusion: Tokens can be **re-masked and re-denoised** at any point. Progressive Token Evolution (EvoToken-DLM, Zhong et al.) maintains probabilistic soft states throughout, enabling revision until the final step.

---

## 3. Proven Benefits

### Speed
- **Mercury 2** (Inception Labs): 1,000+ tokens/sec, 5× faster than comparable AR models on NVIDIA Blackwell. Parallel token generation amortizes cost across positions.
- **SEDD**: Matches GPT-2 quality with **16× fewer network evaluations** via compute-quality trade-off curves.
- **D3PM benchmarks** (diva-portal.org thesis): Up to 3.97 batches/sec vs. slower AR baselines, demonstrating higher throughput in batch settings.
- **IDLM** (Inverse-distilled DLMs): 64× reduction in inference steps via distillation while preserving entropy and perplexity.

### Coherence & Global Planning
- Bidirectional attention enables **global planning** — the model can "see" the entire context at every step, even partially masked.
- DiffuCoder demonstrates that diffusion models naturally skip ahead and revisit code sections, mirroring human coding patterns (JetBrains blog, Feb 2026).
- LLaDA beats GPT-4o on **reversal tasks** (e.g., completing a poem given its ending), which AR models structurally fail at.

### Revision & Controllability
- Native **infilling** capability: mask any arbitrary span and re-denoise. SEDD demonstrates flexible infilling strategies beyond left-to-right.
- **Reward-guided iterative refinement** (Guo et al., 2025): Cyclic noising→denoising with reward signals enables post-hoc quality improvement without retraining.
- **Temperature controls generation diversity AND order** in DiffuCoder: higher temperature → more diverse token choices AND more non-linear generation order.

### Parallel Generation
- Multiple tokens generated per forward pass vs. 1 token per pass in AR.
- **Arithmetic intensity** is higher, meaning better hardware utilization on modern GPUs/TPUs (arxiv 2510.04146).

---

## 4. Noise Schedules & Progressive Refinement → Code Generation

### How Noise Schedules Work in Text Diffusion

In image diffusion (DDPM), noise is Gaussian and follows a schedule `β_1, β_2, ..., β_T`. In **text diffusion**, noise = **masking**:

```
t=0:   "def calculate_sum(a, b): return a + b"     (clean)
t=0.3: "def [M] (a, b): [M] a + b"                 (30% masked)
t=0.6: "[M] [M] (a, [M]): [M] [M] + [M]"           (60% masked)
t=1.0: "[M] [M] [M] [M] [M] [M] [M] [M] [M]"       (fully masked)
```

The model learns the **reverse process**: given a corruption level `t`, predict clean tokens. At inference, start from `t=1.0` (all masked) and step down to `t=0` (all revealed).

### Noise Schedule Design

| Schedule | Description | Source |
|----------|-------------|--------|
| **Linear** | `β(t) = t`. Uniform masking rate. Simple but suboptimal. | MDLM baseline |
| **Cosine** | `β(t) = cos(πt/2)`. More gradual at extremes, more masking in middle steps. | Common default |
| **Data-driven** | Learned from training data to minimize gradient variance. Adapts to the structure of the domain. | Block Diffusion (ICLR 2025) |
| **Adaptive masking** | Per-token masking probability based on model confidence at each step. More confident positions unmask first. | MDM-Prime, EvoToken-DLM |

### Translation to Code Generation Pipeline

**Direct analogy — a multi-pass code generation pipeline:**

| Diffusion Concept | Code Generation Equivalent |
|---|---|
| `t=1.0` (full noise) | Empty scaffold / specification only |
| `t=0.7` (high noise) | Structural skeleton: module/class/function **signatures**, imports, type definitions |
| `t=0.4` (medium noise) | Core implementation: function bodies, main logic paths, data flow |
| `t=0.2` (low noise) | Edge cases, error handling, validation, docstrings |
| `t=0.0` (clean) | Production-ready code with formatting, comments, tests |

**Key insight:** The noise schedule determines **what gets refined when**. A data-driven schedule for code would naturally prioritize:
1. Structural elements first (low entropy — fewer valid options for function signatures given a spec)
2. Core logic second (medium entropy)
3. Edge cases and polish last (high entropy — many valid implementations)

This matches how experienced developers write code: skeleton first, then fill in.

---

## 5. Can Code Be Generated in a Diffusion-Like Way?

**Yes — this is already demonstrated.** Evidence:

### Existing Implementations

**DiffuCoder (Apple, 2025):**
- 7B-param masked diffusion model trained on 130B code tokens.
- Generates code through iterative denoising. Analysis shows:
  - Without any explicit ordering constraint, the model **naturally generates high-confidence structural tokens first** (keywords, brackets, common patterns) and fills in specifics later.
  - Temperature controls the degree of non-linearity: low temp → more left-to-right; high temp → more structure-first.
  - Outperforms prior dLLMs by 4.4% on EvalPlus with coupled-GRPO RL training.

**Mercury Coder (Inception Labs):**
- Production diffusion-based coding LLM. 1,000+ tokens/sec.
- Deployed at Fortune 500 companies for real-time coding assistance.
- 85-95% quality of AR models on complex reasoning, but excels at structured output generation.

**Code Repair via Diffusion (OpenReview):**
- Diffusion models as "continuous human noise operators" — inject noise into broken code, resume denoising → automated repair.
- Last-mile diffusion steps specifically handle edge-case repairs.

### Proposed Multi-Pass Architecture for Code Generation

A pipeline inspired by diffusion principles:

```
Pass 0 — Specification Ingestion
  Input: Natural language spec, API contracts, type definitions
  Output: Structured intent representation

Pass 1 — Structural Scaffolding (t=0.8→0.6)
  Agent: "Architect"
  Action: Generate module structure, class hierarchies, function signatures,
          import statements, type annotations
  Properties: Low entropy decisions. High confidence. Parallel across files.

Pass 2 — Core Implementation (t=0.6→0.3)
  Agent: "Implementer"  
  Action: Fill function bodies, implement core algorithms, wire data flow
  Input: Scaffold from Pass 1 + full bidirectional context
  Properties: Medium entropy. Can see ALL signatures (global context).

Pass 3 — Refinement & Edge Cases (t=0.3→0.1)
  Agent: "Hardener"
  Action: Add error handling, input validation, edge cases, logging
  Input: Implementation from Pass 2 + test specifications
  Properties: Higher entropy. Guided by test-case specifications.

Pass 4 — Polish & Verification (t=0.1→0.0)
  Agent: "Reviewer"
  Action: Fix style, add docstrings, optimize, verify consistency
  Input: Near-complete code + lint/type-check feedback
  Properties: Low entropy again. Deterministic corrections.
```

**Critical design principle from diffusion theory:** Each pass should have access to the **full context of all other files/modules at their current refinement level**. This is the bidirectional attention analog — the Implementer sees all function signatures across the codebase, not just the file it's working on.

### Advantages Over Single-Pass Generation

1. **Global coherence**: Pass 1 establishes a consistent interface contract across all modules before any implementation begins. AR models must guess at interfaces for files not yet generated.
2. **Parallelism**: Within each pass, independent modules can be generated in parallel (like parallel denoising across token positions).
3. **Revision**: If Pass 2 reveals that a signature from Pass 1 is insufficient, it can be re-scaffolded (re-masked and re-denoised) without regenerating everything.
4. **Quality-compute trade-off**: More passes = higher quality, fewer passes = faster. Mirrors the step-count trade-off in diffusion sampling.

---

## 6. Failure Modes and Limitations

### Fundamental Limitations of Diffusion LLMs

**1. Quality Gap on Complex Reasoning**  
Current dLLMs achieve 85-95% of AR model quality on complex tasks (Mercury benchmarks). The parallel denoising process struggles with **long chains of logical dependencies** where token `n` strictly depends on the exact value of token `n-k`. AR's serial nature is actually advantageous here — each step can attend to a finalized history.

**2. Local Generation Bias (arxiv 2503.03595)**  
Denoising networks tend to over-rely on **local correlations**, decomposing the global sequence into semi-independent local regions. This manifests as:
- Correct individual code blocks that don't compose well
- Variable naming inconsistencies across distant code sections
- Logic that's locally valid but globally contradictory

**3. Fixed-Length Context Constraint**  
Most diffusion LLMs operate on **fixed-length sequences** (typically 1024-4096 tokens). Generating a 50-file codebase requires block-wise or sliding-window strategies, introducing boundary artifacts. Block Diffusion (ICLR 2025) partially addresses this with KV caching for arbitrary-length generation.

**4. Hallucination via Multi-Step Error Accumulation (TraceDet, 2025)**  
Each denoising step can introduce or fail to correct errors. Unlike AR where a wrong token is immediately locked in (and visible), diffusion errors can **persist across steps as "soft hallucinations"** — tokens that are repeatedly predicted incorrectly because they're locally consistent. TraceDet found that analyzing the full denoising trace improves hallucination detection by 15.2% AUROC.

**5. Training Cost**  
Diffusion LLMs require learning a denoiser that works across all noise levels `t ∈ [0, 1]`. This is a harder learning problem than AR's next-token prediction. LLaDA 2.0 mitigates this by converting pre-trained AR models rather than training from scratch.

**6. Inference Latency vs. Throughput Trade-off**  
While throughput (tokens/sec for large batches) is higher, **single-sequence latency** can be worse than AR for short sequences because diffusion requires `T` full forward passes even for 10 tokens. The break-even point depends on sequence length and hardware.

### Failure Modes Specific to Multi-Pass Code Generation

**1. Pass Boundary Incoherence**  
If passes are too decoupled, later passes may make assumptions that conflict with earlier ones. Mitigation: each pass must receive the **full output of all previous passes** as context, not just the section being refined.

**2. Over-Refinement / Oscillation**  
Analogous to diffusion models that cycle between states in late denoising steps. A "hardening" pass might add error handling that breaks the core logic, triggering a revision that removes the error handling, etc. Mitigation: monotonically increasing "confidence thresholds" — later passes can only modify tokens below a confidence threshold.

**3. Scaffolding Lock-in**  
If Pass 1 (structure) makes a poor architectural decision, all subsequent passes are constrained by it. Unlike true diffusion where any token can be re-masked, a pipeline with discrete passes may not efficiently backtrack. Mitigation: allow limited "re-scaffolding" triggers when a later pass detects structural insufficiency.

**4. Inter-Module Dependency Blindness**  
Parallel generation of independent modules in Pass 2 may miss cross-module dependencies that only emerge during implementation. Mitigation: a "dependency resolution" sub-step between passes that identifies and resolves cross-module contracts.

---

## Key References

| Citation | Relevance |
|----------|-----------|
| Sahoo et al., "Simple and Effective Masked Diffusion Language Models" (NeurIPS 2024) | MDLM architecture, training objective, semi-AR sampling |
| Lou et al., "Discrete Diffusion Modeling by Estimating the Ratios of the Data Distribution" (ICML 2024, Best Paper) | SEDD, score entropy loss, compute-quality trade-offs |
| Nie et al., "Large Language Diffusion Models" (NeurIPS 2025) | LLaDA 8B, masking-based diffusion, reversal curse resolution |
| LLaDA 2.0 (arXiv 2512.15745) | Scaling to 100B via AR→diffusion conversion |
| Arriola et al., "Block Diffusion" (ICLR 2025, Oral) | AR-diffusion interpolation, data-driven noise schedules |
| Apple, "DiffuCoder" (arXiv 2506.20639) | 7B code diffusion model, coupled-GRPO, generation order analysis |
| Inception Labs, Mercury 2 (2026) | Production dLLM, 1000+ tok/sec, enterprise deployment |
| Zhong et al., "EvoToken-DLM" (arXiv 2601.07351) | Progressive soft token evolution, revisable decoding |
| Chen et al., "MDM-Prime" (arXiv 2505.18495) | Partial masking intermediate states, efficiency gains |
| "Code diffusion models are continuous human noise operators" (OpenReview) | Diffusion for code repair, last-mile refinement |
| "TraceDet" (OpenReview) | Hallucination detection via denoising trace analysis |
| "From Parallel Decoding to Diffusion Language Models" (arXiv 2508.08712) | Comprehensive survey of parallel text generation |
| "IDLM: Inverse-distilled Diffusion Language Models" (arXiv 2602.19066) | 64× step reduction via inverse distillation |
| DDPD (arXiv 2410.06264) | Planned denoising — separate planner + denoiser architecture |
