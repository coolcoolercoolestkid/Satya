# CRE simulator output

Command: `cre workflow simulate site-facts --target staging-settings --non-interactive --trigger-index 0 --http-payload '{"domain":"<domain>"}'`

## uniswap.org

```
Binary hash: 08d0fe5a39464eb45181ea488cad4b94654aabfcad67b41adb60b0fdb60ae244
Config hash: 9d97d5fb1a80b6882f6e4b399a0deb4c033da0369dc980b76482ff75810f1012
2026-11-07T04:49:36Z [SIMULATION] Simulator Initialized
2026-11-07T04:49:36Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
2026-11-07T04:49:36Z [USER LOG] Looking up uniswap.org on every node
2026-11-07T04:49:41Z [USER LOG] {"domain":"uniswap.org","checkedAt":"2026-11-06T23:19:41.000Z","facts":{"registered":"2018-11-26","oldestValidCertificate":"2026-08-14","firstArchived":"2011-09-26","resolves":true},"score":80,"signals":[{"points":20,"reason":"Domain is 5+ years old"},{"points":10,"reason":"Internet Archive has seen it for 10+ years"}],"agreedBy":"Chainlink DON consensus (median of every node's independent lookup)"}
✓ Workflow Simulation Result:
2026-11-07T04:49:41Z [SIMULATION] Execution finished signal received
2026-11-07T04:49:41Z [SIMULATION] Skipping WorkflowEngineV2
```

## 473621.com

```
Binary hash: 08d0fe5a39464eb45181ea488cad4b94654aabfcad67b41adb60b0fdb60ae244
Config hash: 9d97d5fb1a80b6882f6e4b399a0deb4c033da0369dc980b76482ff75810f1012
2026-11-07T04:49:55Z [SIMULATION] Simulator Initialized
2026-11-07T04:49:55Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
2026-11-07T04:49:55Z [USER LOG] Looking up 473621.com on every node
2026-11-07T04:50:00Z [USER LOG] {"domain":"473621.com","checkedAt":"2026-11-06T23:20:00.000Z","facts":{"registered":"2026-10-26","oldestValidCertificate":"2026-10-26","firstArchived":null,"resolves":true},"score":25,"signals":[{"points":-25,"reason":"Domain registered only 11 days ago"}],"agreedBy":"Chainlink DON consensus (median of every node's independent lookup)"}
✓ Workflow Simulation Result:
2026-11-07T04:50:00Z [SIMULATION] Execution finished signal received
2026-11-07T04:50:00Z [SIMULATION] Skipping WorkflowEngineV2
```

## check-entropy-verification.com

```
Binary hash: 08d0fe5a39464eb45181ea488cad4b94654aabfcad67b41adb60b0fdb60ae244
Config hash: 9d97d5fb1a80b6882f6e4b399a0deb4c033da0369dc980b76482ff75810f1012
2026-11-07T04:50:14Z [SIMULATION] Simulator Initialized
2026-11-07T04:50:14Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
2026-11-07T04:50:14Z [USER LOG] Looking up check-entropy-verification.com on every node
2026-11-07T04:50:18Z [USER LOG] {"domain":"check-entropy-verification.com","checkedAt":"2026-11-06T23:20:18.000Z","facts":{"registered":"2026-08-22","oldestValidCertificate":"2026-08-22","firstArchived":null,"resolves":false},"score":40,"signals":[{"points":-10,"reason":"Domain registered 76 days ago"},{"points":0,"reason":"Domain doesn't resolve in DNS (offline, or taken down)"}],"agreedBy":"Chainlink DON consensus (median of every node's independent lookup)"}
✓ Workflow Simulation Result:
2026-11-07T04:50:18Z [SIMULATION] Execution finished signal received
2026-11-07T04:50:18Z [SIMULATION] Skipping WorkflowEngineV2
```

