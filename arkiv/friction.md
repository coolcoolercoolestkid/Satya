# Arkiv friction log

Real problems we hit while building Satya on Arkiv, written down as they happened.

| When (IST, 6 Nov 2026) | What happened | What we did |
|---|---|---|
| 16:55 | `rabdi()` throws `MissingAccessKeyError` if called with no argument. Reading public data needs `rabdi({ accessKey: "" })` explicitly, which then logs a rate-limit warning on every client. | Pass `accessKey: ""` everywhere and make the key optional in our config. |
| 17:05 | No way to create many entities in one transaction from the SDK (`createEntity` only). Our registry is 256 records per source, so a full publish is 256 transactions per list. | Six transactions in flight at once with viem's `nonceManager`. |
| 17:08 | `u64` columns don't accept a plain `bigint`; it must be wrapped with `u64(…)`, unlike `str` columns which take a plain string. TypeScript caught it, but the README example doesn't show a `u64` write. | Wrapped values with `u64()`. |
| 17:10 | `str` values are capped at 128 bytes and an entity at 128 KB. Fine for us (a full MetaMask bucket is about 15 KB), but it means a list can't be stored as one record. | Split each list into 256 hash buckets, which we wanted anyway for privacy. |
| 17:12 | The testnet faucet only lets you claim by signing in with a browser wallet. A script's wallet (a key in a .env file) can't claim directly. | Claim with a personal wallet and send the tGLM to the publisher address. |
| 17:44 | After a faucet claim (and two earlier transfers) the publisher wallet still showed 0 tGLM on Rabdi for over 15 minutes, with all Arkiv services reported online. We couldn't tell from the faucet page whether the claim had gone through or where the tokens went. | The faucet transfer did arrive (10 tGLM, block 290842), but well after the page said "success". We now wait for the balance on-chain before publishing. |
