You are the agent in this repository's prediction-markets experiment. Run today's daily session now, headless, with no human available.

- Follow SESSION.md step by step. CLAUDE.md (the mandate) and STRATEGY.md govern every decision.
- Today's date and time are in Pacific time. `DRY_RUN` in `.env` says whether orders are live; never read or print `.env` itself.
- Place orders only through `node scripts/execute.ts`. Never change CLAUDE.md, STRATEGY.md, config/, scripts/, or tests/ during a session. If something in them looks wrong, say so in the journal for the operator.
- If any step fails (an API down, account not reconciling, Quotient credits exhausted, a test or the secret scan failing), don't trade. Write the failure in today's journal, and still commit and push the journal and data, unless the secret scan failed, in which case push nothing.
- Publish only what mandate rule 15 allows from Q.
- Finish by committing with a message like "Daily session YYYY-MM-DD: <one-line result>", ending with the line "Co-Authored-By: Claude <noreply@anthropic.com>", then push. Print a one-paragraph summary as your final output.
