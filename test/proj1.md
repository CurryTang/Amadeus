# Project Proposal: Scaling Laws of In-Context Learning for Tabular Prediction

**System Validation Test for Vibe Research Tool** | February 2026

---

## 1. Research Question

How does the predictive performance of in-context learning (ICL) tabular models scale with the number of in-context examples, and at what point do diminishing returns emerge compared to gradient-based methods like XGBoost and LightGBM?

Given a tabular classification or regression task, what is the relationship between the number of ICL demonstration rows provided to models such as TabPFN and TabICL, and their downstream accuracy? We compare this scaling behavior against traditional gradient-based baselines that train on the same data volume, characterizing the crossover points where one paradigm overtakes the other.

## 2. Motivation and Scope

ICL-based tabular foundation models represent a fundamentally different paradigm from traditional supervised learning: they make predictions by conditioning on demonstration examples at inference time, with no gradient updates. Understanding how their performance scales with context size is both scientifically interesting and practically important for deciding when to deploy these models versus classical alternatives.

The scope is deliberately constrained to single-table settings with varying dataset sizes (100 to 10,000 rows) across 8–12 OpenML benchmark datasets. This keeps the study tractable for a fully automated pipeline while still producing meaningful findings.

## 3. Methodology

### 3.1 Datasets

Select 8–12 datasets from the OpenML-CC18 benchmark suite, stratified by task type (binary classification, multiclass, regression) and dataset size. The agent should query the knowledge base for established tabular benchmarks and filter for datasets with 500–50,000 rows and fewer than 100 features to ensure tractability.

### 3.2 Models Under Evaluation

| Model | Type | Context Scaling? | Key Parameter |
|-------|------|-----------------|---------------|
| TabPFN v2 | ICL / Prior-Fitted | Yes — vary N_ctx | Context window size |
| TabICL | ICL / Transformer | Yes — vary N_ctx | Context window size |
| XGBoost | Gradient Boosting | Vary training set size | N training rows |
| LightGBM | Gradient Boosting | Vary training set size | N training rows |

### 3.3 Experimental Protocol

**Data Splitting:** For each dataset, hold out 20% as a fixed test set. From the remaining 80%, create subsamples of sizes N ∈ {50, 100, 250, 500, 1000, 2500, 5000, 10000} (capped at the dataset's training size). Repeat each subsample 5 times with different random seeds.

**ICL Models:** For each subsample size N, provide N rows as in-context demonstrations and evaluate on the held-out test set. Record inference time and memory usage alongside prediction metrics.

**Gradient-Based Models:** Train XGBoost and LightGBM on the same N-row subsamples using default hyperparameters (no tuning, to keep the comparison fair to ICL models which also receive no tuning). Record training time + inference time.

**Metrics:** AUROC for binary classification, log-loss for multiclass, RMSE for regression. All metrics computed on the fixed test set.

## 4. Agent Pipeline Specification

The following stages define the end-to-end execution plan the orchestrator should follow. Each stage includes explicit entry conditions, actions, and exit criteria.

### 4.1 Stage 1 — Literature & Setup

- **Knowledge Base Query:** Retrieve background on TabPFN v2 architecture, TabICL inference mechanism, known scaling behavior of ICL models, and OpenML-CC18 dataset metadata.
- **Environment Setup:** Install dependencies (tabpfn, openml, xgboost, lightgbm, scikit-learn, matplotlib, pandas). Verify GPU availability and CUDA version.
- **Exit Criteria:** All packages installed, GPU confirmed, dataset list finalized and saved to project config.

### 4.2 Stage 2 — Data Acquisition & Preprocessing

- **Download:** Fetch selected datasets via OpenML API. Cache raw data locally.
- **Preprocessing:** Handle missing values (median imputation for numeric, mode for categorical), encode categoricals, normalize features. Save processed datasets as parquet files.
- **Subsampling:** Generate all (dataset, N, seed) subsample combinations. Persist subsample indices for reproducibility.

### 4.3 Stage 3 — Experiment Execution

- **Run Loop:** For each (dataset, model, N, seed) combination, execute the evaluation. Log results incrementally to a CSV file after each run.
- **Error Handling:** If a run fails (OOM, timeout >5min, numerical error), log the failure with error type and continue. The orchestrator should retry once with halved batch size for OOM errors before marking as failed.
- **Checkpointing:** After completing each dataset, verify result CSV integrity. If the pipeline is interrupted, it should resume from the last complete dataset.

### 4.4 Stage 4 — Analysis & Visualization

- **Scaling Curves:** Plot mean performance (± std) vs. log(N) for each model, per dataset. Overlay all models on the same axes for direct comparison.
- **Crossover Analysis:** For each dataset, identify the N at which XGBoost overtakes the best ICL model (if it does). Characterize dataset properties that predict early vs. late crossover.
- **Aggregate Summary:** Compute average rank across datasets at each N. Generate a critical difference diagram or rank plot.

### 4.5 Stage 5 — Report Generation

- **Deliverables:** A structured report (PDF or markdown) containing: introduction, methodology, results with embedded figures, discussion of crossover points, and conclusions.
- **Supplementary Files:** Raw results CSV, all figure files (PNG + vector SVG), experiment configuration JSON, and a reproducibility README with exact commands to rerun.

## 5. Success Criteria

| Module | Validation Criterion | Pass Condition |
|--------|---------------------|----------------|
| Knowledge Base | Retrieves relevant papers/docs for TabPFN, TabICL, OpenML; avoids irrelevant results | 80%+ relevance in retrieved items |
| Orchestrator | Executes all stages in order; handles errors (OOM, missing data); resumes after interruption | Completes pipeline end-to-end with ≤1 manual fix |
| Deliverables | Generates report with embedded figures, tables, and narrative; produces supplementary files | Report is coherent, figures render, tables have correct data |
| Execution | Runs all scripts, manages file I/O, tracks intermediate results, handles dependencies | 90%+ experiment runs succeed; results CSV is complete |

## 6. Estimated Compute & Timeline

With 10 datasets × 4 models × 8 subsample sizes × 5 seeds = 1,600 individual runs. ICL inference is GPU-bound (~5–30s per run); tree model training is CPU-bound (~1–10s per run). Total estimated wall-clock time on a single A100: 4–8 hours for execution, plus ~30 minutes for analysis and report generation.

The entire pipeline, including literature review, setup, execution, analysis, and report writing, should complete within a single automated session of approximately 10–12 hours.

## 7. Optional Extensions

**Multi-table relational setting:** Extend to 2–3 RFMBench datasets where ICL models receive flattened DFS features while GNNs operate on the relational graph. This tests the orchestrator's ability to handle branching model-specific preprocessing.

**Hyperparameter sensitivity:** Add a grid search for XGBoost (max_depth, learning_rate) and measure whether the crossover point shifts. This tests the orchestrator's ability to manage combinatorial experiment expansion.

**Live knowledge base updates:** Mid-pipeline, inject a new paper into the knowledge base (e.g., a recent TabPFN v2 update) and verify the agent incorporates it in the final discussion section.