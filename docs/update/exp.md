# ICL Experiment Runbook

This file is the execution plan and result log for the current ICL study. The agent should run the experiments in order, keep the logs concise but complete, and write conclusions back into the conclusion blocks in this file.

## TODO

The autonomous runner uses these checklist ids and step markers. Each agent should only update its assigned TODO item and the matching marked lines in this file.

- [ ] `todo:s1_freeze_protocol` Freeze the shared Step 1 protocol. <!-- todo:s1_freeze_protocol -->
- [ ] `todo:s1_a_driver_dnf` Run `S1-A` transfer on `driver-dnf`. <!-- todo:s1_a_driver_dnf -->
- [ ] `todo:s1_a_driver_position` Run `S1-A` transfer on `driver-position`. <!-- todo:s1_a_driver_position -->
- [ ] `todo:s1_b_driver_dnf` Run `S1-B` transfer on `driver-dnf`. <!-- todo:s1_b_driver_dnf -->
- [ ] `todo:s1_b_driver_position` Run `S1-B` transfer on `driver-position`. <!-- todo:s1_b_driver_position -->
- [ ] `todo:s1_c_driver_dnf` Run `S1-C` transfer on `driver-dnf`. <!-- todo:s1_c_driver_dnf -->
- [ ] `todo:s1_c_driver_position` Run `S1-C` transfer on `driver-position`. <!-- todo:s1_c_driver_position -->
- [ ] `todo:s1_rerun_top2` Rerun the top two Step 1 candidates. <!-- todo:s1_rerun_top2 -->
- [ ] `todo:s1_conclusion` Write the Step 1 conclusion. <!-- todo:s1_conclusion -->
- [ ] `todo:s2_a_driver_dnf` Run `S2-A` transfer on `driver-dnf`. <!-- todo:s2_a_driver_dnf -->
- [ ] `todo:s2_a_driver_position` Run `S2-A` transfer on `driver-position`. <!-- todo:s2_a_driver_position -->
- [ ] `todo:s2_b_driver_dnf` Run `S2-B` transfer on `driver-dnf`. <!-- todo:s2_b_driver_dnf -->
- [ ] `todo:s2_b_driver_position` Run `S2-B` transfer on `driver-position`. <!-- todo:s2_b_driver_position -->
- [ ] `todo:s2_c_driver_dnf` Run `S2-C` transfer on `driver-dnf`. <!-- todo:s2_c_driver_dnf -->
- [ ] `todo:s2_c_driver_position` Run `S2-C` transfer on `driver-position`. <!-- todo:s2_c_driver_position -->
- [ ] `todo:s2_d_driver_dnf` Run `S2-D` transfer on `driver-dnf`. <!-- todo:s2_d_driver_dnf -->
- [ ] `todo:s2_d_driver_position` Run `S2-D` transfer on `driver-position`. <!-- todo:s2_d_driver_position -->
- [ ] `todo:s2_e_driver_dnf` Run `S2-E` transfer on `driver-dnf`. <!-- todo:s2_e_driver_dnf -->
- [ ] `todo:s2_e_driver_position` Run `S2-E` transfer on `driver-position`. <!-- todo:s2_e_driver_position -->
- [ ] `todo:s2_conclusion` Write the Step 2 conclusion. <!-- todo:s2_conclusion -->
- [ ] `todo:s3_fp4_infer_driver_dnf` Run `fp4` inference on `driver-dnf`. <!-- todo:s3_fp4_infer_driver_dnf -->
- [ ] `todo:s3_fp4_infer_driver_position` Run `fp4` inference on `driver-position`. <!-- todo:s3_fp4_infer_driver_position -->
- [ ] `todo:s3_int8_infer_driver_dnf` Run `int8` inference on `driver-dnf`. <!-- todo:s3_int8_infer_driver_dnf -->
- [ ] `todo:s3_int8_infer_driver_position` Run `int8` inference on `driver-position`. <!-- todo:s3_int8_infer_driver_position -->
- [ ] `todo:s3_fp4_train_driver_dnf` Run `fp4` train-time quantization on `driver-dnf`. <!-- todo:s3_fp4_train_driver_dnf -->
- [ ] `todo:s3_fp4_train_driver_position` Run `fp4` train-time quantization on `driver-position`. <!-- todo:s3_fp4_train_driver_position -->
- [ ] `todo:s3_int8_train_driver_dnf` Run `int8` train-time quantization on `driver-dnf`. <!-- todo:s3_int8_train_driver_dnf -->
- [ ] `todo:s3_int8_train_driver_position` Run `int8` train-time quantization on `driver-position`. <!-- todo:s3_int8_train_driver_position -->
- [ ] `todo:s3_conclusion` Write the Step 3 conclusion. <!-- todo:s3_conclusion -->

## Fixed protocol

### Goal

Find an ICL architecture that actually transfers after pretraining on `rel-hm`, then use that architecture for model-combination experiments, then test quantization for inference and pretraining.

### Fixed data protocol

- Pretrain on `rel-hm`
- Transfer-evaluate on `rel-avito/driver-dnf`
- Transfer-evaluate on `rel-f1/driver-position`
- Use the same train/val/test split policy across all compared runs
- Use the same preprocessing and sampler settings unless the experiment step explicitly changes them

### Fixed backbone scope for Step 1

- Only use `orig_rt`
- Only touch the RT path, not GNN backbones
- `TabPFN` is excluded from Step 1 because it is already known to work as an ICL backend and does not help answer the architecture question

### Tensor shape conventions

- Joint grouped pretraining: `(B, T, L, d)`
- `B`: number of groups / episodes per batch
- `T`: group size = `support + query`
- `L`: per-example relational context length
- `d`: hidden dimension

### Architecture-specific tensor shapes

1. Backbone + ICL head, joint end-to-end:
   uses grouped batches throughout, conceptually `(B, T, L, d)` into backbone and `(B, T, d)` into the ICL head
2. Backbone + ICL head, sequential two-stage training:
   backbone pretraining stage uses `(T, L, d)`;
   ICL stage uses grouped embeddings `(B, T, d)`
3. DART-like architecture:
   uses grouped batches throughout, with intra-example relational processing plus cross-example interaction inside the backbone, so the effective training shape remains `(B, T, L, d)`

### Global logging rules

For every run, append one row to the relevant log table and keep a short free-form note below it.

Always log:

- date
- step id
- run id
- code path / config name
- architecture
- backbone
- pretraining dataset
- transfer dataset
- batch shape
- key hyperparameters that changed
- wall-clock time
- peak memory
- metric name and value on val/test
- failure mode if the run did not finish

### Working definition of "can work"

An architecture counts as "can work" only if all of the following are true:

1. It trains without repeated NaNs, silent collapse, or unrecoverable OOM at a reasonable batch size.
2. It finishes transfer evaluation on both downstream tasks.
3. Its downstream result is meaningfully above trivial behavior on both tasks.
4. The result is reproducible enough that at least the rerun trend is consistent.

If multiple architectures satisfy the above, pick the winner by average downstream rank across `driver-dnf` and `driver-position`, breaking ties by simpler training and lower memory.

### Protocol freeze record

- Pretraining split on `rel-hm`: TBD <!-- step:s1_freeze_protocol -->
- Transfer metric for `driver-dnf`: TBD <!-- step:s1_freeze_protocol -->
- Transfer metric for `driver-position`: TBD <!-- step:s1_freeze_protocol -->
- Shared sampler/context setting: TBD <!-- step:s1_freeze_protocol -->
- Shared optimizer/batch policy: TBD <!-- step:s1_freeze_protocol -->

## Step 1: Find an ICL strategy that works

### Question

With `orig_rt` only, which of the following is viable after pretraining on `rel-hm`?

1. Two-stage architecture, trained end-to-end
2. Two-stage architecture, trained sequentially: backbone first, then ICL head
3. DART-like architecture

### Scope

- Backbone family: `orig_rt` only
- No `nbfnet`
- No `relgt`
- No `TabPFN`

### Required variants

| Variant ID | Architecture | Training mode | Expected shape |
| --- | --- | --- | --- |
| S1-A | Backbone + ICL head | Joint end-to-end | `(B, T, L, d)` then `(B, T, d)` |
| S1-B | Backbone + ICL head | Sequential two-stage | Stage 1: `(T, L, d)`; Stage 2: `(B, T, d)` |
| S1-C | DART-like | Joint integrated training | `(B, T, L, d)` |

### Step-by-step plan

1. Freeze the common protocol.
   Record the exact `rel-hm` pretraining split, the two downstream tasks, the metric used by each task, and the common sampler/context settings.
2. Prepare one shared `orig_rt` baseline config.
   Keep optimizer, hidden size, context length, and data preprocessing fixed unless a variant structurally requires a change.
3. Run `S1-A`.
   Pretrain on `rel-hm`, transfer to both downstream tasks, log stability, memory, and final metrics.
4. Run `S1-B`.
   First train only the backbone with `(T, L, d)` inputs, then train the ICL head on grouped embeddings `(B, T, d)`, then transfer to both downstream tasks.
5. Run `S1-C`.
   Pretrain and transfer with the DART-like integrated architecture.
6. Rerun the top two Step 1 candidates once.
   The rerun is not for exhaustive statistics; it is only to detect a fragile one-off win.
7. Write the Step 1 conclusion.
   State which architecture "works", which ones fail, and whether the failure is quality, stability, memory, or engineering complexity.

### Minimum run log

| Date | Run ID | Variant | Transfer task | Code/config | Batch shape | Key overrides | Val metric | Test metric | Time | Peak mem | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | S1-A | `driver-dnf` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TODO | | <!-- step:s1_a_driver_dnf -->
| TBD | TBD | S1-A | `driver-position` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TODO | | <!-- step:s1_a_driver_position -->
| TBD | TBD | S1-B | `driver-dnf` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TODO | | <!-- step:s1_b_driver_dnf -->
| TBD | TBD | S1-B | `driver-position` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TODO | | <!-- step:s1_b_driver_position -->
| TBD | TBD | S1-C | `driver-dnf` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TODO | | <!-- step:s1_c_driver_dnf -->
| TBD | TBD | S1-C | `driver-position` | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TODO | | <!-- step:s1_c_driver_position -->

### Step 1 rerun record

- Top two rerun summary: TBD <!-- step:s1_rerun_top2 -->
- Rerun consistency note: TBD <!-- step:s1_rerun_top2 -->

### Per-variant notes

#### S1-A notes

- Hypothesis:
- Actual behavior:
- Failure mode, if any:

#### S1-B notes

- Hypothesis:
- Actual behavior:
- Failure mode, if any:

#### S1-C notes

- Hypothesis:
- Actual behavior:
- Failure mode, if any:

### Step 1 conclusion

- Winning architecture: TBD <!-- step:s1_conclusion -->
- Why it wins: TBD <!-- step:s1_conclusion -->
- Architectures that do not work: TBD <!-- step:s1_conclusion -->
- Main bottleneck observed: TBD <!-- step:s1_conclusion -->
- Decision for Step 2: TBD <!-- step:s1_conclusion -->

## Step 2: Use the winning ICL architecture and test model combinations

This step starts only after Step 1 has named one architecture as the default ICL path.

### Question

Given the winning ICL architecture from Step 1, which combination of backbone-style blocks and ICL head works best?

### Fixed rule

- Reuse the Step 1 winner unchanged at the architecture level
- Only vary the model combination inside that architecture
- If Step 1 picks a two-stage architecture, compare combinations inside the backbone and/or ICL head
- If Step 1 picks DART-like, compare combinations inside the integrated block stack

### Recommended comparison matrix

At minimum, test the combinations that are already implemented or closest to implemented in the RT path:

| Variant ID | Backbone block | ICL block / interaction block | Notes |
| --- | --- | --- | --- |
| S2-A | transformer | transformer | default control |
| S2-B | gated_deltanet | transformer | test linear-time relational block |
| S2-C | hybrid | transformer | mixed relational backbone |
| S2-D | transformer | gated_deltanet | only if the chosen architecture has a separate head |
| S2-E | gated_deltanet | gated_deltanet | only if the chosen architecture has a separate head |

If Step 1 chooses DART-like and there is no separate ICL head, reinterpret the second column as the episode-interaction block.

### Step-by-step plan

1. Lock the Step 1 winning architecture.
   Write the exact winner here before running anything else.
2. Select the legal combinations for that architecture.
   Skip combinations that do not exist in code or require a separate project.
3. Run each combination with the same `rel-hm` pretraining and the same two transfer tasks.
4. Rerun the best and second-best combination once.
5. Write a ranking with one sentence per combination.
6. Choose one default model combination for future experiments.

### Step 2 run log

| Date | Run ID | Variant | Transfer task | Code/config | Pretrain setup | Val metric | Test metric | Time | Peak mem | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | S2-A | `driver-dnf` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_a_driver_dnf -->
| TBD | TBD | S2-A | `driver-position` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_a_driver_position -->
| TBD | TBD | S2-B | `driver-dnf` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_b_driver_dnf -->
| TBD | TBD | S2-B | `driver-position` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_b_driver_position -->
| TBD | TBD | S2-C | `driver-dnf` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_c_driver_dnf -->
| TBD | TBD | S2-C | `driver-position` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_c_driver_position -->
| TBD | TBD | S2-D | `driver-dnf` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_d_driver_dnf -->
| TBD | TBD | S2-D | `driver-position` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_d_driver_position -->
| TBD | TBD | S2-E | `driver-dnf` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_e_driver_dnf -->
| TBD | TBD | S2-E | `driver-position` | TBD | `rel-hm` | TBD | TBD | TBD | TBD | TODO | | <!-- step:s2_e_driver_position -->

### Step 2 conclusion

- Step 1 winner used here: TBD <!-- step:s2_conclusion -->
- Best model combination: TBD <!-- step:s2_conclusion -->
- Runner-up: TBD <!-- step:s2_conclusion -->
- Accuracy/performance tradeoff: TBD <!-- step:s2_conclusion -->
- Memory/speed tradeoff: TBD <!-- step:s2_conclusion -->
- Default choice for future work: TBD <!-- step:s2_conclusion -->

## Step 3: Quantization study

### Question

Can low-precision variants such as `fp4` or `int8` work for:

1. Inference after pretraining
2. Continued pretraining / finetuning

### Fixed rule

- Use only the default architecture+model combination selected from Step 2
- Keep the same `rel-hm` pretraining source and the same two downstream tasks
- Separate inference-only quantization from train-time quantization

### Quantization matrix

| Variant ID | Precision | Use mode | Goal |
| --- | --- | --- | --- |
| S3-A | fp4 | inference only | check if the model can run and retain acceptable accuracy |
| S3-B | int8 | inference only | same as above |
| S3-C | fp4 | pretraining / finetuning | check stability and trainability |
| S3-D | int8 | pretraining / finetuning | check stability and trainability |

### Step-by-step plan

1. Export or load the Step 2 winning checkpoint in full precision.
2. Run an fp32 reference evaluation on both downstream tasks and write those numbers at the top of this section.
3. Run inference-only quantization for `fp4` and `int8`.
   Record throughput, memory, and downstream metric delta relative to fp32.
4. Run train-time quantization for `fp4` and `int8`.
   Record whether training launches, whether loss decreases, whether gradients stay finite, and whether transfer quality is acceptable.
5. Write a final recommendation.
   Separate "safe for inference" from "safe for pretraining".

### Reference fp32

- Checkpoint:
- `driver-dnf` metric:
- `driver-position` metric:
- Throughput:
- Peak mem:

### Step 3 run log

| Date | Run ID | Variant | Transfer task | Mode | Metric | Delta vs fp32 | Throughput | Peak mem | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | S3-A | `driver-dnf` | inference | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_fp4_infer_driver_dnf -->
| TBD | TBD | S3-A | `driver-position` | inference | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_fp4_infer_driver_position -->
| TBD | TBD | S3-B | `driver-dnf` | inference | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_int8_infer_driver_dnf -->
| TBD | TBD | S3-B | `driver-position` | inference | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_int8_infer_driver_position -->
| TBD | TBD | S3-C | `driver-dnf` | train | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_fp4_train_driver_dnf -->
| TBD | TBD | S3-C | `driver-position` | train | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_fp4_train_driver_position -->
| TBD | TBD | S3-D | `driver-dnf` | train | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_int8_train_driver_dnf -->
| TBD | TBD | S3-D | `driver-position` | train | TBD | TBD | TBD | TBD | TODO | | <!-- step:s3_int8_train_driver_position -->

### Step 3 conclusion

- Safe inference precision: TBD <!-- step:s3_conclusion -->
- Unsafe inference precision: TBD <!-- step:s3_conclusion -->
- Safe train-time precision: TBD <!-- step:s3_conclusion -->
- Unsafe train-time precision: TBD <!-- step:s3_conclusion -->
- Recommended deployment setting: TBD <!-- step:s3_conclusion -->
- Recommended research setting: TBD <!-- step:s3_conclusion -->

## Final summary block

This block should be filled only after all three steps are done.

- Best ICL architecture:
- Best model combination:
- Best downstream result on `driver-dnf`:
- Best downstream result on `driver-position`:
- Quantization recommendation:
- Next experiment to run:
