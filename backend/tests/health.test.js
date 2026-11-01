import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { StoreRepository } from "../src/repositories/store.repository.js";

test("GET /health returns 200 ok", async () => {
  const store = new StoreRepository();
  const server = createApp({ store }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});

test("GET /ready returns 503 before sync completes and 200 once ready", async () => {
  const store = new StoreRepository();
  const server = createApp({ store }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const resBefore = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(resBefore.status, 503);
    assert.deepEqual(await resBefore.json(), { ready: false });

    store.setReady(true);
    const resAfter = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(resAfter.status, 200);
    assert.deepEqual(await resAfter.json(), { ready: true });
  } finally {
    server.close();
  }
});

