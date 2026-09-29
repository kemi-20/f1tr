# Third-Party Notices

F1 Race Engineer is licensed under [MIT](LICENSE). This file identifies prominent third-party components and assets used by the application. It is not an exhaustive software bill of materials or a grant of rights to third-party trademarks and data. Exact dependency versions are in `package-lock.json` and `resources/dsh-runtime/package-lock.json`.

## Bundled software

| Component | Version checked | License declaration | Source / license text |
| --- | --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`@deepseek-ai/dsh`, `dsh-compaction-basic`, `dsh-llm-pi-ai`, `dsh-token-meter`) | `0.2.0-rc.1` | MIT | Each installed package includes `LICENSE` in `resources/dsh-runtime/node_modules/@deepseek-ai/` |
| [pi-ai](https://github.com/earendil-works/pi) (via DSH's OpenAI Completions adapter) | `0.85.1` in the pinned runtime | MIT | `resources/dsh-f1-plugin/PI-LICENSE.txt`; CI includes its text in the slim provider's `THIRD_PARTY_LICENSES.txt` |
| [Electron](https://www.electronjs.org/) | `44.0.0` | MIT; includes Chromium and other separately licensed components | Electron distribution license files and Chromium notices; verify their presence in release artifacts |
| [`@z0mt3c/f1-telemetry-client`](https://www.npmjs.com/package/@z0mt3c/f1-telemetry-client) | `2.1.0` | MIT | Installed package license |
| React, React DOM, react-markdown, remark-gfm, zustand, electron-store, electron-log, nanoid | See root lockfile | MIT as declared by the installed package manifests checked for this notice | Individual package license files and upstream repositories |

DSH is a third-party project by DeepSeek. This application bundles and configures a pinned copy; it is not the official DeepSeek Harness desktop client. DSH and its dependencies retain their own copyright and license notices. The F1-specific DSH plugin under `resources/dsh-f1-plugin/` is project code covered by the repository MIT license, except for any separately attributed material.

## Game-related data and marks

- `src/track_maps/*.json` contains calibrated circuit map data derived from a local extraction of Project Aeternum (Simracing Centre). The repository currently has no verified redistribution license for that source data. **This notice is attribution, not permission to redistribute it.** Rights must be cleared or the data replaced before treating public redistribution of these assets as authorized.
- `src/renderer/assets/team-logos/*.png` contains team identifiers. Individual image origins and redistribution permissions have not been documented or verified. Team names and marks belong to their respective owners; their presence does not imply endorsement.
- Formula 1, F1, game titles and team names are used descriptively. This project is independent of Formula 1, its teams, and the game publisher.

If a third-party notice or asset attribution is missing or inaccurate, please open an issue with the specific file and rights information. Do not assume an asset is MIT-licensed merely because the surrounding application code is MIT-licensed.
