# Evidence

Raw output from real runs, committed rather than retyped, so a reader can
compare what the README claims against what the commands actually printed.

| File | Command | Shows |
|---|---|---|
| `blindspot.txt` | `npm run blindspot -- c_msvllpds1n1dcoz8qx` | nine real checks passing a price wrong by 10x, then the witness disagreeing |
| `benchmark.txt` | `npm run benchmark` | the Drift Discrimination Score across six live cases |

Both hit live Bright Data and the deployed fixture, so re-running them will
produce fresh timestamps and ids. The numbers should not move.

`../../evals/dds.json` carries the same benchmark run in machine-readable form,
including every sensor reading and every method's verdict per case.
