# Margin eval coverage — every AI workflow in AptDesignerAI

The goal is cost-per-outcome for EVERY AI workflow, not just search. This is the
enumeration + coverage ledger; Margin's coverage engine recommends the next
suite to build, ranked by spend × importance (the **Frontier** table below).

Every metered LLM call goes through `geminiProvider` (`lib/ai/gemini.ts`) or
`deepseekProvider` (`lib/ai/deepseek.ts`); those emit per-call economics. A suite
here drives a workflow through its real entry so the calls emit under that
workflow's id, then grades the genuine outcome.

**Status:** 3 dedicated suites (`search`, `fit-scoring`, `diagnosis`). The search
suite additionally exercises its ~14 internal sub-steps; diagnosis exercises its
vision sub-steps. Legend — Spend/Importance: L/M/H. Evaled: **Y** (dedicated
suite), *partial* (exercised inside another suite), **N** (frontier).

## A. User-facing workflows (own `app/api/**` route)

| Workflow | What it does | Metered entry (file:line) | Outcome signal | Evaled | Spend/Imp |
| --- | --- | --- | --- | --- | --- |
| search-orchestrator | plan→search→score→bundle→validate | `lib/agents/orchestrator.ts:547` `runAgenticSearch` | `data.validation.isValid` + `.confidence` | **Y** (`search`) | H/H |
| product-evaluate (fit) | score one product's room fit | `lib/agents/fit-scorer.ts:121` `scoreProduct` | `data.final_item_score` + `scores.confidence_score` | **Y** (`fit-scoring`) | M/H |
| room-diagnosis | 2-pass diagnosis → direction + action list | `lib/agents/room-diagnostician.ts:91` `runRoomDiagnosis` | `success` (+ room-type gate) + completeness | **Y** (`diagnosis`) | M-H/H |
| mockup-generation | generate + verify redesigned-room image | `lib/agents/mockup-agent.ts:357` `generateMockupImage`, `mockup-verifier.ts:134` `generateWithVerification` | `data.image_url` + verifier `matches_room`/`confidence` | **N** | **H**/H |
| area-analysis | what works / should go / needs + harmony | route `app/api/area-analysis/route.ts` (inline `geminiProvider.chat`) + `validateAreaAnalysisAsync` | parsed analysis + `validateAreaAnalysisAsync.isValid` + harmony score | **N** | **H**/H |
| apartment/building-research | grounded web+Maps building research | route `app/api/apartment-research/route.ts` (inline, grounding) | zod-parsed research + `confidence_notes` gaps | **N** | M/M |
| analyze-apartment | vision → apartment profile | route `app/api/analyze-apartment/route.ts` (inline) | parsed apartment analysis | **N** | M/M |
| bundle-evaluate | score a product combination | `lib/agents/bundle-optimizer.ts:195` `evaluateBundle` | `data` verdict + bundle score | *partial* (search) | M/H |
| product-ingest (extractor) | URL/image → structured product | `lib/agents/product-extractor.ts:677` `extractFromUrl` | zod-parsed product present | *partial* (search) | M/H |
| computer-use-verifier | Browserbase visits product page | `lib/agents/computer-use/product-verifier.ts:255` `runProductVerifier` | `agent_status` + non-null `product` | **N** (needs Browserbase) | **H**/M |
| vision-product-verifier | grounded photo-vs-catalog check | `lib/agents/product-verifier.ts:95` `runProductVerifier` | enriched `verified` + `confidence` | **N** | M/M |
| area-analysis-refine | re-run analysis after an edit | route `app/api/area-analysis/refine/route.ts` (inline) | revised analysis + validator `isValid` | **N** | M/M |
| refine-chat-summarizer | summarize refine changes | `lib/agents/refine-summarizer.ts:44` `summarizeRefineChanges` | non-empty summary parsed | **N** | L/L |
| identified-products-search | catalog vector lookup | route `app/api/identified-products/search/route.ts` | ranked suggestions | n/a (no LLM) | L/L |

## B. Sub-steps of runAgenticSearch (exercised inside the `search` suite)

`generateSearchBrief` (`shopping-researcher.ts:347`), `searchProducts` Tavily
(`:472`), `quickScreenCandidates` (`:638`), `rerankCandidates`
(`reranker.ts:89`), `pairwiseRerank` (`pairwise-reranker.ts:53`), `scoreProducts`
(`fit-scorer.ts:368`), `planCategories` (`category-planner.ts:86`),
`validateProductSet` (`validation-agent.ts:1266`), `validateRequirements`
(`requirement-validator.ts:103`), `runPostSearchCoordinator`
(`post-search-coordinator.ts:394`), `planCorrections` (`correction-planner.ts:111`),
`generateBundleVibe` (`bundle-optimizer.ts:412`), `extractFromUrlBatch`
(`product-extractor.ts:430`), `verifyTopSearchCandidates`
(`verify-search-candidates.ts:281`). → **partial** (metered under `aptdesigner-search`).

## C. Sub-steps of area-analysis / diagnosis / mockup pipelines (mostly N)

`selfConsistent` (`self-consistency.ts:72`), `selfReview{AreaAnalysis,Diagnosis,Extraction}`
(`self-correction.ts:63/502/611`), `runDesignCoordinator` (`design-coordinator.ts:271`),
`reconcileKeepReplace` (`keep-replace-reconciler.ts:59`), photo-grounding
(`photo-grounding-validator.ts:90/224`), `inferReplacementsFromPhotos`
(`infer-replacements.ts:161`), `enrichWhatItNeeds` (`whatitneeds-enricher.ts:75`),
`validateMockupPrompt` (`mockup-prompt-validator.ts:88`), `analyzePhotoOrientations`
(`photo-orientation-analyzer.ts:87`), `extractRoomArchitecture`
(`room-architecture-extractor.ts:88`), `assembleRoomSceneGraph`
(`scene-assembler.ts:41`), `runFloorPlanExtraction` (`floor-plan-extractor.ts:135`),
`runFurnitureCropper` (`furniture-cropper.ts:111`), `runProductIdentifier`
(`product-identifier.ts:73`), `runIdentifiedProductsPipeline`
(`identified-products-pipeline.ts:64`), `runDiagnosisExpansion`
(`greedy-decorator.ts:185`). → mostly **N**; diagnosis's vision sub-steps are
partially exercised by the `diagnosis` suite.

## D. Non-metered (no LLM — excluded from cost eval)

`loadUserFeedbackContext`, `snippet-fallback`, the deterministic validators
(`area-analysis-validator`, `diagnosis-validator`), scene-reconciliation,
domain-router, extraction-gate, and all `lib/scoring/*` math except
`pairwise-reranker` (#B). These have no token cost.

## Coverage

- **Metered user-facing workflows (§A, excl. the no-LLM catalog search): 13.**
  Dedicated suites: **3** → **~23%** dedicated coverage.
- Counting transitive exercise, the `search` suite meters 14 internal sub-steps
  and `diagnosis` meters its vision sub-steps, so a large share of total LLM
  spend is already observed — but attributed to the parent workflow, not itemised.

## Frontier — build next, ranked by spend × importance

| Rank | Workflow | Why next | Entry to wrap |
| --- | --- | --- | --- |
| 1 | **mockup-generation** | highest per-call spend (image model `gemini-3-pro-image`); verifier gives a real outcome | `mockup-verifier.ts:134` `generateWithVerification` |
| 2 | **area-analysis** | high spend + every room hits it first; deterministic `validateAreaAnalysisAsync` outcome | `app/api/area-analysis/route.ts` (extract a lib entry) |
| 3 | **apartment/building-research** | grounded web+Maps spend; `confidence_notes` outcome | `app/api/apartment-research/route.ts` |
| 4 | **identified-products-pipeline** | vision crop→identify→verify chain; per-item `confidence` | `identified-products-pipeline.ts:64` |
| 5 | **computer-use-verifier** | high spend when active (browser turns); needs Browserbase creds | `computer-use/product-verifier.ts:255` |

Notes for the next builder: mockup + area-analysis are the highest-value gaps.
Both are scriptable standalone (no Tavily); area-analysis is currently inline in
its route — extract a callable entry first. computer-use requires Browserbase, so
gate it like the search suite gates Tavily.
