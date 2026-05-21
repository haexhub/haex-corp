# Changelog

## [0.20.0](https://github.com/haexhub/specifyr/compare/v0.19.0...v0.20.0) (2026-05-21)


### Features

* Phase 5a — step-chat on browser-MCP ([#91](https://github.com/haexhub/specifyr/issues/91)) ([046ffdc](https://github.com/haexhub/specifyr/commit/046ffdc762e2849f19a9ffaf229736599866b509))


### Bug Fixes

* **app:** unblock platform admin navigation ([#89](https://github.com/haexhub/specifyr/issues/89)) ([eba45da](https://github.com/haexhub/specifyr/commit/eba45daed2b7712fd18c187614b01bf81f76a6a6))

## [0.19.0](https://github.com/haexhub/specifyr/compare/v0.18.0...v0.19.0) (2026-05-19)


### Features

* **api:** code search endpoint via ripgrep ([#81](https://github.com/haexhub/specifyr/issues/81)) ([72f4684](https://github.com/haexhub/specifyr/commit/72f4684eec951b41d149f55f3af029e15fd62e03))
* **api:** publish + read-public-state endpoints (Tasks 1.6 + 1.7) ([#84](https://github.com/haexhub/specifyr/issues/84)) ([6463c93](https://github.com/haexhub/specifyr/commit/6463c93056c300a307bd257a1453778a3c144725))
* **api:** read project file endpoint (Task 1.3) ([#80](https://github.com/haexhub/specifyr/issues/80)) ([1883373](https://github.com/haexhub/specifyr/commit/1883373d10994dae1009ee49e1b9c0fe19abceb2))
* **api:** spec-draft CRUD endpoints (Task 1.5) ([#82](https://github.com/haexhub/specifyr/issues/82)) ([1ae0cf3](https://github.com/haexhub/specifyr/commit/1ae0cf3f2422028df358a526f8d8f5665bfd5f39))
* browser-side Speckit agent — Phase 1 kickoff (Tasks 1.1 + 1.2) ([#79](https://github.com/haexhub/specifyr/issues/79)) ([9f8a4c3](https://github.com/haexhub/specifyr/commit/9f8a4c393d3ac6ae01c842b88e10636c9d8491c2))
* **chat:** keep-alive ACP sessions + workflow-aware recovery ([#76](https://github.com/haexhub/specifyr/issues/76)) ([67dfd68](https://github.com/haexhub/specifyr/commit/67dfd68cfe3135bacde755a7c9dd2d65e8eaf12a))
* **speckit:** Phase 2 — browser-side spec agent (UI + stores + tools) ([#86](https://github.com/haexhub/specifyr/issues/86)) ([ef1d53b](https://github.com/haexhub/specifyr/commit/ef1d53b22fd81300a2b89b0591427f72c78dfdeb))

## [0.18.0](https://github.com/haexhub/specifyr/compare/v0.17.0...v0.18.0) (2026-05-15)


### Features

* **secrets:** per-agent allowlist + Postgres-backed storage ([#72](https://github.com/haexhub/specifyr/issues/72)) ([3932982](https://github.com/haexhub/specifyr/commit/39329821266958ee64e5e6c6b91cb103dfdff905))


### Bug Fixes

* **tests:** refresh per-org-schema assertions after secrets feature ([#74](https://github.com/haexhub/specifyr/issues/74)) ([eb7dc3a](https://github.com/haexhub/specifyr/commit/eb7dc3a39c513081e5ba12d10a97cfb397cd33fb))

## [0.17.0](https://github.com/haexhub/specifyr/compare/v0.16.0...v0.17.0) (2026-05-15)


### Features

* org-scoped projects + per-project membership ([#70](https://github.com/haexhub/specifyr/issues/70)) ([9bbc0dc](https://github.com/haexhub/specifyr/commit/9bbc0dcf2f0a7048cdd4783311c937c7a9f8c1ef))

## [0.16.0](https://github.com/haexhub/specifyr/compare/v0.15.0...v0.16.0) (2026-05-14)


### Features

* **repo:** per-project git remote sync ([#68](https://github.com/haexhub/specifyr/issues/68)) ([8d5a15b](https://github.com/haexhub/specifyr/commit/8d5a15b9696acd6373043afff197eee0e66e1ca4))
* **ui:** collapsible sidebars with mobile overlay drawers ([#67](https://github.com/haexhub/specifyr/issues/67)) ([c81b478](https://github.com/haexhub/specifyr/commit/c81b4784392caf9560fae5979b22e67790f74e72))

## [0.15.0](https://github.com/haexhub/specifyr/compare/v0.14.0...v0.15.0) (2026-05-14)


### Features

* **admin:** platform admin overview with shared tabs layout ([#64](https://github.com/haexhub/specifyr/issues/64)) ([bc1ce7c](https://github.com/haexhub/specifyr/commit/bc1ce7cbc2f56eb68fbcc1b42949209febd37ba9))


### Bug Fixes

* **ui:** align sidebar and content header heights ([#65](https://github.com/haexhub/specifyr/issues/65)) ([ac97154](https://github.com/haexhub/specifyr/commit/ac97154d420dfa93667e2ce0cb86361862ab53c6))

## [0.14.0](https://github.com/haexhub/specifyr/compare/v0.13.1...v0.14.0) (2026-05-13)


### Features

* **vault:** phase 1 data layer for agent vault ([#62](https://github.com/haexhub/specifyr/issues/62)) ([4a06c30](https://github.com/haexhub/specifyr/commit/4a06c30e95a986d41f74a0cdb6fbdb0860c8905a))

## [0.13.1](https://github.com/haexhub/specifyr/compare/v0.13.0...v0.13.1) (2026-05-13)


### Bug Fixes

* **dev+speckit:** unblock dev stack, restore workflow context, delete sessions ([#59](https://github.com/haexhub/specifyr/issues/59)) ([adfd965](https://github.com/haexhub/specifyr/commit/adfd96582393135f6dca8d6db6f427f79fe47ed2))

## [0.13.0](https://github.com/haexhub/specifyr/compare/v0.12.0...v0.13.0) (2026-05-13)


### Features

* **security:** route Anthropic api_key through proxy (V2 partial) ([#56](https://github.com/haexhub/specifyr/issues/56)) ([29b1fac](https://github.com/haexhub/specifyr/commit/29b1fac89f78523edf71cb068694b53bf271dafa))

## [0.12.0](https://github.com/haexhub/specifyr/compare/v0.11.1...v0.12.0) (2026-05-13)


### Features

* **deploy:** wire claude-proxy to DB-backed credentials + RLS role ([#49](https://github.com/haexhub/specifyr/issues/49)) ([2cfbf43](https://github.com/haexhub/specifyr/commit/2cfbf4338cb3dce86a1fafffb68e8fd2b1c981d3))
* **runner:** default resource quotas + per-company docker network ([#48](https://github.com/haexhub/specifyr/issues/48)) ([0920e4f](https://github.com/haexhub/specifyr/commit/0920e4f5172f3c3893fe189c2b0b1ccc72d8bd50))

## [0.11.1](https://github.com/haexhub/specifyr/compare/v0.11.0...v0.11.1) (2026-05-13)


### Bug Fixes

* **ui:** use Input/Button instead of ShadcnInput/ShadcnButton ([#44](https://github.com/haexhub/specifyr/issues/44)) ([479c0a4](https://github.com/haexhub/specifyr/commit/479c0a4434f31d9651aa7add1ab505f90df24149))

## [0.11.0](https://github.com/haexhub/specifyr/compare/v0.10.2...v0.11.0) (2026-05-12)


### Features

* **oauth:** persist anthropic credentials encrypted in DB, drop FS mount ([#42](https://github.com/haexhub/specifyr/issues/42)) ([3f1a96a](https://github.com/haexhub/specifyr/commit/3f1a96a7f5de8004d1d6b6f69d5a2336461be636))

## [0.10.2](https://github.com/haexhub/specifyr/compare/v0.10.1...v0.10.2) (2026-05-12)


### Bug Fixes

* **prod:** ship node_modules and surface real errors on turn POST ([#40](https://github.com/haexhub/specifyr/issues/40)) ([b70d2a6](https://github.com/haexhub/specifyr/commit/b70d2a60a8b10f982c8bd6705c7383f35db3eaa6))

## [0.10.1](https://github.com/haexhub/specifyr/compare/v0.10.0...v0.10.1) (2026-05-12)


### Bug Fixes

* **ci:** pin qemu-v9.2.2 binfmt to unblock arm64 builds ([#39](https://github.com/haexhub/specifyr/issues/39)) ([a4b0821](https://github.com/haexhub/specifyr/commit/a4b0821f44ab1bfeae42a791b7e033d68632cb89))
* **docker:** update migrations path after server refactor ([#37](https://github.com/haexhub/specifyr/issues/37)) ([f4e67a7](https://github.com/haexhub/specifyr/commit/f4e67a7fd6370b64e93e9a8972cae314b0f17332))

## [0.10.0](https://github.com/haexhub/specifyr/compare/v0.9.0...v0.10.0) (2026-05-12)


### Features

* **speckit:** add Google/Gemini as a native provider option ([#34](https://github.com/haexhub/specifyr/issues/34)) ([646c715](https://github.com/haexhub/specifyr/commit/646c715268c0d15fe3628a0ab44f89502373b6e5))

## [0.9.0](https://github.com/haexhub/specifyr/compare/v0.8.0...v0.9.0) (2026-05-10)


### Features

* **docker:** install ACP runner binaries, Claude Code CLI, and speckit-company extension ([#28](https://github.com/haexhub/specifyr/issues/28)) ([8b10e12](https://github.com/haexhub/specifyr/commit/8b10e1244c2ddaad3c35140faa4b3620f66f2252))
* dynamic model selection dropdown via provider API ([#29](https://github.com/haexhub/specifyr/issues/29)) ([24440b5](https://github.com/haexhub/specifyr/commit/24440b50bc12dd8c3ecf7d00b96064d6d6cf99f7))


### Bug Fixes

* **acp:** migrate to claude-agent-acp binary, add spawn error handling and newSessionMeta forwarding ([#27](https://github.com/haexhub/specifyr/issues/27)) ([c9badd9](https://github.com/haexhub/specifyr/commit/c9badd909a9e63ee06d221a90c1937bcd88d8c2e))
* **ui:** use i18n locale in date formatting to prevent SSR hydration mismatch ([#26](https://github.com/haexhub/specifyr/issues/26)) ([8c319ff](https://github.com/haexhub/specifyr/commit/8c319ff02a0d697d58379af6c5d09a70318c87df))

## [0.8.0](https://github.com/haexhub/specifyr/compare/v0.7.0...v0.8.0) (2026-05-09)


### Features

* per-owner agent profiles + multi-user dev stack ([#23](https://github.com/haexhub/specifyr/issues/23)) ([3eb5ac4](https://github.com/haexhub/specifyr/commit/3eb5ac4606564a0e54f2886b61ca3d051f7ba09b))

## [0.7.0](https://github.com/haexhub/specifyr/compare/v0.6.0...v0.7.0) (2026-05-08)


### Features

* **extensions:** bundled speckit-company + org-scoped extensions w/ delegated permission ([#19](https://github.com/haexhub/specifyr/issues/19)) ([d85e887](https://github.com/haexhub/specifyr/commit/d85e88734314bdf6f8a19617308db3f3e2445e4f))

## [0.6.0](https://github.com/haexhub/specifyr/compare/v0.5.0...v0.6.0) (2026-05-08)


### Features

* platform admin + mandatory-org + OAuth UX + cleanups ([#15](https://github.com/haexhub/specifyr/issues/15)) ([5324d6d](https://github.com/haexhub/specifyr/commit/5324d6d206a5ff7c398726596e189bf10f416059))
* **server:** zod input validation + clear all TS errors ([#18](https://github.com/haexhub/specifyr/issues/18)) ([b4ea712](https://github.com/haexhub/specifyr/commit/b4ea71242fd7db4ec71438f76049ab5753df5870))

## [0.5.0](https://github.com/haexhub/specifyr/compare/v0.4.0...v0.5.0) (2026-05-07)


### Features

* **auth:** logout button in sidebar + settings page ([cbf929e](https://github.com/haexhub/specifyr/commit/cbf929e428109b694646592ee79be526762cb067))
* **dev-auth:** testable logout flow without an IDP locally ([9524326](https://github.com/haexhub/specifyr/commit/9524326df3d148179637975455091e21110eba3c))
* **llm-creds:** drop default_model, add OpenRouter provider ([f61ea12](https://github.com/haexhub/specifyr/commit/f61ea12d16ce8c8d4076680ce062cd95cc5812e6))
* **llm-creds:** phase 4 — encrypted personal API key store + UI ([6a5deb1](https://github.com/haexhub/specifyr/commit/6a5deb18e8ecf3ea562f5c15a9941cf79672752a))
* **llm:** multi-tenant LLM credentials + Claude OAuth flow (phases 5/6/8) ([e3aa395](https://github.com/haexhub/specifyr/commit/e3aa3951f97eb2ae3d92be0bd201ce81ac2284ad))
* **oauth:** org-level Claude OAuth flow (phase 9) ([9882a46](https://github.com/haexhub/specifyr/commit/9882a46a92477220aba6c21b169aa175bff3e914))
* **runner:** wire personal LLM credentials into agent env injection ([7f15d07](https://github.com/haexhub/specifyr/commit/7f15d078364fb07a519fdce7d7da95b41297407b))


### Bug Fixes

* **dev-auth:** hide Sign-in button when SPECIFYR_DEV_USER_EMAIL unset ([b5b252a](https://github.com/haexhub/specifyr/commit/b5b252a42f00eaaa11183b7ce71f98b228805792))

## [0.4.0](https://github.com/haexhub/specifyr/compare/v0.3.0...v0.4.0) (2026-05-06)


### Features

* **auth:** support both Authentik and Authelia forward-auth headers ([41a3c4f](https://github.com/haexhub/specifyr/commit/41a3c4fdae33b24a0d9a8895857167149a39bd7c))

## [0.3.0](https://github.com/haexhub/specifyr/compare/v0.2.0...v0.3.0) (2026-05-06)


### Features

* **auth:** phase 1 — users table + Authelia header middleware ([b3134a9](https://github.com/haexhub/specifyr/commit/b3134a93f4516e06329e60cb59f0f9689308011b))
* **db:** phase 0 — Drizzle/Postgres skeleton, optional at runtime ([c9ce21b](https://github.com/haexhub/specifyr/commit/c9ce21b632fa763af2738a3fae903b2bb8669453))
* **orgs:** phase 3 — orgs, memberships, invitations + settings UI ([777ca80](https://github.com/haexhub/specifyr/commit/777ca804018df790547645e62221b9c8ea227b30))
* **projects:** phase 2 — DB-tracked project ownership ([7ee0c73](https://github.com/haexhub/specifyr/commit/7ee0c73fc6ceff5e50ea8654c536a9410ec80aa3))


### Bug Fixes

* **layout:** keep global sidebar (compact) inside project view ([0f67388](https://github.com/haexhub/specifyr/commit/0f673880a368d3c7604af0cda3a4c1c10262d9ea))

## [0.2.0](https://github.com/haexhub/specifyr/compare/v0.1.0...v0.2.0) (2026-05-06)


### Features

* **acp:** AcpRunner — pass-through SessionUpdates from any ACP agent ([75e0ff0](https://github.com/haexhub/specifyr/commit/75e0ff01976d91ca59187a2d0057a6d53d66cece))
* **acp:** add @agentclientprotocol/sdk dependency and typedef scaffold ([ccd6287](https://github.com/haexhub/specifyr/commit/ccd6287c584d818e203f18b36f7199a00575a8ae))
* **acp:** approval transport bridges session/request_permission ([c3e1e79](https://github.com/haexhub/specifyr/commit/c3e1e79043d6a1bee4c1dd86c10df3b657366e02))
* **acp:** bridge session/request_permission to CapabilityApprovalService ([b50e947](https://github.com/haexhub/specifyr/commit/b50e947f0cfc8220f786bbad65478298133dbc63))
* **acp:** cwd-scoped fs/read_text_file and fs/write_text_file ([b92769c](https://github.com/haexhub/specifyr/commit/b92769c1d1cb64cdf0ef42e4235da1d33f76a45e))
* **acp:** encode/decode composite session-id ([adb6442](https://github.com/haexhub/specifyr/commit/adb6442f51b4ae906b85054ab3097c736507ac7c))
* **acp:** session/new resolves slug from cwd; session/load validates existence ([fa4fb42](https://github.com/haexhub/specifyr/commit/fa4fb42c114a6d18cbcbfaf744613367de60551f))
* **acp:** session/prompt bridges TurnBroker SessionUpdate to client; cancel forwards ([037efaf](https://github.com/haexhub/specifyr/commit/037efaf72162bddc2f120067763361f69a4ff9a7))
* **acp:** specifyr-acp stdio entrypoint with initialize handshake ([711cfb0](https://github.com/haexhub/specifyr/commit/711cfb0a8f1edf0cac605549c03e2c56b1ce7b91))
* **acp:** wire AcpRunner into RunScheduler fallback chain (acp:gemini default head) ([a725d94](https://github.com/haexhub/specifyr/commit/a725d949462746b49696f779c3c0853bd07c7d7d))
* **acp:** wire real TurnBroker + runner factory into stdio entrypoint ([4087143](https://github.com/haexhub/specifyr/commit/4087143a166a1863a77ba1373b6c00051553f7c5))
* **agents:** Nix-based per-agent Docker images and project secrets ([#7](https://github.com/haexhub/specifyr/issues/7)) ([73cd982](https://github.com/haexhub/specifyr/commit/73cd982c54bfd56b49728ae445b7a085205f3abb))
* **artifact-viewer:** mermaid rendering, dir file picker, Select component; fix gitignore for projects/ path ([65d2602](https://github.com/haexhub/specifyr/commit/65d26026c60ce027666a461e41d22bb01b1cc42b))
* **chat:** markdown rendering, stop button, loading indicator, 409 error + session fixes ([#1](https://github.com/haexhub/specifyr/issues/1)) ([abf0ba7](https://github.com/haexhub/specifyr/commit/abf0ba71695e9944a09e7d09d353dc50a7a3ce4d))
* **chat:** reasoning display, copy button, animation fix ([137c47a](https://github.com/haexhub/specifyr/commit/137c47a14a6f77cb8e3e62c7473ceb1b2244aacf))
* **chat:** session reset retry, auto-complete step, workflow context injection ([62c83b5](https://github.com/haexhub/specifyr/commit/62c83b5e990baf26e8b3f7d7fbd281f30e7e0957))
* **chat:** session reset retry, workflow context injection, localStorage session persistence ([#6](https://github.com/haexhub/specifyr/issues/6)) ([5b84e9f](https://github.com/haexhub/specifyr/commit/5b84e9fdf5b96ecd4e57a535ed58b7beaeccf726))
* **claude-code:** translate stream-json to SessionUpdate at the runner boundary ([3a0bfe7](https://github.com/haexhub/specifyr/commit/3a0bfe7602da8eda10b728a01204c37184bc041b))
* **data-dirs:** configurable data directories via env vars ([3ab98e2](https://github.com/haexhub/specifyr/commit/3ab98e24c70ebe156314138ba028fd6ef9bcddbc))
* **data-dirs:** configurable data directories, artifact viewer improvements, step UI cleanup ([e1c3975](https://github.com/haexhub/specifyr/commit/e1c39755eb0e8c97a3ae31d5e66055185ae67bfe))
* **extensions:** split hidden commands into separate Utility Commands section ([f36db81](https://github.com/haexhub/specifyr/commit/f36db8195cebba9a41af745fc9650eb201cfac93))
* **hermes-streaming:** emit ACP SessionUpdate via shared adapter ([b03dcfa](https://github.com/haexhub/specifyr/commit/b03dcfa0483c5a51f4c69c71b74360e1f53f772d))
* **i18n:** internationalize UI, rename favorites, deselect by default ([#4](https://github.com/haexhub/specifyr/issues/4)) ([f132004](https://github.com/haexhub/specifyr/commit/f1320041898179b1098f8c43478edcf46c1b32c4))
* **logo:** add SpeculossLogo component ([747976f](https://github.com/haexhub/specifyr/commit/747976f81e8da8b64cd6426768c65e0829a34b64))
* **logo:** use SpeculossLogo on index page, add large variant ([d5e181a](https://github.com/haexhub/specifyr/commit/d5e181a0c2f69a28f326841c047a8107359a0437))
* **rebrand:** rename haex-corp → speculoss ([#5](https://github.com/haexhub/specifyr/issues/5)) ([eb4395c](https://github.com/haexhub/specifyr/commit/eb4395c3e67b00d21eaf0f09960d4f1396f31aaf))
* **rebrand:** rename haex-corp → speculoss across all files ([4f5fc4e](https://github.com/haexhub/specifyr/commit/4f5fc4e7294666b9fedfe5259847bba6b1b95639))
* **runners:** group per-project agents as a Docker compose stack via labels ([9a3a050](https://github.com/haexhub/specifyr/commit/9a3a0509b2d388a3c1f592fcc561ee7dc2acd190))
* **runners:** output adapter from Claude stream-json to ACP SessionUpdate ([3cdcd5a](https://github.com/haexhub/specifyr/commit/3cdcd5af59b3460c9db1a172ff323fa14e9ab9a3))
* **runners:** remove HermesCliRunner — superseded by streaming + ACP ([c754f92](https://github.com/haexhub/specifyr/commit/c754f929ed544d3ca4601c0c98c8a909a791c7d6))
* **runtime:** persistent containers, live agent activity, hostProjectRoot, profile seeding ([66504e1](https://github.com/haexhub/specifyr/commit/66504e10bfafd9f806683dbf45d06882335bb92f))
* **server:** SSE streaming for company start, claude-proxy routing, HMR-safe registry ([7cfb530](https://github.com/haexhub/specifyr/commit/7cfb530184de29d68652c5a15ba699c3328a9abf))
* **session:** persist last active session per step in localStorage ([d53ed23](https://github.com/haexhub/specifyr/commit/d53ed23d18f9c99fbb9122b5f00933953b577ae4))
* **speckit-company:** SPECULOOS_HOME runtime separation, agent workspace skill ([438f605](https://github.com/haexhub/specifyr/commit/438f6054560ce83f6c611e08c933bd4afbb4eb86))
* **steps:** remove step locking, StepInfoBanner, manual complete button, and artifact auto-complete ([53129a9](https://github.com/haexhub/specifyr/commit/53129a9246757b97d79c63ff9cfbbeb7ea92bd9b))
* **turn-broker:** persist runner output as ACP SessionUpdate (event:'session_update') ([2d76331](https://github.com/haexhub/specifyr/commit/2d763317ae5d2683f0507322abe56f084772b0e8))
* **turn-broker:** replay last 10 messages when retrying after expired session ([01cfb14](https://github.com/haexhub/specifyr/commit/01cfb14cbff0c892cf6e4300a7d0652a889c7fe4))
* **ui:** consume ACP SessionUpdate over SSE; adapter translates thinking → agent_thought_chunk ([a2366d4](https://github.com/haexhub/specifyr/commit/a2366d4b692da06e5ec5bcf6ba6d9d789abb7351))
* **ui:** runtime task dispatch, agent task board, history view; remove step locking ([efc15dc](https://github.com/haexhub/specifyr/commit/efc15dcac2f25ebfe35c21997546e1a0fde9fe5a))
* **workflow-discovery:** support hidden:true on extension commands ([ea3b6b6](https://github.com/haexhub/specifyr/commit/ea3b6b6a189b51109d276a3b87f7713d9b1d4a81))


### Bug Fixes

* **acp:** include optional kind/rawInput/rawOutput/locations on AcpToolCall typedef ([bd9c5f4](https://github.com/haexhub/specifyr/commit/bd9c5f43c57715544e1fce272f1909452fdf2de0))
* **acp:** wire CAS.transports[] into decision flow; unbound notify returns undefined ([6cafa83](https://github.com/haexhub/specifyr/commit/6cafa83ae2fa45ca555e94396a0d1008d37d0ce4))
* **alias:** use absolute path for #su Nitro alias, add TS path mapping ([7d1bba1](https://github.com/haexhub/specifyr/commit/7d1bba118badd2502c50e6b7ee31a038b7bdd171))
* **extensions:** fall back to spec-kit .registry when extensions.json missing ([4dfeaff](https://github.com/haexhub/specifyr/commit/4dfeaff275dae5ab4c6c7fb610e32bebc276313d))
* **extensions:** fall back to spec-kit .registry when extensions.json missing ([77a550e](https://github.com/haexhub/specifyr/commit/77a550ecd827f5c27e99a1e90d3f2be66566500e))
* **logo:** restore PNG logo and public directory ([b3df790](https://github.com/haexhub/specifyr/commit/b3df790e189449148089a346826261cddc1d37c8))
* **logo:** use spekulatius cookie SVG from favicon ([92bbfe2](https://github.com/haexhub/specifyr/commit/92bbfe2249004e4691e8167b3b739f943d35104a))
* **orchestrator:** pass dataDir() instead of process.cwd() to SpecOrchestrator ([de94b51](https://github.com/haexhub/specifyr/commit/de94b51ca9d1db94bafcf8acd346460c07174b1f))
* **runner:** allow Bash tool in headless project sessions ([eb4bd9b](https://github.com/haexhub/specifyr/commit/eb4bd9b5f00899b47a1e20b1fcfd506fe73fefbd))
* **server:** restore data-dir imports broken by specops-stores re-export removal ([3b5426a](https://github.com/haexhub/specifyr/commit/3b5426af35931db91e7c7a14d86e968878dd1bbf))
* **turn-broker:** surface resume failures as errors and clear expired session IDs ([0438e59](https://github.com/haexhub/specifyr/commit/0438e5998f88e8e4c29377938eb298f7025c020e))
* **types:** resolve TS errors introduced during branch merge ([7dd54e6](https://github.com/haexhub/specifyr/commit/7dd54e6a6dc431d156dc5b76bfc0db63acb6d4fd))
* **ui:** scaffold missing shadcn Input component ([0f93ec4](https://github.com/haexhub/specifyr/commit/0f93ec4fd53e13bff12618d7ec2385d42cdf4a76))
* **watch:** anchor chokidar to project root to detect new .specify/ dirs ([0c3dd57](https://github.com/haexhub/specifyr/commit/0c3dd579f6411c5d6a1992ab191d8a8c643812cb))
* **watch:** anchor chokidar to project root to detect new .specify/ dirs ([a963151](https://github.com/haexhub/specifyr/commit/a96315100b76a69fe3f51e662708825583abf387))


### Reverts

* remove hidden command machinery — not needed, use provides.commands as workflow step list ([a0ff35d](https://github.com/haexhub/specifyr/commit/a0ff35d5bda2fa5cff1ed389af7629c442fe92ec))
