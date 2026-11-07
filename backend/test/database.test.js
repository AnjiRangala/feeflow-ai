import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import test from 'node:test';
import { connectDatabase } from '../src/config/database.js';

test('database connection failure is reported without an in-memory fallback', async () => {
  try {
    await assert.rejects(
      connectDatabase('mongodb://127.0.0.1:1/feeflow_connection_failure?serverSelectionTimeoutMS=250')
    );
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(mongoose.connection.db, undefined);
  } finally {
    await mongoose.disconnect();
  }
});
