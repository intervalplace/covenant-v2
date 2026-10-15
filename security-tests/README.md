# Security tests

Proof-of-concept tests for every issue found in the contract review rounds
(each one re-runs the attack against the fixed contract), plus the
front-running binding, self-settle and executor-service flows. They run the
real contract, the app's own order code (`covenant-frontend/src`) and the
real namespace/executor code on a local anvil chain.

```bash
cd security-tests
npm install
./run.sh            # all suites; or ./run.sh review
```

Needs Foundry's `anvil` on PATH. `covenant-executor` must have had
`npm install` for the `exec` suite.

| Suite | Checks | What |
|---|---|---|
| review | 54 | every review finding, rounds 1–4 |
| bind | 25 | front-running protection end to end |
| selfsettle | 19 | settling from your own wallet, races with executors |
| exec | 8 | the executor service against a mock AON node |

The mainnet-fork rehearsal (`covenant-frontend`: `npm run rehearse`) is the
separate pre-deploy check against real WETH, USDT and Chainlink.
