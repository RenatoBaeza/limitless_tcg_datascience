# Machine Learning Project Ideas for PKTCG DuelMeta

Ideas based on the schema described in `AGENTS.md`. The database itself was not queried, so data sizes come from the docs.

## What the data offers

- **Bronze:** the full history since `MIN_TOURNAMENT_DATE`. It has about 290k pairings, plus standings with placement, deck, country, and drop.
- **Silver:** one row per match, restated as winner/loser with both decks joined. It covers a rolling 6-month window.
- **Gold:** aggregates only. These are too coarse for most ML, so train from silver or bronze.

## Prediction

1. **Match outcome predictor.** Given deck A vs deck B (plus round, phase, and tournament size), predict win, loss, or tie. Start with logistic regression on deck-pair features and compare it against gradient boosting. The baseline to beat is the matchup win-rate table you already compute.
2. **Player skill rating (Elo / Glicko / TrueSkill / Bradley-Terry).** Rate players from pairings, then test whether adding deck matchup effects improves prediction. Splitting "player skill" from "deck strength" is the interesting result.
3. **Tournament placement predictor.** Predict a player's final placement or whether they make top cut. Use their deck, early-round results, and tournament size.
4. **Drop prediction.** Predict whether a player drops, using standings `drop`, round-by-round record, and deck.

## Meta-game modeling

5. **Meta share forecasting.** Forecast each deck's share for next week or month using time series (Prophet, ARIMA, or an LSTM). The `3d/7d/30d` periods give you labels. You'd need to rebuild the time series from silver at weekly grain.
6. **Deck archetype clustering.** Cluster decks by their matchup vectors, meaning each deck's win-rate profile against the field. Use k-means, hierarchical clustering, or UMAP. Check whether the clusters look like aggro, control, and so on. Plot the result on the frontend.
7. **Rock-paper-scissors cycle detection.** Treat the antisymmetric matchup matrix as a directed graph. Use eigen/SVD decomposition to find the transitive "strength" component versus the cyclic component. This also tells you how skill-expressive the format is.
8. **Meta-shift and breakout detection.** Run change-point detection on deck share and win rate to flag new releases or ban-driven shifts automatically.

## Recommendation / decision tools

9. **"Best deck to bring" recommender.** Given an expected field (a share distribution), pick the deck that maximizes expected score. This is a matrix-game problem. Solve for the Nash-optimal mix, and add a risk-aware pick using the Wilson intervals.
10. **Counter-pick finder.** For deck X, rank the best answers weighted by match count and confidence. Gold already gets you most of the way, so this is mostly UI plus a model on top.
11. **Matchup completion.** Many deck_a x deck_b cells have few matches. Use matrix factorization or an empirical-Bayes shrinkage model to fill them in, and validate by holding out cells. This is a good first ML project, and it directly improves what the frontend shows.

## Player and geography

12. **Player archetype clustering.** Cluster players by deck loyalty, versatility, and performance.
13. **Country and region analysis.** Look at deck preferences and performance by `country`, and test whether regional metas are statistically distinct.
14. **Anomaly detection on results.** Flag suspicious tournaments, such as unfinished pairings, odd win streaks, or improbable results given player ratings. This extends the `MIN_TOURNAMENT_MATCHES` heuristic with a model.

## Suggested order

Start with **#11** (matchup shrinkage) or **#2** (player ratings). They're small and give measurable results. Then do **#1**, using those outputs as features. **#9** makes a good showcase feature on the client.

## Things to watch

- **Leakage:** split train and test by date, not randomly.
- **Ties:** about 6% of matches are ties. Filter on `is_tie` first, or model them as a third class.
- **Mirrors:** these are excluded in gold but present in silver.
- **Unknown decks:** about 4% of rows have a null deck.
- **Window:** silver only keeps 6 months. For longer training histories, rebuild features from bronze.
