# Evidence

Raw output from real runs, committed rather than retyped, so a reader can
compare what the README claims against what the commands actually printed.

| File | Command | Shows |
|---|---|---|
| `blindspot.txt` | `npm run blindspot -- c_msvllpds1n1dcoz8qx` | nine real checks passing a price wrong by 10x, then the witness disagreeing |
| `benchmark.txt` | `npm run benchmark` | the Drift Discrimination Score across six live cases |
| `scrapling-comparison.txt` | `python docs/evidence/scrapling-comparison.py` | adaptive relocation succeeding on a rename and returning the wrong value on semantic drift |
| [`lifecycle/`](lifecycle/) | `npm run evidence` | the whole loop as ten raw artifacts: a page broken for real, Bright Data returning the wrong date from it successfully, the verdict, and what a consumer received instead |

Both hit live Bright Data and the deployed fixture, so re-running them will
produce fresh timestamps and ids. The numbers should not move.

`../../evals/dds.json` carries the same benchmark run in machine-readable form,
including every sensor reading and every method's verdict per case.

`scrapling-comparison.py` needs `pip install scrapling` and no network: both
cases run against the DriftMart markup copied verbatim from
`driftmart/lib/modes.ts`. It is written to show the tool succeeding first,
because a comparison that only shows a competitor failing is not evidence, it is
an advert.
