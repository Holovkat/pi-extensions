# Lessons Learned From A Real MCP App Rollout

## What Repeatedly Helped

- validate against the real hosted endpoint, not only a local file edit
- use small patch/validate/retest loops
- keep PI/runtime ownership in one place instead of parallel hosts
- build widgets that can hydrate from both local and OpenAI-style hosts
- add connection visibility instead of guessing from symptoms

## What Repeatedly Hurt

- stale processes serving old code
- assuming one session ID represented the whole system
- treating every raw `Mcp-Session-Id` as a human-meaningful session
- splitting features across endpoints after the product expectation was one app
- porting local-only widget assumptions into external clients

## Strong Recommendations

1. Start with a written session model.
2. Choose single-endpoint vs multi-endpoint early.
3. Build external widget compatibility up front.
4. Restart and verify the actual runtime after each hosting-layer change.
5. Keep a standard smoke-test script with the app from day one.
