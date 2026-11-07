import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config/env.js';

const required = {
  MONGO_URI: 'mongodb://localhost:27017/feeflow_test',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-123456',
  OTP_HMAC_SECRET: 'test-otp-secret-that-is-long-enough-123456'
};

test('risk service configuration accepts a loopback service and rejects external providers', () => {
  assert.equal(loadConfig({ ...required, AI_SERVICE_URL: 'http://localhost:8000' }).AI_SERVICE_URL, 'http://localhost:8000');
  assert.equal(loadConfig({ ...required, AI_SERVICE_URL: 'http://feeflow-ai-service:8000' }).AI_SERVICE_URL, 'http://feeflow-ai-service:8000');
  assert.throws(
    () => loadConfig({ ...required, AI_SERVICE_URL: 'https://api.example.com/predict' }),
    /private single-label service/
  );
});
