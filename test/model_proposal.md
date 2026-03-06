# Hybrid Relational Foundation Model: Architecture Design Proposal

## 1. Problem Formulation

### 1.1 Two-Dimensional Context Challenge

The core challenge in designing an RFM with in-context learning is that we must scale along **two orthogonal axes simultaneously**:

```
                        ┌─────────────────────────────────────┐
                        │          Episode Axis (C+Q)          │
                        │   support_1  support_2  ...  query   │
                 ┌──────┼──────────────────────────────────────┤
  Relational     │ hop0 │  [row]      [row]      ...  [row]   │
  Axis (L)       │ hop1 │  [row]      [row]      ...  [row]   │
  per entity     │ hop2 │  [row]      [row]      ...  [row]   │
                 │ ...  │   ...        ...       ...   ...    │
                 └──────┼──────────────────────────────────────┤
                        │  +label_1   +label_2   ...  +mask   │
                        └─────────────────────────────────────┘
```

- **Relational Axis (L)**: Each entity has L tokens from sampled relational neighbors (multi-hop, multi-table). Target: L ≥ 1024, ideally unlimited via RNN compression.
- **Episode Axis (C+Q)**: C support entities (with labels) + Q query entities (to predict). Target: C ≥ 10,000 for competitive ICL, Q ∈ [4, 64].

**Naive cost**: Full attention over L × (C+Q) tokens = O((L·(C+Q))²) — completely infeasible.

**Design principle** (inspired by Chronos-2): Factorize into two alternating attention axes, achieving O(L + C) memory scaling instead of O(L × C).

### 1.2 Analogy to Chronos-2

| Dimension | Chronos-2 | Our RFM |
|-----------|-----------|---------|
| Axis 1 | Time attention (patches within one series) | Relational attention (context tokens within one entity) |
| Axis 2 | Group attention (across variates at same patch) | Episode attention (across entities in support+query) |
| Axis 1 challenge | Long time series (T up to 8192) | Large relational neighborhoods (L ≥ 1024) |
| Axis 2 challenge | Many variates (V up to hundreds) | Large support set (C ≥ 10,000) |
| Information bridge | Shared patch index | **Probe tokens** (our key innovation) |
| Label injection | Not needed (zero-shot) | Required — support entities carry labels |

### 1.3 Alternative Approach: KumorFM (Dual-Level ICL)

KumorFM takes a different factorization strategy — rather than interleaving relational and episode attention within every layer, it performs ICL at two separate, sequential levels.

**Level 1 — Relational forward (schema-level ICL):** The task table is included in the relational schema as a first-class neighbor. During the relational encoding pass, the model attends over all context tokens (multi-hop neighbors, feature rows) *and* the task-table rows simultaneously. The task description thus acts as an in-context prompt inside the relational attention itself, giving the encoder task-specific bias before any cross-entity interaction occurs.

**Level 2 — Batch-level ICL (TabPFN-style head):** After relational encoding, each entity is compressed to a single summary embedding (e.g., via mean-pool or a learned readout token). These per-entity embeddings are fed into an ICL head whose architecture mirrors TabPFN: a shallow transformer that attends jointly over the full support set and the query, reading off support labels as in-context examples to produce the final prediction.

| Dimension | Our RFM (DART / Probe-token) | KumorFM |
|-----------|------------------------------|---------|
| ICL mechanism | Probe tokens bridge relational↔episode axes inside every layer | Two-stage: task-table in relational pass → TabPFN head on compressed embeddings |
| Relational encoding | Full L tokens flow through all N layers | L tokens compressed to 1 embedding per entity before ICL stage |
| Episode attention | Interleaved within each block (K probes attend across C+Q) | Single TabPFN-style pass over C+Q entity embeddings |
| Label injection | Label embedding added to probe tokens at input | Labels provided as in-context rows to the ICL head |
| Memory scaling | O(K·(C+Q)) per episode attention step | O(C+Q) for ICL head (after L is compressed away) |
| Flexibility | Entity representations evolve with episode context across layers | Relational encoding is episode-agnostic; ICL head handles episode context |
| Closest prior | Chronos-2 factorized attention | TabPFN + relational encoder |

**Key trade-off:** KumorFM's two-stage design decouples relational encoding from episode context, making the relational encoder cheaper and reusable across episodes. However, it sacrifices the deep integration of task context into relational representations — the entity embedding seen by the ICL head cannot adapt its relational attention to the current support set. Our probe-token approach pays a higher per-layer cost (K additional tokens in episode attention) but allows task-relevant neighbors to be weighted differently for each episode.

### 1.5 Key Notation

| Symbol | Meaning | Typical Range |
|--------|---------|---------------|
| L | Relational context length per entity | 512–4096 |
| C | Support set size (labeled entities) | 64–10,000+ |
| Q | Query set size (to predict) | 4–64 |
| M | Episodes per gradient step | 4–64 |
| K | Probe tokens per entity | 1–8 |
| D | Hidden dimension | 256–768 |
| N | Number of transformer blocks | 6–24 |
| d_head | Attention head dimension | 64–128 |

---

## 2. Architecture 1: Double-Axis Relational Transformer (DART)

### 2.1 Core Idea

Notes: For relational transformer, you can directly look at models/nn/orig_rt_pl.py

Directly modify the existing Relational Transformer (RT) to support double-axis attention, mirroring Chronos-2's time/group factorization. This is the most integrated design — ICL happens inside every layer, not as a separate stage.

### 2.2 Architecture

```
Input per entity i:
  context_tokens_i  ∈ R^{L × D}     # tokenized relational neighbors
  probe_tokens_i    ∈ R^{K × D}     # learnable + label/mask embedding
  
For support entities:  probe_i = Learned_Init + LabelEmb(y_i)
For query entities:    probe_i = Learned_Init + MaskEmb

═══════════════════════════════════════════════════
DART Block (repeat N times):
═══════════════════════════════════════════════════

  ┌─── Step 1: Relational Attention (per-entity, parallel across C+Q) ───┐
  │                                                                       │
  │  For each entity i:                                                   │
  │    tokens_i = concat(probe_i, context_i)          # [K+L, D]         │
  │    tokens_i = SelfAttention(tokens_i)             # Standard RT attn │
  │    probe_i, context_i = split(tokens_i, [K, L])                      │
  │                                                                       │
  │  RT's existing Relational Attention mechanism applies here:           │
  │  - Column-aware attention (cell tokens attend within/across columns)  │
  │  - Row-aware attention (cells within a row attend to each other)      │
  │  - FK-link attention (rows connected by foreign keys attend)          │
  │                                                                       │
  │  Cost: O(L²) per entity × (C+Q) entities (parallelized)             │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌─── Step 2: Episode Attention (across entities, per probe position) ───┐
  │                                                                       │
  │  Gather all probe tokens: P = stack(probe_i for all i) # [(C+Q)×K, D]│
  │                                                                       │
  │  Apply asymmetric attention mask:                                     │
  │    ┌──────────────┬──────────────┐                                    │
  │    │  S→S: bidir  │  S→Q: block  │   S = support probes              │
  │    ├──────────────┼──────────────┤   Q = query probes                 │
  │    │  Q→S: attend │  Q→Q: bidir  │                                    │
  │    └──────────────┴──────────────┘                                    │
  │                                                                       │
  │  P = MaskedSelfAttention(P, mask=episode_mask)    # [(C+Q)×K, D]     │
  │  Scatter back to per-entity probe_i                                   │
  │                                                                       │
  │  Cost: O((C+Q)² × K²) — need optimization for large C               │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌─── Step 3: FFN ──────────────────────────────────────────────────────┐
  │  Apply FFN to all tokens (probes + context)                          │
  └──────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════
Output: query probe tokens → Linear Head → prediction
═══════════════════════════════════════════════════
```

### 2.3 Modifications to Existing RT

| RT Component | Modification | Rationale |
|---|---|---|
| Tokenizer | Add K probe tokens per entity | Bridge between two axes |
| Relational Attention | Unchanged — probes participate as extra tokens | Probes absorb relational context |
| Position Encoding | Add learnable "probe position" encoding; no PE in episode axis | Episode axis is unordered (like Chronos-2) |
| Attention Mask | Add episode-axis mask (asymmetric S/Q) | Prevent label leakage from query to support |
| Output Head | Attach prediction head to query probe tokens only | Replaces RT's original masked-token head |

### 2.4 Scaling Episode Attention for Large C

Implement all following options, and design experiments to compare them 

When C > 2000, O((C+Q)²) is too expensive. Options:

**Option A: Perceiver Bottleneck in Episode Axis**
```
latent_tokens ∈ R^{B × D}                    # B = 256 learnable latents
latent = CrossAttn(Q=latent, K=probes, V=probes)   # O(B × (C+Q) × K)
probes = CrossAttn(Q=probes, K=latent, V=latent)   # O((C+Q) × K × B)
```
Total cost: O(B × C) instead of O(C²). With B=256, C=10000, this is a **40× reduction**.

**Option B: Linear Attention in Episode Axis**
```
probes_sorted = sort_by_label(probes)    # impose ordering for RNN
probes = BidirectionalGatedDeltaNet(probes_sorted)   # O(C)
```
Requires defining an ordering — can sort by label value (regression) or group by class (classification).

**Option C: Chunked Attention (for moderate C)**
```
chunks = split_into_chunks(probes, chunk_size=512)
# Full attention within chunks, cross-attention between chunk summaries
```

**Recommendation**: Option A (Perceiver) for C > 2000, standard FlashAttention for C ≤ 2000.

### 2.5 Pros / Cons

| Pros | Cons |
|------|------|
| Most integrated design — ICL from layer 1 | Largest engineering effort to modify RT |
| No cold-start problem (label signal at every layer) | Episode attention at every layer is expensive for large C |
| Clean gradient flow (no detached components) | Full attention on relational axis still O(L²) |
| Closest analog to Chronos-2 (proven at scale) | RT's existing codebase needs significant refactoring |

---

## 3. Architecture 2: Backbone + ICL Head (Two-Stage)

### 3.1 Core Idea

Note: `models/nn/orig_rt_pl.py` implements a baseline version — backbone pretrained on relational masked-cell prediction, entity embeddings fed into a frozen TabPFN head. The goal here is a **native ICL transformer**: a trainable ICL head that replaces TabPFN and is jointly fine-tuned with the backbone.

Keep the existing RT (or any relational backbone) as-is. It produces a fixed-size embedding per entity. A separate ICL Transformer head then processes the full episode (support + query) to produce predictions.

The engineering challenge is that this architecture faces a **two-dimensional memory explosion**:

```
Total tokens per step = M × (C + Q) × L

M = episodes per step,  C = support size,  Q = query set size,  L = seq_len per entity
```

At C=10,000, L=1,024, M=4, Q=16 this is ~41M tokens per step — impossible on any hardware. The following sub-sections address the L-axis and C-axis independently.

### 3.2 Architecture

```
═══════════════════════════════════════════════════
Stage 1: Backbone (Relational Transformer / GDN)
═══════════════════════════════════════════════════

  Shared context cache (computed once per database subgraph):
    row_cache = backbone.encode_rows(all_sampled_rows)    # [|unique_rows|, D]

  Per entity i — gather from cache, no re-encoding:
    context_i = gather(row_cache, neighbor_ids_i)         # [L, D]
    emb_i     = backbone.pool(context_i)                  # [1, D]  (CLS or mean)

  All embeddings: E = stack(emb_i)                        # [C+Q, D]

═══════════════════════════════════════════════════
Stage 2: ICL Head — Perceiver Bottleneck (default)
═══════════════════════════════════════════════════

  For support: tokens_i = emb_i + LabelEmb(y_i)          # [C, D]
  For query:   tokens_j = emb_j + MaskEmb                 # [Q, D]

  ┌─── Perceiver: latents cross-attend to support ─────────┐
  │  latents  ∈ R^{K × D}   (K = 256–512, learnable)       │
  │  latents  = CrossAttn(Q=latents, K=support, V=support) │  [K, D]
  │  cost: O(K × C)                                         │
  └─────────────────────────────────────────────────────────┘
                         │
                         ▼
  ┌─── Query cross-attends to latents ─────────────────────┐
  │  query_out = CrossAttn(Q=query, K=latents, V=latents)  │  [Q, D]
  │  cost: O(Q × K)                                         │
  └─────────────────────────────────────────────────────────┘
                         │
                         ▼
  prediction = Linear(query_out)                           # [Q, num_classes]

Total ICL head cost: O(K×C + Q×K)  vs. naive O(C² + Q×C)
At K=256, C=10000: ~40× memory reduction.
```

### 3.3 L-Axis Compression: Backbone Engineering

**Problem:** C+Q entities each with L=1,024 tokens — naively `(C+Q)×L` tokens through backbone per step.

**Solution 1 — Shared relational context caching:**
Entities in the same episode share relational neighbors (e.g., 10,000 users all reference the same popular item rows). Encode each unique row once and store in a cache; each entity gathers from the cache rather than re-encoding from raw tokens. This reduces backbone compute from `(C+Q)×L` to `|unique_rows|×L`, where unique rows ≪ (C+Q)×L.

**Solution 2 — RNN mode for support encoding:**
GatedDeltaNet (and any RNN backbone) supports two modes:
- **Parallel mode** (training): O(L×d) activation memory per entity — needed for gradient.
- **Recurrent mode** (inference): O(d²) memory — only the final hidden state is retained.

Support entities do not require full backprop through backbone (see §3.4). Encode all C support entities in **recurrent mode**: stream L tokens, keep only the final embedding, discard all intermediate activations. Memory per support entity drops from O(L×d) to O(d²) — a ~64× reduction at L=1,024, d=768.

### 3.4 Gradient Flow: Selective Backprop Through Support

Full backprop through C=10,000 support entities requires storing every backbone intermediate activation — infeasible. Solution: treat support gradient as a **stochastic estimator**.

```python
# 1. Encode ALL support entities without gradient (recurrent mode, O(d²) each)
with torch.no_grad():
    support_embs = backbone.rnn_mode(support_entities)       # [C, D], no grad stored

# 2. Pick a small random subset for true gradient flow (parallel mode)
grad_idx = random.sample(range(C), k=C_grad)                # C_grad = 64–256
support_embs_grad = backbone.parallel_mode(                  # stores activations
    support_entities[grad_idx])                              # [C_grad, D], with grad

# 3. Straight-through splice: splice gradient subset back into detached tensor
support_embs = support_embs_detached.clone()
support_embs[grad_idx] = support_embs_grad                   # gradient flows only here

# 4. ICL head sees the full support set; backprop flows to backbone via C_grad entities
prediction = icl_head(support_embs, labels, query_embs)
loss.backward()
```

This is **stochastic backprop through the support set**: the ICL head always observes all C entities (prediction quality unchanged), while backbone gradients are an unbiased estimate over random subsets — analogous to dropout.

Query entities always receive full gradient (parallel mode, Q is small).

### 3.5 C-Axis Options: ICL Head Variants

| Variant | Support attention | Cost | Best for |
|---------|-----------------|------|---------|
| **A. Perceiver bottleneck** (default) | K learnable latents cross-attend to C | O(K×C), K=256 | Any task, K is tunable |
| **B. Linear attention (GDN)** | GatedDeltaNet over shuffled support | O(C) | Very large C; requires random shuffle to break order bias |
| **C. Hierarchical prototypes** | Mean-pool per class → CrossAttn to prototypes | O(num_classes) | Classification only; loses fine-grained support structure |

**Recommended default: Variant A (Perceiver).** Variants B and C are ablation baselines.

For Variant B, the support set has no natural order — train with random shuffle and optionally bidirectional linear attention (forward + backward concatenated) to reduce order sensitivity.

### 3.6 Episode-Axis: Gradient Accumulation and Data Parallelism

M episodes per step can be decoupled entirely:

```python
optimizer.zero_grad()
for episode in sample_episodes(M):             # M = 32, serial
    loss = forward_one_episode(episode)        # only 1 episode in memory at a time
    (loss / M).backward()                      # gradient accumulates
optimizer.step()
```

With multiple GPUs, assign one episode per GPU (data parallelism over M), then all-reduce gradients. This eliminates the M factor from memory entirely.

### 3.7 Memory Budget (per episode, A100 80GB)

Target: D=768, K=256 latents, C=10,000, Q=16, L=1,024, C_grad=128, N=8 layers.

| Component | Memory | Notes |
|-----------|--------|-------|
| Backbone — support (no grad, RNN mode) | C × D × 4B ≈ 30 MB | Final embeddings only |
| Backbone — support gradient subset | C_grad × L × D × N × 4B ≈ 1.5 GB | Intermediate activations |
| Backbone — query (full grad, parallel) | Q × L × D × N × 4B ≈ 200 MB | |
| ICL head (Perceiver) | K × D + Q × D ≈ negligible | |
| Optimizer states (AdamW) | ~2× forward params | |
| **Total per episode** | **~4–5 GB** | Fits 4 episodes/GPU on A100 |

### 3.8 Warm-Start Options

**Option A: Pretext Task Warm-Start**
```
Phase 1 (warmup): Train backbone on masked cell prediction (RT's original objective)
Phase 2 (ICL):    Attach ICL head, train end-to-end with episode loss
```

**Option B: JUICE-Style Initialization**
```
Initialize backbone linear layers ≈ identity mapping (column-preserving)
Initialize cross-attention Q/K projections to approximate cosine similarity
Start with low learning rate, warm up gradually
```

**Option C: Progressive Context Growth**
```
Epoch 1–10:   C = 64    (small support, fast convergence)
Epoch 11–30:  C = 512   (medium support)
Epoch 31+:    C = 4096  (full support, with Perceiver head)
```

### 3.9 Pros / Cons

| Pros | Cons |
|------|------|
| Minimal modification to existing RT backbone | ICL only at final stage — no label signal during relational encoding |
| Backbone pretrained separately; head is plug-and-play | Cold-start collapse risk without warm-start |
| Perceiver head scales to C=10,000+ without quadratic cost | Support gradient is a stochastic estimator (unbiased but noisy) |
| Shared context cache amortizes redundant relational encoding | Backbone representations are episode-agnostic (unlike DART) |
| Easier to debug (two independent modules) | Requires RNN mode in backbone for memory efficiency |

---

## 4. Architecture 3: Pure Gated DeltaNet (Linear RFM)

### 4.1 Core Idea

use flash-linear attention lib, add to pixi

Replace all attention with Gated DeltaNet (linear RNN), making both axes O(L) and O(C). This is the most memory-efficient design, targeting scenarios where L and C are both very large.

### 4.2 Architecture

```
═══════════════════════════════════════════════════
Input Tokenization
═══════════════════════════════════════════════════

  Per entity i:
    relational_seq_i = tokenize_relational_context(entity_i)    # [L, D]
    # Ordered by: hop distance (near → far), then timestamp (recent → old)
    
═══════════════════════════════════════════════════
Layer Block (repeat N times):
═══════════════════════════════════════════════════

  ┌─── Step 1: Relational GatedDeltaNet (per entity) ─────────────────┐
  │                                                                     │
  │  For each entity i:                                                 │
  │    relational_seq_i = GatedDeltaNet(relational_seq_i)  # [L, D]    │
  │    probe_i = relational_seq_i[-K:]   # Last K tokens as probes     │
  │    # OR: probe_i = LearnableQuery cross-attend to hidden state     │
  │                                                                     │
  │  Cost: O(L × D²) per entity (linear in L)                         │
  │  Memory: O(D²) hidden state per entity (constant in L)            │
  └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌─── Step 2: Episode GatedDeltaNet (across entities) ────────────────┐
  │                                                                     │
  │  Construct episode sequence:                                        │
  │    episode_seq = [support_probe_1 + LabelEmb(y_1),                 │
  │                   support_probe_2 + LabelEmb(y_2),                 │
  │                   ...                                               │
  │                   query_probe_1 + MaskEmb,                         │
  │                   query_probe_2 + MaskEmb, ...]    # [(C+Q)×K, D]  │
  │                                                                     │
  │  Ordering strategy:                                                 │
  │    - Support entities: sorted by label value (regression)           │
  │      or grouped by class (classification)                           │
  │    - Query entities: appended at the end (causal: can see support)  │
  │                                                                     │
  │  episode_seq = CausalGatedDeltaNet(episode_seq)    # [(C+Q)×K, D]  │
  │                                                                     │
  │  Scatter back: query_probes = episode_seq[C*K:]                    │
  │                                                                     │
  │  Cost: O(C × K × D²) (linear in C)                                │
  └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌─── Step 3: GatedDeltaNet FFN ──────────────────────────────────────┐
  │  Standard SwiGLU FFN applied to all tokens                         │
  └────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════
Output: query probes → Linear Head → prediction
═══════════════════════════════════════════════════
```

### 4.3 Custom Kernel Considerations

The standard flash-linear-attention (FLA) library provides efficient GatedDeltaNet kernels. However, our use case has unique properties that may justify custom kernels:

**Scenario 1: Shared Context Kernel**

Multiple entities share overlapping relational context (e.g., 100 users who all interacted with the same 50 items). A custom kernel could:

```
# Standard: each entity processes its own L tokens independently
for entity in entities:
    hidden = gated_deltanet(entity.tokens)   # redundant computation

# Custom: process shared subgraph once, then per-entity residual
shared_hidden = gated_deltanet(shared_tokens)           # done once
for entity in entities:
    hidden = gated_deltanet_resume(entity.unique_tokens, 
                                   init_state=shared_hidden)  # much shorter
```

This requires a **"resume from checkpoint state"** kernel variant — process shared prefix once, then branch into per-entity suffixes. FLA's chunkwise algorithm naturally supports this by checkpointing the hidden state at chunk boundaries.

**Scenario 2: Bidirectional Episode Kernel**

The episode axis is inherently unordered (support set has no natural sequence). Standard causal GatedDeltaNet imposes an artificial ordering. Options:

```
# Option A: Bidirectional (two passes)
fwd = CausalGatedDeltaNet(episode_seq)          # forward pass
bwd = CausalGatedDeltaNet(reverse(episode_seq)) # backward pass  
out = Linear(concat(fwd, bwd))                  # merge

# Option B: Chunk-based bidirectional (custom kernel)
# Within each chunk: full bidirectional attention
# Across chunks: GatedDeltaNet propagation
# This is similar to the hybrid chunk attention in Kimi Linear
```

**Scenario 3: Label-Conditioned Gating**

Standard GatedDeltaNet computes gate values from the token itself. For the episode axis, we could condition the gate on the label:

```
# Standard: gate = sigmoid(W_g @ token)
# Custom:   gate = sigmoid(W_g @ token + W_l @ LabelEmb(y))
```

This allows the RNN to adaptively control how much to "remember" based on whether consecutive support examples share the same label — useful for class-conditional compression.

**Kernel Development Priority**:
1. **High**: Shared context / resume-from-state (biggest compute savings, moderate engineering)
2. **Medium**: Bidirectional episode (improves quality, chunk-based approach is clean)
3. **Low**: Label-conditioned gating (marginal quality gain, tricky to implement efficiently)

### 4.4 Pros / Cons

| Pros | Cons |
|------|------|
| O(L) relational + O(C) episode = maximal scalability | Pure linear RNN may underperform attention on recall tasks |
| Constant memory per entity (independent of L) | Episode axis ordering sensitivity |
| Supports incremental inference (append new rows) | Less theoretical understanding of RNN-based ICL |
| Simplest to train (no attention-specific tricks) | May need more layers/parameters to match attention quality |

---

## 5. Architecture 4: Hybrid GatedDeltaNet + Transformer

### 5.1 Core Idea

Use GatedDeltaNet for the "bulk" of each axis and Transformer attention for critical layers, following the 4:1 ratio recommended by the hybrid linear attention literature (Wang et al., 2025). Two sub-variants: layer-level interleaving and MoE routing.

### 5.2 Variant A: Layer-Level Interleaving (Jamba-Style)

number of layer seems too much, make this less

```
═══════════════════════════════════════════════════
Block layout for N=20 layers:
═══════════════════════════════════════════════════

Layer  Relational Axis          Episode Axis
─────  ─────────────────────    ──────────────────────
  1    GatedDeltaNet            GatedDeltaNet
  2    GatedDeltaNet            GatedDeltaNet
  3    GatedDeltaNet            GatedDeltaNet
  4    GatedDeltaNet            GatedDeltaNet
  5    ★ Full Attention         ★ Perceiver Attention    ← info bottleneck
  6    GatedDeltaNet            GatedDeltaNet
  7    GatedDeltaNet            GatedDeltaNet
  8    GatedDeltaNet            GatedDeltaNet
  9    GatedDeltaNet            GatedDeltaNet
 10    ★ Full Attention         ★ Perceiver Attention    ← mid-level fusion
 11    GatedDeltaNet            GatedDeltaNet
 12    GatedDeltaNet            GatedDeltaNet
 13    GatedDeltaNet            GatedDeltaNet
 14    GatedDeltaNet            GatedDeltaNet
 15    ★ Full Attention         ★ Perceiver Attention    ← fine-grained matching
 16    GatedDeltaNet            GatedDeltaNet
 17    GatedDeltaNet            GatedDeltaNet
 18    GatedDeltaNet            GatedDeltaNet
 19    GatedDeltaNet            GatedDeltaNet
 20    ★ Full Attention         ★ Perceiver Attention    ← final prediction
```

- **Relational axis**: 4:1 ratio (4 GatedDeltaNet : 1 Full Attention)
- **Episode axis**: Same 4:1 ratio, but attention layers use Perceiver bottleneck (256 latents) when C > 2000
- **Key insight**: The attention layers at both axes are **synchronized** — when the relational axis does full attention (precise recall), the episode axis also does Perceiver attention (precise ICL matching)

### 5.3 Variant B: MoE Routing (Per-Token Adaptive)

```
═══════════════════════════════════════════════════
Each layer has a router that decides per-token:
═══════════════════════════════════════════════════

  ┌─── Router ──────────────────────────────────────────────┐
  │  For each token:                                         │
  │    route = softmax(W_route @ token)  # [3] probabilities │
  │                                                          │
  │    Expert 0: GatedDeltaNet    (cheap, long-range)        │
  │    Expert 1: Full Attention   (expensive, precise)       │
  │    Expert 2: Skip Connection  (free, identity)           │
  │                                                          │
  │  Top-k routing: each token dispatched to k=1 expert      │
  └──────────────────────────────────────────────────────────┘
```

**Routing hypothesis for relational data**: We expect the router to learn:
- **Nearby 1-hop neighbors** → GatedDeltaNet (common, many tokens, simple aggregation)
- **Rare multi-hop connections** → Full Attention (uncommon but critical for link prediction)
- **Padding / irrelevant tokens** → Skip Connection

### 5.4 Implementation Detail: Shared vs. Independent Axes

**Design choice**: Should the two axes share the same GatedDeltaNet/Attention parameters?

```
Option 1: Shared parameters (Chronos-2 style — different axes, same weights)
  + Smaller model, faster training
  - Two axes have fundamentally different semantics

Option 2: Independent parameters (recommended)
  + Relational and episode axes can specialize
  - 2× parameters for attention layers
  
Option 3: Shared base + axis-specific LoRA adapters
  + Compromise: shared knowledge + axis specialization
  - Moderate complexity
```

**Recommendation**: Option 2 (independent) for research; Option 3 (LoRA) for parameter-efficient deployment.

### 5.5 Pros / Cons

| Pros | Cons |
|------|------|
| Best of both worlds — linear bulk + precise recall | More hyperparameters (ratio, routing) |
| Proven effective in NLP at scale (Jamba, Kimi) | MoE variant is harder to train (load balancing) |
| Flexible — can adjust ratio per task | Need both FLA and FlashAttention kernels |
| Attention layers provide interpretable patterns | Synchronization of attention layers across axes adds complexity |

---

## 6. Architecture 5: RT + RelGT Hybrid

### 6.1 Motivation

This architecture combines two existing models we already have or are building:
- **RT (Relational Transformer)** — the sequence-based backbone in `models/nn/orig_rt_pl.py`. Linearizes relational neighbors into a token sequence and applies standard transformer attention. Strong on entity-level prediction (JUICE argument: structured sequences capture feature interactions better than GNN aggregation).
- **RelGT (Relational Graph Transformer)** — processes the FK-PK graph structure directly via message passing + attention. Strong on link prediction and retrieval tasks where pairwise relational structure matters.

From empirical results and the JUICE analysis:
- **Entity prediction**: RT ≥ RelGT (sequence context captures richer feature co-occurrences)
- **Link prediction / retrieval**: RelGT >> RT (pairwise graph structure is essential)

Rather than choosing one, this architecture runs both branches in parallel and fuses their outputs — combining RT's sequence expressivity with RelGT's structural awareness.

### 6.2 Architecture Overview

```
═══════════════════════════════════════════════════
Shared Input: Relational Database Subgraph
═══════════════════════════════════════════════════
                         │
                ┌────────┴────────┐
                │                 │
                ▼                 ▼
  ┌──── Branch A: RT ──────────┐  ┌──── Branch B: RelGT ──────────┐
  │                            │  │                                │
  │  Relational Transformer    │  │  Relational Graph Transformer  │
  │  (models/nn/orig_rt_pl.py) │  │  (message passing + attn)     │
  │                            │  │                                │
  │  Linearized neighbor       │  │  Graph structure G=(V,E)       │
  │  tokens → seq attention    │  │  FK-PK edges → MP rounds       │
  │                            │  │                                │
  │  Output: entity_emb_rt     │  │  Output: entity_emb_relgt      │
  │          [C+Q, D]          │  │          [C+Q, D]              │
  └────────────────────────────┘  └────────────────────────────────┘
                │                              │
                └──────────┬───────────────────┘
                           ▼
              ┌──── Fusion Module ──────────────────────────┐
              │                                              │
              │  Option A: Gated Fusion                      │
              │    gate = sigmoid(W[emb_rt; emb_relgt])      │
              │    emb = gate * emb_rt                       │
              │        + (1-gate) * emb_relgt                │
              │                                              │
              │  Option B: Cross-Attention Fusion            │
              │    emb = CrossAttn(Q=emb_rt,                 │
              │                   K=emb_relgt,               │
              │                   V=emb_relgt)               │
              │                                              │
              │  Option C: Task-Conditioned Router           │
              │    if task == "entity_prediction":           │
              │      emb = emb_rt                            │
              │    elif task == "link_prediction":           │
              │      emb = emb_relgt                         │
              │    else:                                     │
              │      emb = concat(emb_rt, emb_relgt)         │
              └──────────────────────────────────────────────┘
                           │
                           ▼
              ┌──── ICL Head (shared) ─────────────┐
              │  Episode Transformer / Perceiver    │
              │  with label injection               │
              └─────────────────────────────────────┘
                           │
                           ▼
                       Prediction
```

### 6.3 RelGT Branch Design

RelGT (Relational Graph Transformer) processes the FK-PK subgraph directly. Building on Griffin (ICML 2025) and the RelGT paper:

```
Graph Branch Architecture:
═══════════════════════════════════════════════════

  Input: Subgraph G = (V, E, X_node, X_edge)
    V:      rows from all tables (nodes)
    E:      FK-PK links (edges with relation type)
    X_node: row features (from pretrained column encoders)
    X_edge: relation metadata (table name, FK column, etc.)

  ┌─── Node Encoder ───────────────────────────────┐
  │  For each node (row):                           │
  │    node_emb = CrossAttention(                   │
  │      Q = CLS_token,                             │
  │      K = cell_embeddings,                       │
  │      V = cell_embeddings                        │
  │    )                          # Griffin-style   │
  └─────────────────────────────────────────────────┘
                         │
                         ▼
  ┌─── Message Passing (K rounds) ─────────────────┐
  │  For k = 1 to K:                                │
  │    For each relation type r:                    │
  │      msg_r = AGGREGATE({MLP(node_j) :           │
  │               j ∈ N_r(i)})                      │
  │    node_i = UPDATE(node_i, {msg_r})             │
  │                                                 │
  │  Intra-relation aggregation before              │
  │  cross-relation merging (Griffin design)        │
  └─────────────────────────────────────────────────┘
                         │
                         ▼
  ┌─── Graph Transformer Layers (optional) ────────┐
  │  Full attention over all nodes in subgraph      │
  │  with edge-type bias in attention scores        │
  │  (only for small subgraphs, ≤ 512 nodes)       │
  └─────────────────────────────────────────────────┘
```

### 6.4 Fusion Proposals

| Proposal | When to Use | Complexity |
|----------|------------|------------|
| **Hard routing** by task type | Simplest; when tasks are clearly typed | O(1) fusion cost |
| **Gated fusion** (learned per entity) | When task boundary is blurry | O(D) per entity |
| **Cross-attention fusion** | When one branch has info the other needs | O(D²) per entity |
| **Alternating layers** (sequence layer → graph layer → ...) | Deep integration | Full model cost 2× |

**Recommended fusion for initial experiments**: Hard routing with soft fallback:
```python
if task_type == "entity_prediction":
    emb = 0.8 * emb_rt + 0.2 * emb_relgt    # mostly RT (sequence wins per JUICE)
elif task_type == "link_prediction":
    emb = 0.2 * emb_rt + 0.8 * emb_relgt    # mostly RelGT (graph structure wins)
else:
    gate = learned_gate(concat(emb_rt, emb_relgt))
    emb = gate * emb_rt + (1-gate) * emb_relgt
```

### 6.5 Link Prediction Head (for retrieval tasks)

```
For entity prediction: same ICL head as Architecture 1-4

For link prediction / retrieval:
═══════════════════════════════════════════════════

  Given: user embedding u, candidate item embeddings {v_1, ..., v_N}
  Support set: known (user, item, relevance) triples

  ┌─── Pairwise Scoring ──────────────────────────┐
  │                                                 │
  │  Option A: Bilinear                             │
  │    score(u, v) = u^T W v + b                    │
  │                                                 │
  │  Option B: MLP scorer                           │
  │    score(u, v) = MLP([u; v; u*v; |u-v|])       │
  │                                                 │
  │  Option C: ICL-conditioned scorer               │
  │    W = ICL_head(support_triples)  # learn W     │
  │    score(u, v) = u^T W v          # from context│
  └─────────────────────────────────────────────────┘
```

### 6.6 Pros / Cons

| Pros | Cons |
|------|------|
| Combines two already-built models (RT + RelGT) — minimal new code | Two branches = ~2× parameters and compute |
| Theoretically grounded: RT wins on entity prediction, RelGT wins on link prediction | Fusion module adds complexity and another hyperparameter |
| Can gracefully degrade (if one branch underperforms, weighted fusion compensates) | Harder to train jointly — gradient interference between branches |
| RelGT branch provides interpretable relational paths via message-passing | RelGT doesn't scale as well to large C (graph attention is O(V²) for small subgraphs) |
| Straightforward ablation: run RT-only, RelGT-only, then fused — clear comparison | Shared ICL head must reconcile two embedding spaces with different inductive biases |

---

## 7. ICL Training Pipeline

### 7.1 Episode Construction

```python
def construct_episode(database, task, C, Q):
    """
    Sample one episode from a database for a given task.
    
    Args:
        database: RelationalDatabase object
        task: TaskSpec (target_table, target_column, task_type)
        C: support set size
        Q: query set size
    
    Returns:
        episode: {support_entities, support_labels, 
                  query_entities, query_labels}
    """
    # 1. Get all labeled entities for this task
    all_entities = database.get_labeled_entities(
        table=task.target_table,
        column=task.target_column,
        timestamp_cutoff=task.timestamp  # temporal split
    )
    
    # 2. Split into support and query (stratified for classification)
    if task.type == "classification":
        support, query = stratified_split(all_entities, C=C, Q=Q)
    elif task.type == "regression":
        support, query = random_split(all_entities, C=C, Q=Q)
    elif task.type == "link_prediction":
        support, query = edge_split(all_entities, C=C, Q=Q)
    
    # 3. Sample relational context for each entity
    for entity in support + query:
        entity.context = sample_relational_neighbors(
            entity, database, 
            max_hops=3, 
            max_neighbors_per_hop=256,
            max_total_tokens=L
        )
    
    return Episode(support=support, query=query)
```

### 7.2 Training Loop

```python
def train_step(model, databases, config):
    """
    One gradient step with M episodes from different databases.
    
    Config:
        M: episodes per step (gradient accumulation if M > gpu_capacity)
        C: support size (randomized per episode)
        Q: query size
        C_grad: number of support entities with backbone gradient
    """
    optimizer.zero_grad()
    total_loss = 0
    
    for m in range(config.M):
        # 1. Sample database and task
        db = random.choice(databases)
        task = random.choice(db.available_tasks)
        
        # 2. Randomize support size (robustness to context shift)
        C = random.choice([64, 128, 256, 512, 1024, 2048, 4096])
        C = min(C, db.num_labeled_entities(task) - config.Q)
        
        # 3. Construct episode
        episode = construct_episode(db, task, C=C, Q=config.Q)
        
        # 4. Forward pass (architecture-dependent)
        if config.architecture in ["DART", "Arch3", "Arch4"]:
            # Unified architecture — single forward pass
            predictions = model(
                support_contexts=episode.support_contexts,    # [C, L, D_tok]
                support_labels=episode.support_labels,        # [C]
                query_contexts=episode.query_contexts,        # [Q, L, D_tok]
                task_type=task.type
            )
        
        elif config.architecture == "Arch2":
            # Two-stage — backbone then ICL head
            # Selective gradient for support
            with torch.no_grad():
                support_embs = model.backbone(episode.support_contexts)
            grad_idx = random.sample(range(C), k=config.C_grad)
            support_embs_grad = model.backbone(
                episode.support_contexts[grad_idx]
            )
            support_embs[grad_idx] = support_embs_grad
            
            query_embs = model.backbone(episode.query_contexts)
            
            predictions = model.icl_head(
                support_embs, episode.support_labels, query_embs
            )
        
        elif config.architecture == "Arch5":
            # Hybrid — both branches
            support_embs_seq = model.seq_branch(episode.support_contexts)
            support_embs_graph = model.graph_branch(episode.support_graphs)
            support_embs = model.fuse(support_embs_seq, support_embs_graph,
                                      task_type=task.type)
            # ... similar for query
        
        # 5. Compute loss
        if task.type == "classification":
            loss = F.cross_entropy(predictions, episode.query_labels)
        elif task.type == "regression":
            loss = F.mse_loss(predictions, episode.query_labels)
        elif task.type == "link_prediction":
            loss = bpr_loss(predictions, episode.query_positives, 
                           episode.query_negatives)
        
        # 6. Backward with gradient accumulation
        (loss / config.M).backward()
        total_loss += loss.item()
    
    # 7. Gradient clipping (per-component if Arch2)
    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
    optimizer.step()
    
    return total_loss / config.M
```

### 7.3 Multi-Task Training Schedule

```
Phase 1: Warm-Up (10% of total steps)
  ─────────────────────────────────────────
  - Small C (64-256), small L (256-512)
  - Single task type per episode
  - Higher learning rate for ICL head (3× backbone)
  - Optional: backbone-only pretext pretraining

Phase 2: Scale-Up (40% of total steps)
  ─────────────────────────────────────────
  - Medium C (256-2048), medium L (512-1024)
  - Mix of entity prediction + link prediction tasks
  - Standard learning rate
  - Progressive context growth

Phase 3: Full Scale (50% of total steps)
  ─────────────────────────────────────────
  - Large C (1024-10000), full L (1024-4096)
  - All task types including retrieval
  - Lower learning rate (cosine decay)
  - Multi-database episodes

Phase 4: Long-Context Post-Training (optional, like Chronos-2)
  ─────────────────────────────────────────
  - Extend L to 8192+ using RoPE scaling
  - Extend C to 10000+ using Perceiver bottleneck
  - Short phase with aggressive LR decay
```

### 7.4 Loss Function Design

```python
def compute_loss(predictions, targets, task_type, config):
    """
    Multi-task loss with task-specific components.
    """
    if task_type == "classification":
        # Standard cross-entropy
        ce_loss = F.cross_entropy(predictions.logits, targets.classes)
        return ce_loss
    
    elif task_type == "regression":
        # Quantile loss (like Chronos-2) for uncertainty estimation
        quantiles = [0.1, 0.25, 0.5, 0.75, 0.9]
        q_loss = sum(
            quantile_loss(predictions.quantiles[q], targets.values, q)
            for q in quantiles
        ) / len(quantiles)
        return q_loss
    
    elif task_type == "link_prediction":
        # InfoNCE with in-batch negatives
        # user_embs: [Q, D], item_embs: [N_items, D]
        scores = torch.mm(predictions.user_embs, 
                         predictions.item_embs.T)  # [Q, N_items]
        labels = targets.positive_indices           # [Q]
        info_nce = F.cross_entropy(scores / config.temperature, labels)
        return info_nce
    
    # Auxiliary losses (optional, added to all task types)
    aux_loss = 0
    if config.use_column_separability_reg:
        # Soft JUICE constraint: encourage column-wise independence
        aux_loss += config.lambda_sep * column_separability_loss(
            predictions.backbone_output
        )
    if config.use_contrastive_reg:
        # Contrastive loss on entity embeddings (for retrieval)
        aux_loss += config.lambda_ctr * contrastive_loss(
            predictions.entity_embs
        )
    
    return main_loss + aux_loss
```

---

## 8. Pretraining Data Strategy

### 8.1 Source 1: PluRel Synthetic Data

PluRel generates synthetic relational databases with controllable properties:

```
PluRel Configuration:
  ─────────────────────────────────────────
  - Number of tables: 2-8 (uniform)
  - Rows per table: 100-100,000 (log-uniform)
  - Columns per table: 3-30 (uniform)
  - FK-PK relationships: 1-5 per table pair
  - Column types: numeric (continuous, discrete), categorical, temporal
  - Label generation: 
    - Classification: decision tree on aggregated features (2-20 classes)
    - Regression: linear combination + noise
  
  Tasks per synthetic DB:
  - Entity prediction (node classification/regression)
  - Autocomplete (masked cell prediction)
  
  Scale: 10,000 synthetic databases × 3-5 tasks each = 30,000-50,000 episodes
```

**Augmentations for ICL training**:
```
For each synthetic DB:
  1. Generate multiple tasks with different target columns
  2. Vary schema complexity (number of hops, join types)
  3. Control label-feature correlation strength (easy → hard)
  4. Add label noise (0%, 5%, 10%, 20%) for robustness
  5. Vary class imbalance ratio
```

**Extension for link prediction** (currently missing from PluRel):
```
Synthetic Link Prediction Data:
  ─────────────────────────────────────────
  - Generate bipartite user-item graphs
  - Edge generation mechanisms:
    a. Stochastic Block Model (cluster-based preferences)
    b. Popularity-weighted sampling (power-law degree distribution)
    c. Feature-based: P(edge) = sigmoid(user_feat · item_feat)
    d. Temporal: edges appear over time with recency bias
  - Negative sampling: random, popularity-weighted, hard (same cluster)
```

### 8.2 Source 2: Rel-Amazon

Real-world relational database from Amazon product data:

```
Rel-Amazon Schema:
  ─────────────────────────────────────────
  Tables: products, reviews, users, categories, also_bought, ...
  
  Available tasks:
  - Product rating prediction (regression)
  - User churn prediction (classification)
  - Product recommendation (link prediction)
  - Category prediction (classification)
  
  Preprocessing:
  - Temporal train/val/test split
  - Remove data leakage across time
  - Subsample large tables for manageable episode size
  
  Usage in training:
  - 80% of tasks for training episodes
  - 20% held out for validation
  - Zero-shot evaluation on different time windows
```

try pre-training on source 1 and source 2. 

## 9. Evaluation Plan

### 9.1 Downstream Benchmarks

#### Rel-F1 (RelBench F1 Benchmark)

```
Datasets:  rel-f1
Tasks:   driver-dnf, driver-top3, driver-position
```

#### Rel-Trial (Clinical Trial Benchmark)

```
Datasets:  rel-trial (from RelBench)
Tasks:    study-outcome, site-success, study-adverse
```



## 10. Architecture Comparison Summary

| | DART (Arch 1) | Two-Stage (Arch 2) | Pure GDN (Arch 3) | Hybrid (Arch 4) | Seq+Graph (Arch 5) |
|---|---|---|---|---|---|
| **Relational Axis** | Full Attention | Full Attention | GatedDeltaNet | GDN + Attn (4:1) | GDN + Attn / MPNN |
| **Episode Axis** | Full/Perceiver | Full/Perceiver | GatedDeltaNet | GDN + Perceiver | Full/Perceiver |
| **ICL Integration** | Every layer | Final stage only | Every layer | Every layer | Final stage |
| **Memory O(·)** | O(L² + C²) | O(L² + C²) | O(L + C) | O(L + C²ₐₜₜₙ) | O(L + C² + Graph) |
| **Cold-Start Risk** | Low | High | Low | Low | Medium |
| **Entity Prediction** | ★★★★ | ★★★ | ★★★ | ★★★★ | ★★★★ |
| **Link Prediction** | ★★ | ★★ | ★★ | ★★★ | ★★★★ |
| **Engineering Effort** | High | Low | Medium | Medium-High | Very High |
| **Novelty** | High | Low | Medium | Medium | High |
| **Recommended Priority** | **1st** | 3rd | 4th | **2nd** | 5th |
