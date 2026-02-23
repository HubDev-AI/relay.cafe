# Changelog

## [0.2.0](https://github.com/HubDev-AI/relay.cafe/compare/relay-cafe-api-v0.1.0...relay-cafe-api-v0.2.0) (2026-02-23)


### Features

* add /v1 API versioning and update privacy copy ([0f9e318](https://github.com/HubDev-AI/relay.cafe/commit/0f9e3180513c1d606074905f7a48365d8a4ef919))
* add /v1 API versioning sub-app to app.ts ([fa93ee8](https://github.com/HubDev-AI/relay.cafe/commit/fa93ee805392ce214bd188863d7b56a4c319530a))
* add DI container with Upstash/in-memory rate limiter selection ([f0bb388](https://github.com/HubDev-AI/relay.cafe/commit/f0bb38811adc35479d5f1beab07cd6400392ff82))
* add docker-compose for local Redis + update .env.example ([1fc9d55](https://github.com/HubDev-AI/relay.cafe/commit/1fc9d5516ef08ec7e88bbaf8fad6d443c8729302))
* add InMemoryRateLimiter with sliding window and tier support ([30ae619](https://github.com/HubDev-AI/relay.cafe/commit/30ae619896c77e775cf1bdaf206cd9712ae230b4))
* add IRateLimiter interface with tier support ([c6dc97d](https://github.com/HubDev-AI/relay.cafe/commit/c6dc97d4c88bbab73f090c4444dc47cb2647546a))
* add Sentry scrubbing, remove device_fingerprint, add translation telemetry ([#18](https://github.com/HubDev-AI/relay.cafe/issues/18)) ([17ffa1c](https://github.com/HubDev-AI/relay.cafe/commit/17ffa1cffd3550357b367818f16d45f845605834))
* add session token generation and HMAC hashing helpers ([7173202](https://github.com/HubDev-AI/relay.cafe/commit/7173202fff783eb8e211b5ecbdcbf2fab121ca84))
* add token_hash column to sessions for HMAC-based auth ([4cfdb43](https://github.com/HubDev-AI/relay.cafe/commit/4cfdb43c81045e95eb618f77c6ca3e61ad56d568))
* add UpstashRateLimiter adapter with 3-tier sliding window ([fc96690](https://github.com/HubDev-AI/relay.cafe/commit/fc966908ae208cb54a362c1169345bf87fd6f7b9))
* auth middleware uses HMAC hash lookup instead of UUID ([3a4086d](https://github.com/HubDev-AI/relay.cafe/commit/3a4086de080c9e449163f8bc11043bfdda4c7a89))
* configurable token periods, message expiration, db migration ([c635ce2](https://github.com/HubDev-AI/relay.cafe/commit/c635ce2333eb96233c02a2f6d3278f9f8d373e6a))
* error logging, KMS 50h retention + cleanup, drop delivered column, message layout ([2aea47b](https://github.com/HubDev-AI/relay.cafe/commit/2aea47b5f072b365436493225da86f1cde10a4fb))
* generate opaque session tokens with HMAC hash storage ([6436a85](https://github.com/HubDev-AI/relay.cafe/commit/6436a851888bb78f045ab469e5a7d62d80f1acf3))
* Redis rate limiting + HMAC session tokens ([563a354](https://github.com/HubDev-AI/relay.cafe/commit/563a354ec9a31b6ba832090f263db836ff69c725))
* rewrite rate limit middleware to use IRateLimiter interface ([c3a2adb](https://github.com/HubDev-AI/relay.cafe/commit/c3a2adb5f3ce7993f1ee8801ef037ebaff681bb2))
* wire Upstash rate limiting into all routes with 3 tiers ([84baebc](https://github.com/HubDev-AI/relay.cafe/commit/84baebc30a2a8c2c1f2495c4cf2c6d55cefc64d8))


### Bug Fixes

* add SESSION_SALT to .env.test, fix test flakiness and wrong assertion ([0a1f3dc](https://github.com/HubDev-AI/relay.cafe/commit/0a1f3dc02efb613330f6bc8b7f957180abbfacad))
* address HIGH/MEDIUM security audit findings (F-01, F-03, F-04, F-07) ([0712a4f](https://github.com/HubDev-AI/relay.cafe/commit/0712a4ff285f264b572a5ce08335b56b0f88dc81))
* apply backend code review fixes ([3fce741](https://github.com/HubDev-AI/relay.cafe/commit/3fce74112b2940b4fef02dae8f2daffafc46a24b))
* atomic receive flow + DELETE 204 handling ([e95dc8e](https://github.com/HubDev-AI/relay.cafe/commit/e95dc8e862d0aad119842bac57aa55141f53df83))
* delete useless smoke tests, add real behavior tests for receive ([620669d](https://github.com/HubDev-AI/relay.cafe/commit/620669db0636f725426e48fdd92b7ee0febc8612))
* entitlements, test quality, xcodeproj regen ([c8c94a8](https://github.com/HubDev-AI/relay.cafe/commit/c8c94a85830e893175859890b5b1df6d18bdf281))
* guard polling timer against background firing, add UTC reset comments ([42a5d60](https://github.com/HubDev-AI/relay.cafe/commit/42a5d60d05eaa4d968a1264aede3f5fb6cac8011))
* guard polling timer, document UTC reset model ([717b933](https://github.com/HubDev-AI/relay.cafe/commit/717b933f05e957d13cc08b4f244b0f1fedac0deb))
* KMS retention policy, auth transaction, send token rollback, flaky test ([a857638](https://github.com/HubDev-AI/relay.cafe/commit/a8576380a4f3396592e243f600733322c788c022))
* polling guard + UTC reset documentation ([405152d](https://github.com/HubDev-AI/relay.cafe/commit/405152d5dc575bc3924b21dce91f7c0d8e4de83a))
* remove DEV_MODE, fix KMS key path, make message TTL configurable ([4c0a897](https://github.com/HubDev-AI/relay.cafe/commit/4c0a897f3f1e0ab549f9117dc9c32fb81424f8e5))
* remove stale cleanup.test.ts referencing deleted module ([008c89b](https://github.com/HubDev-AI/relay.cafe/commit/008c89bc052df4c6c0d19c04e328c4d26433ffd4))
* strip Authorization header and request bodies from Sentry events ([e91bb9a](https://github.com/HubDev-AI/relay.cafe/commit/e91bb9ace959bd87b8e6c0c1d7aed35bfe3c4a46))
* strip sensitive data from Sentry events ([143b178](https://github.com/HubDev-AI/relay.cafe/commit/143b1786bee4d68ce5ba57736864df2a017f1422))
